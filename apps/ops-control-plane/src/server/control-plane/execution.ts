import { openSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  buildArtifactRunLayout,
  getManagedStorageRootLabel,
  publishBrokerEvent,
  type BrokerTransportConfig,
  writeDatasetMetadata,
  writeHtmlArtifact,
  writeStructuredJsonDocument,
} from '@repo/control-plane-adapters';
import {
  actorOperatorInputSchema,
  deriveMongoDbName,
  searchSpaceConfigSchema,
} from '@repo/job-search-spaces';
import type {
  ControlPlaneRun,
  RunManifest,
  SourceListingRecord,
} from '@repo/control-plane-contracts';
import {
  buildArtifactHtmlFileName,
  buildDedupeKey,
  buildCrawlerDetailCapturedEvent,
  buildCrawlerRunFinishedEvent,
  buildCrawlerRunRequestedEvent,
  buildIngestionLifecycleEvent,
  crawlerStartRunRequestV2Schema,
  ingestionStartRunRequestV2Schema,
  nowIso,
  startRunResponseV2Schema,
} from '@repo/control-plane-contracts';
import { env } from '@/server/env';
import {
  buildControlPlaneRunDir,
  buildRunGeneratedInputPath,
  buildRunManifestPath,
  buildRunWorkerLogPath,
  buildRunWorkerRuntimePath,
  controlPlaneBrokerRootDir,
  crawlerAppRootDir,
  ingestionAppRootDir,
} from '@/server/control-plane/paths';
import {
  type WorkerRuntime,
  writeRunRecord,
  writeWorkerRuntime,
} from '@/server/control-plane/store';

type ExecuteRunInput = {
  run: ControlPlaneRun;
  manifest: RunManifest;
};

type CrawlerWorkerEnvInput = {
  manifest: RunManifest;
  runId: string;
  mongoDbName: string;
  crawlerSummaryPath: string;
  searchSpacesDir: string;
};

type IngestionWorkerEnvInput = {
  manifest: RunManifest;
  mongoDbName: string;
};

const workerEnvFileNames = ['.env', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env.local'];

function getBrokerTransportConfig(): BrokerTransportConfig {
  if (env.CONTROL_PLANE_BROKER_BACKEND === 'gcp_pubsub') {
    if (!env.CONTROL_PLANE_GCP_PROJECT_ID) {
      throw new Error(
        'CONTROL_PLANE_BROKER_BACKEND=gcp_pubsub requires CONTROL_PLANE_GCP_PROJECT_ID.',
      );
    }

    return {
      type: 'gcp_pubsub',
      archiveRootDir: controlPlaneBrokerRootDir,
      projectId: env.CONTROL_PLANE_GCP_PROJECT_ID,
      topicName: env.CONTROL_PLANE_GCP_PUBSUB_TOPIC,
      subscriptionNamePrefix: env.CONTROL_PLANE_GCP_PUBSUB_SUBSCRIPTION_PREFIX,
    };
  }

  return {
    type: 'local',
    archiveRootDir: controlPlaneBrokerRootDir,
  };
}

function getMongoDbName(manifest: RunManifest): string {
  return deriveMongoDbName({
    dbPrefix: env.JOB_COMPASS_DB_PREFIX,
    searchSpaceId:
      env.CONTROL_PLANE_EXECUTION_MODE === 'worker_http'
        ? manifest.pipelineId
        : manifest.searchSpaceSnapshot.id,
  });
}

function mapSourceTypeToWorkerSource(manifest: RunManifest): string {
  switch (manifest.sourceType) {
    case 'jobs_cz':
      return 'jobs.cz';
    default:
      throw new Error(`Unsupported source type "${manifest.sourceType}".`);
  }
}

function hasMongoSink(manifest: RunManifest): boolean {
  return manifest.structuredOutputDestinationSnapshots.some(
    (destination) => destination.type === 'mongodb',
  );
}

function resolveConnectionUri(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return env.MONGODB_URI ?? '';
  }

  if (!value.startsWith('env:')) {
    return value;
  }

  const envKey = value.slice('env:'.length).trim();
  if (envKey.length === 0) {
    return env.MONGODB_URI ?? '';
  }

  return process.env[envKey]?.trim() || '';
}

function getMongoConnectionUri(manifest: RunManifest): string {
  const mongoDestination = manifest.structuredOutputDestinationSnapshots.find(
    (destination) => destination.type === 'mongodb',
  );

  return mongoDestination?.type === 'mongodb'
    ? resolveConnectionUri(mongoDestination.config.connectionUri)
    : (env.MONGODB_URI ?? '');
}

function parseEnvValue(raw: string, key: string): string | null {
  const prefix = `${key}=`;
  let resolved: string | null = null;

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    if (!trimmed.startsWith(prefix)) {
      continue;
    }

    const value = trimmed.slice(prefix.length).trim();
    const normalized =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1).trim()
        : value;

    resolved = normalized.length > 0 ? normalized : null;
  }

  return resolved;
}

export async function hasWorkerEnvValueInAppDir(appRootDir: string, key: string): Promise<boolean> {
  const runtimeValue = process.env[key];
  if (typeof runtimeValue === 'string' && runtimeValue.trim().length > 0) {
    return true;
  }

  for (const fileName of workerEnvFileNames) {
    const filePath = path.join(appRootDir, fileName);
    const raw = await readFile(filePath, 'utf8').catch((error: unknown) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }

      throw error;
    });

    if (!raw) {
      continue;
    }

    const resolvedValue = parseEnvValue(raw, key);
    if (resolvedValue) {
      return true;
    }
  }

  return false;
}

export function buildCrawlerWorkerEnvOverrides(
  input: CrawlerWorkerEnvInput,
): Record<string, string> {
  const baseEnv: Record<string, string> = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    CRAWLEE_LOG_LEVEL: input.manifest.runtimeProfileSnapshot.debugLog ? 'DEBUG' : 'INFO',
    JOB_COMPASS_DB_PREFIX: env.JOB_COMPASS_DB_PREFIX,
    MONGODB_URI: env.MONGODB_URI ?? '',
    MONGODB_DB_NAME: input.mongoDbName,
    ENABLE_MONGO_RUN_SUMMARY_WRITE: 'true',
    CRAWL_RUN_ID: input.runId,
    CRAWL_RUN_SUMMARY_FILE_PATH: input.crawlerSummaryPath,
    JOB_COMPASS_SEARCH_SPACES_DIR: input.searchSpacesDir,
    LOCAL_BROKER_DIR: controlPlaneBrokerRootDir,
    JOB_COMPASS_BROKER_BACKEND: env.CONTROL_PLANE_BROKER_BACKEND,
    ENABLE_INGESTION_TRIGGER: 'false',
  };

  if (env.CONTROL_PLANE_BROKER_BACKEND === 'gcp_pubsub' && env.CONTROL_PLANE_GCP_PROJECT_ID) {
    baseEnv.JOB_COMPASS_GCP_PROJECT_ID = env.CONTROL_PLANE_GCP_PROJECT_ID;
    baseEnv.JOB_COMPASS_GCP_PUBSUB_TOPIC = env.CONTROL_PLANE_GCP_PUBSUB_TOPIC;
    baseEnv.JOB_COMPASS_GCP_PUBSUB_SUBSCRIPTION_PREFIX =
      env.CONTROL_PLANE_GCP_PUBSUB_SUBSCRIPTION_PREFIX;
  }

  if (
    input.manifest.artifactStorageSnapshot.type === 'local_filesystem' &&
    'basePath' in input.manifest.artifactStorageSnapshot.config
  ) {
    baseEnv.JOB_COMPASS_ARTIFACT_STORE_TYPE = 'local_filesystem';
    baseEnv.LOCAL_SHARED_SCRAPED_JOBS_DIR = path.resolve(
      input.manifest.artifactStorageSnapshot.config.basePath,
    );
  } else if (
    input.manifest.artifactStorageSnapshot.type === 'gcs' &&
    'bucket' in input.manifest.artifactStorageSnapshot.config
  ) {
    baseEnv.JOB_COMPASS_ARTIFACT_STORE_TYPE = 'gcs';
    baseEnv.JOB_COMPASS_GCS_BUCKET = input.manifest.artifactStorageSnapshot.config.bucket;
    baseEnv.JOB_COMPASS_GCS_PREFIX = input.manifest.artifactStorageSnapshot.config.prefix ?? '';
    if (env.CONTROL_PLANE_GCP_PROJECT_ID) {
      baseEnv.JOB_COMPASS_GCP_PROJECT_ID = env.CONTROL_PLANE_GCP_PROJECT_ID;
    }
  }

  return baseEnv;
}

export function buildIngestionWorkerEnvOverrides(
  input: IngestionWorkerEnvInput,
): Record<string, string> {
  const baseEnv: Record<string, string> = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    JOB_COMPASS_DB_PREFIX: env.JOB_COMPASS_DB_PREFIX,
    SEARCH_SPACE_ID: input.manifest.searchSpaceSnapshot.id,
    MONGODB_URI: getMongoConnectionUri(input.manifest),
    ENABLE_MONGO_WRITE: hasMongoSink(input.manifest) ? 'true' : 'false',
    MONGODB_DB_NAME: input.mongoDbName,
    LOCAL_BROKER_DIR: controlPlaneBrokerRootDir,
    JOB_COMPASS_BROKER_BACKEND: env.CONTROL_PLANE_BROKER_BACKEND,
    INGESTION_PARSER_BACKEND: env.CONTROL_PLANE_INGESTION_PARSER_BACKEND,
  };

  if (env.CONTROL_PLANE_BROKER_BACKEND === 'gcp_pubsub' && env.CONTROL_PLANE_GCP_PROJECT_ID) {
    baseEnv.JOB_COMPASS_GCP_PROJECT_ID = env.CONTROL_PLANE_GCP_PROJECT_ID;
    baseEnv.JOB_COMPASS_GCP_PUBSUB_TOPIC = env.CONTROL_PLANE_GCP_PUBSUB_TOPIC;
    baseEnv.JOB_COMPASS_GCP_PUBSUB_SUBSCRIPTION_PREFIX =
      env.CONTROL_PLANE_GCP_PUBSUB_SUBSCRIPTION_PREFIX;
  }

  return baseEnv;
}

export async function assertExecutableRunPrerequisites(manifest: RunManifest): Promise<void> {
  if (env.CONTROL_PLANE_EXECUTION_MODE === 'fixture') {
    return;
  }

  if (env.CONTROL_PLANE_EXECUTION_MODE === 'worker_http') {
    if (!env.CONTROL_PLANE_CRAWLER_WORKER_BASE_URL) {
      throw new Error(
        'CONTROL_PLANE_EXECUTION_MODE=worker_http requires CONTROL_PLANE_CRAWLER_WORKER_BASE_URL.',
      );
    }

    if (!env.CONTROL_PLANE_WORKER_AUTH_TOKEN) {
      throw new Error(
        'CONTROL_PLANE_EXECUTION_MODE=worker_http requires CONTROL_PLANE_WORKER_AUTH_TOKEN.',
      );
    }

    const shouldRunIngestion =
      manifest.mode === 'crawl_and_ingest' && manifest.runtimeProfileSnapshot.ingestionEnabled;
    if (shouldRunIngestion && !env.CONTROL_PLANE_INGESTION_WORKER_BASE_URL) {
      throw new Error(
        'CONTROL_PLANE_EXECUTION_MODE=worker_http with ingestion enabled requires CONTROL_PLANE_INGESTION_WORKER_BASE_URL.',
      );
    }

    return;
  }

  if (!env.MONGODB_URI) {
    throw new Error(
      'CONTROL_PLANE_EXECUTION_MODE=local_cli requires MONGODB_URI because the current crawler still reconciles against normalized_job_ads.',
    );
  }

  getBrokerTransportConfig();

  const shouldRunIngestion =
    manifest.mode === 'crawl_and_ingest' && manifest.runtimeProfileSnapshot.ingestionEnabled;
  if (!shouldRunIngestion) {
    return;
  }

  if (env.CONTROL_PLANE_INGESTION_PARSER_BACKEND === 'fixture') {
    return;
  }

  const hasGeminiKey = await hasWorkerEnvValueInAppDir(ingestionAppRootDir, 'GEMINI_API_KEY');
  if (!hasGeminiKey) {
    throw new Error(
      'CONTROL_PLANE_EXECUTION_MODE=local_cli with ingestion enabled requires GEMINI_API_KEY in the runtime environment or apps/jobs-ingestion-service/.env(.local).',
    );
  }

  const hasLangsmithKey = await hasWorkerEnvValueInAppDir(ingestionAppRootDir, 'LANGSMITH_API_KEY');
  if (!hasLangsmithKey) {
    throw new Error(
      'CONTROL_PLANE_EXECUTION_MODE=local_cli with Gemini ingestion requires LANGSMITH_API_KEY in the runtime environment or apps/jobs-ingestion-service/.env(.local).',
    );
  }
}

async function updateRuntimeStatus(runId: string, runtime: WorkerRuntime): Promise<void> {
  await writeWorkerRuntime(runId, runtime);
}

function buildWorkerAuthHeaders(): HeadersInit {
  if (!env.CONTROL_PLANE_WORKER_AUTH_TOKEN) {
    throw new Error('CONTROL_PLANE_WORKER_AUTH_TOKEN is not configured.');
  }

  return {
    Authorization: `Bearer ${env.CONTROL_PLANE_WORKER_AUTH_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function mapArtifactStorageSnapshotToV2Sink(manifest: RunManifest) {
  const snapshot = manifest.artifactStorageSnapshot;
  if (snapshot.type === 'local_filesystem') {
    return {
      type: 'local_filesystem' as const,
      basePath: path.resolve(snapshot.config.basePath),
    };
  }

  return {
    type: 'gcs' as const,
    bucket: snapshot.config.bucket,
    prefix: snapshot.config.prefix ?? '',
  };
}

export function buildCrawlerWorkerStartRunRequestV2(manifest: RunManifest) {
  return crawlerStartRunRequestV2Schema.parse({
    contractVersion: 'v2',
    runId: manifest.runId,
    idempotencyKey: `idmp-${manifest.runId}`,
    runtimeSnapshot: {
      crawlerMaxConcurrency: manifest.runtimeProfileSnapshot.crawlerMaxConcurrency,
      crawlerMaxRequestsPerMinute: manifest.runtimeProfileSnapshot.crawlerMaxRequestsPerMinute,
    },
    inputRef: {
      source: mapSourceTypeToWorkerSource(manifest),
      searchSpaceId: manifest.searchSpaceSnapshot.id,
      searchSpaceSnapshot: {
        name: manifest.searchSpaceSnapshot.name,
        description: manifest.searchSpaceSnapshot.name,
        startUrls: manifest.searchSpaceSnapshot.startUrls,
        maxItems: manifest.searchSpaceSnapshot.maxItemsDefault,
        // The current control-plane manifest does not carry a separate "disable inactive marking"
        // flag, only the removed partial-run override from v1. V2 workers therefore treat
        // inactive marking as enabled by default and gate it by phase-1 integrity instead.
        allowInactiveMarking: true,
      },
      emitDetailCapturedEvents:
        manifest.mode === 'crawl_and_ingest' && manifest.runtimeProfileSnapshot.ingestionEnabled,
    },
    persistenceTargets: {
      dbName: getMongoDbName(manifest),
    },
    artifactSink: mapArtifactStorageSnapshotToV2Sink(manifest),
  });
}

export function buildIngestionWorkerStartRunRequestV2(manifest: RunManifest) {
  return ingestionStartRunRequestV2Schema.parse({
    contractVersion: 'v2',
    runId: manifest.runId,
    idempotencyKey: `idmp-${manifest.runId}`,
    runtimeSnapshot: {
      ingestionConcurrency: manifest.runtimeProfileSnapshot.ingestionConcurrency,
    },
    inputRef: {
      crawlRunId: manifest.runId,
      searchSpaceId: manifest.searchSpaceSnapshot.id,
    },
    persistenceTargets: {
      dbName: getMongoDbName(manifest),
    },
    outputSinks: manifest.structuredOutputDestinationSnapshots.some(
      (destination) => destination.type === 'downloadable_json',
    )
      ? [{ type: 'downloadable_json' as const }]
      : [],
  });
}

async function postWorkerStartRun(input: {
  baseUrl: string;
  payload: unknown;
}): Promise<ReturnType<typeof startRunResponseV2Schema.parse>> {
  const response = await fetch(new URL('/v1/runs', input.baseUrl), {
    method: 'POST',
    headers: buildWorkerAuthHeaders(),
    body: JSON.stringify(input.payload),
    signal: AbortSignal.timeout(env.CONTROL_PLANE_WORKER_HTTP_TIMEOUT_MS),
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Worker returned non-JSON response (${response.status}): ${text}`);
  }

  const parsed = startRunResponseV2Schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Worker returned invalid StartRun response (${response.status}).`);
  }

  if (!response.ok || !parsed.data.ok || !parsed.data.accepted) {
    const errorMessage = parsed.data.ok
      ? 'Worker rejected StartRun request.'
      : parsed.data.error.message;
    throw new Error(errorMessage);
  }

  return parsed.data;
}

async function postWorkerCancelRun(input: { baseUrl: string; runId: string }): Promise<void> {
  try {
    await fetch(new URL(`/v1/runs/${input.runId}/cancel`, input.baseUrl), {
      method: 'POST',
      headers: buildWorkerAuthHeaders(),
      signal: AbortSignal.timeout(env.CONTROL_PLANE_WORKER_HTTP_TIMEOUT_MS),
    });
  } catch {
    // Best-effort rollback for partially started orchestrations.
  }
}

async function startWorkerHttpExecution({ run, manifest }: ExecuteRunInput): Promise<void> {
  const dbName = getMongoDbName(manifest);
  const artifactRoot = getManagedStorageRootLabel(manifest.artifactStorageSnapshot);
  const shouldRunIngestion =
    manifest.mode === 'crawl_and_ingest' && manifest.runtimeProfileSnapshot.ingestionEnabled;
  const now = nowIso();

  let ingestionAccepted = false;

  try {
    if (shouldRunIngestion) {
      const ingestionBaseUrl = env.CONTROL_PLANE_INGESTION_WORKER_BASE_URL;
      if (!ingestionBaseUrl) {
        throw new Error('CONTROL_PLANE_INGESTION_WORKER_BASE_URL is not configured.');
      }

      const ingestionResponse = await postWorkerStartRun({
        baseUrl: ingestionBaseUrl,
        payload: buildIngestionWorkerStartRunRequestV2(manifest),
      });
      ingestionAccepted = true;

      await updateRuntimeStatus(run.runId, {
        workerType: 'ingestion',
        status: ingestionResponse.state === 'queued' ? 'queued' : 'running',
        startedAt: ingestionResponse.state === 'queued' ? undefined : now,
        lastHeartbeatAt: now,
        counters: {
          endpoint: ingestionBaseUrl,
          dbName,
          acceptedState: ingestionResponse.state,
        },
      });
    }

    const crawlerBaseUrl = env.CONTROL_PLANE_CRAWLER_WORKER_BASE_URL;
    if (!crawlerBaseUrl) {
      throw new Error('CONTROL_PLANE_CRAWLER_WORKER_BASE_URL is not configured.');
    }

    const crawlerResponse = await postWorkerStartRun({
      baseUrl: crawlerBaseUrl,
      payload: buildCrawlerWorkerStartRunRequestV2(manifest),
    });

    await updateRuntimeStatus(run.runId, {
      workerType: 'crawler',
      status: crawlerResponse.state === 'queued' ? 'queued' : 'running',
      startedAt: crawlerResponse.state === 'queued' ? undefined : now,
      lastHeartbeatAt: now,
      counters: {
        endpoint: crawlerBaseUrl,
        dbName,
        artifactRoot,
        acceptedState: crawlerResponse.state,
      },
    });
  } catch (error) {
    if (ingestionAccepted && env.CONTROL_PLANE_INGESTION_WORKER_BASE_URL) {
      await postWorkerCancelRun({
        baseUrl: env.CONTROL_PLANE_INGESTION_WORKER_BASE_URL,
        runId: manifest.runId,
      });
    }

    await writeRunRecord({
      ...run,
      status: 'failed',
      finishedAt: nowIso(),
      stopReason: 'start_run_failed',
      summary: {
        ...run.summary,
        executionMode: env.CONTROL_PLANE_EXECUTION_MODE,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });

    throw error;
  }
}

function buildGeneratedActorInput(manifest: RunManifest) {
  return actorOperatorInputSchema.parse({
    searchSpaceId: manifest.searchSpaceSnapshot.id,
    maxItems: manifest.searchSpaceSnapshot.maxItemsDefault,
    maxConcurrency: manifest.runtimeProfileSnapshot.crawlerMaxConcurrency,
    maxRequestsPerMinute: manifest.runtimeProfileSnapshot.crawlerMaxRequestsPerMinute,
    debugLog: manifest.runtimeProfileSnapshot.debugLog,
    allowInactiveMarkingOnPartialRuns:
      manifest.searchSpaceSnapshot.allowInactiveMarkingOnPartialRuns,
  });
}

async function writeGeneratedSearchSpaceConfig(manifest: RunManifest): Promise<string> {
  const searchSpacesDir = path.join(
    buildControlPlaneRunDir(manifest.runId),
    'generated-search-spaces',
  );
  const filePath = path.join(searchSpacesDir, `${manifest.searchSpaceSnapshot.id}.json`);
  const generatedSearchSpace = searchSpaceConfigSchema.parse({
    searchSpaceId: manifest.searchSpaceSnapshot.id,
    description: `Generated from control-plane run ${manifest.runId}`,
    startUrls: manifest.searchSpaceSnapshot.startUrls,
    crawlDefaults: {
      maxItems: manifest.searchSpaceSnapshot.maxItemsDefault,
      maxConcurrency: manifest.runtimeProfileSnapshot.crawlerMaxConcurrency,
      maxRequestsPerMinute: manifest.runtimeProfileSnapshot.crawlerMaxRequestsPerMinute,
      debugLog: manifest.runtimeProfileSnapshot.debugLog,
      proxyConfiguration: {
        useApifyProxy: false,
      },
    },
    reconciliation: {
      allowInactiveMarkingOnPartialRuns:
        manifest.searchSpaceSnapshot.allowInactiveMarkingOnPartialRuns,
    },
    ingestion: {
      triggerEnabledByDefault: false,
    },
  });

  await mkdir(searchSpacesDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(generatedSearchSpace, null, 2)}\n`, 'utf8');
  return searchSpacesDir;
}

export async function writeGeneratedActorInput(
  manifest: RunManifest,
  outputPath: string = buildRunGeneratedInputPath(manifest.runId),
): Promise<string> {
  const actorInput = buildGeneratedActorInput(manifest);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(actorInput, null, 2)}\n`, 'utf8');
  return outputPath;
}

async function simulateFixtureExecution({ run, manifest }: ExecuteRunInput): Promise<void> {
  const brokerTransport = getBrokerTransportConfig();
  const artifactLayout = buildArtifactRunLayout(manifest.artifactStorageSnapshot, manifest.runId);

  const listingRecord: SourceListingRecord = {
    sourceId: 'fixture-001',
    adUrl: manifest.searchSpaceSnapshot.startUrls[0] ?? 'https://www.jobs.cz/rpd/fixture-001/',
    jobTitle: 'Fixture platform engineer',
    companyName: 'OmniCrawl Labs',
    location: 'Prague',
    salary: '90 000 CZK',
    publishedInfoText: 'Fixture mode',
    scrapedAt: nowIso(),
    source: 'jobs.cz',
    htmlDetailPageKey: buildArtifactHtmlFileName('fixture-001'),
  };
  const detailHtml = `<!doctype html><html><body><main><h1>${listingRecord.jobTitle}</h1><p>Fixture detail for control-plane testing.</p></main></body></html>`;
  const htmlArtifact = await writeHtmlArtifact({
    destination: manifest.artifactStorageSnapshot,
    crawlRunId: manifest.runId,
    sourceId: listingRecord.sourceId,
    html: detailHtml,
    checksum: 'fixture-checksum',
    sizeBytes: Buffer.byteLength(detailHtml, 'utf8'),
    projectId: env.CONTROL_PLANE_GCP_PROJECT_ID,
  });
  const artifactDatasetPath = await writeDatasetMetadata({
    destination: manifest.artifactStorageSnapshot,
    crawlRunId: manifest.runId,
    datasetRecords: [listingRecord],
    projectId: env.CONTROL_PLANE_GCP_PROJECT_ID,
  });

  await updateRuntimeStatus(run.runId, {
    workerType: 'crawler',
    status: 'running',
    startedAt: run.startedAt,
    lastHeartbeatAt: nowIso(),
    counters: {},
  });

  await publishBrokerEvent({
    broker: brokerTransport,
    event: buildCrawlerRunRequestedEvent({
      runManifest: manifest,
      producer: 'control-plane-fixture',
    }),
  });

  await publishBrokerEvent({
    broker: brokerTransport,
    event: buildCrawlerDetailCapturedEvent({
      runId: run.runId,
      crawlRunId: manifest.runId,
      searchSpaceId: manifest.searchSpaceSnapshot.id,
      source: 'jobs.cz',
      sourceId: listingRecord.sourceId,
      listingRecord,
      artifact: htmlArtifact,
      producer: 'crawler-worker-fixture',
    }),
  });

  await publishBrokerEvent({
    broker: brokerTransport,
    event: buildCrawlerRunFinishedEvent({
      runId: run.runId,
      crawlRunId: manifest.runId,
      searchSpaceId: manifest.searchSpaceSnapshot.id,
      status: 'succeeded',
      datasetPath: artifactDatasetPath,
      newJobsCount: 1,
      failedRequests: 0,
      stopReason: 'completed',
      producer: 'crawler-worker-fixture',
    }),
  });

  await updateRuntimeStatus(run.runId, {
    workerType: 'crawler',
    status: 'succeeded',
    startedAt: run.startedAt,
    finishedAt: nowIso(),
    lastHeartbeatAt: nowIso(),
    counters: {
      datasetPath: artifactDatasetPath,
      artifactsWritten: 1,
      eventsPublished: 3,
    },
  });

  if (manifest.mode === 'crawl_and_ingest' && manifest.runtimeProfileSnapshot.ingestionEnabled) {
    await updateRuntimeStatus(run.runId, {
      workerType: 'ingestion',
      status: 'running',
      startedAt: nowIso(),
      lastHeartbeatAt: nowIso(),
      counters: {},
    });

    const normalizedDocument = {
      id: `fixture-${manifest.runId}`,
      sourceId: listingRecord.sourceId,
      title: listingRecord.jobTitle,
      companyName: listingRecord.companyName,
      searchSpaceId: manifest.searchSpaceSnapshot.id,
      crawlRunId: manifest.runId,
      source: listingRecord.source,
      adUrl: listingRecord.adUrl,
    };

    await Promise.all(
      manifest.structuredOutputDestinationSnapshots
        .filter((destination) => destination.type === 'downloadable_json')
        .map((destination) =>
          writeStructuredJsonDocument({
            destination,
            crawlRunId: manifest.runId,
            sourceId: listingRecord.sourceId,
            document: normalizedDocument,
            projectId: env.CONTROL_PLANE_GCP_PROJECT_ID,
          }),
        ),
    );

    const dedupeKey = buildDedupeKey({
      source: listingRecord.source,
      searchSpaceId: manifest.searchSpaceSnapshot.id,
      crawlRunId: manifest.runId,
      sourceId: listingRecord.sourceId,
    });

    await publishBrokerEvent({
      broker: brokerTransport,
      event: buildIngestionLifecycleEvent({
        eventType: 'ingestion.item.started',
        runId: run.runId,
        crawlRunId: manifest.runId,
        source: listingRecord.source,
        sourceId: listingRecord.sourceId,
        dedupeKey,
        producer: 'jobs-ingestion-service-fixture',
      }),
    });

    await publishBrokerEvent({
      broker: brokerTransport,
      event: buildIngestionLifecycleEvent({
        eventType: 'ingestion.item.succeeded',
        runId: run.runId,
        crawlRunId: manifest.runId,
        source: listingRecord.source,
        sourceId: listingRecord.sourceId,
        dedupeKey,
        documentId: normalizedDocument.id,
        sinkResults: manifest.structuredOutputDestinationSnapshots.map((destination) => ({
          sinkType: destination.type,
          targetRef:
            destination.type === 'downloadable_json'
              ? destination.config.storageType === 'local_filesystem'
                ? destination.config.basePath
                : destination.config.bucket
              : destination.config.connectionUri || 'env:MONGODB_URI',
          writeMode: destination.type === 'mongodb' ? 'upsert' : 'overwrite',
        })),
        producer: 'jobs-ingestion-service-fixture',
      }),
    });

    await updateRuntimeStatus(run.runId, {
      workerType: 'ingestion',
      status: 'succeeded',
      startedAt: nowIso(),
      finishedAt: nowIso(),
      lastHeartbeatAt: nowIso(),
      counters: {
        itemsProcessed: 1,
        itemsFailed: 0,
        itemsSkipped: 0,
      },
    });
  }

  await writeRunRecord({
    ...run,
    status:
      manifest.mode === 'crawl_and_ingest' && manifest.runtimeProfileSnapshot.ingestionEnabled
        ? 'succeeded'
        : 'succeeded',
    finishedAt: nowIso(),
    summary: {
      ...run.summary,
      fixtureMode: true,
      brokerRunDir: path.join(controlPlaneBrokerRootDir, 'runs', run.runId),
      artifactRunDir: artifactLayout.runDir,
      artifactDatasetPath,
    },
  });
}

function spawnWorker(input: {
  cwd: string;
  args: string[];
  envOverrides: Record<string, string>;
  logPath: string;
}): number {
  const logFd = openSync(input.logPath, 'a');
  const child = spawn(env.CONTROL_PLANE_PNPM_BIN, input.args, {
    cwd: input.cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      ...input.envOverrides,
    },
  });

  child.unref();
  return child.pid ?? 0;
}

async function startLocalCliExecution({ run, manifest }: ExecuteRunInput): Promise<void> {
  const artifactRoot = getManagedStorageRootLabel(manifest.artifactStorageSnapshot);
  const mongoDbName = getMongoDbName(manifest);
  const searchSpacesDir = await writeGeneratedSearchSpaceConfig(manifest);
  const crawlerLogPath = buildRunWorkerLogPath(run.runId, 'crawler');
  const ingestionLogPath = buildRunWorkerLogPath(run.runId, 'ingestion');
  const crawlerRuntimePath = buildRunWorkerRuntimePath(run.runId, 'crawler');
  const ingestionRuntimePath = buildRunWorkerRuntimePath(run.runId, 'ingestion');
  const crawlerSummaryPath = path.join(
    buildControlPlaneRunDir(run.runId),
    'crawler-run-summary.json',
  );
  await mkdir(path.dirname(crawlerLogPath), { recursive: true });

  await updateRuntimeStatus(run.runId, {
    workerType: 'crawler',
    status: 'queued',
    logPath: crawlerLogPath,
    counters: {
      runtimePath: crawlerRuntimePath,
      summaryPath: crawlerSummaryPath,
      searchSpacesDir,
    },
  });

  const shouldRunIngestion =
    manifest.mode === 'crawl_and_ingest' && manifest.runtimeProfileSnapshot.ingestionEnabled;

  if (shouldRunIngestion) {
    await updateRuntimeStatus(run.runId, {
      workerType: 'ingestion',
      status: 'queued',
      logPath: ingestionLogPath,
      counters: {
        runtimePath: ingestionRuntimePath,
      },
    });
  }

  if (shouldRunIngestion) {
    const ingestionPid = spawnWorker({
      cwd: ingestionAppRootDir,
      args: [
        'exec',
        'tsx',
        'src/worker.ts',
        '--run-manifest',
        buildRunManifestPath(run.runId),
        '--runtime-path',
        ingestionRuntimePath,
        '--broker-dir',
        controlPlaneBrokerRootDir,
      ],
      logPath: ingestionLogPath,
      envOverrides: buildIngestionWorkerEnvOverrides({
        manifest,
        mongoDbName,
      }),
    });

    await updateRuntimeStatus(run.runId, {
      workerType: 'ingestion',
      status: 'queued',
      pid: ingestionPid > 0 ? ingestionPid : undefined,
      logPath: ingestionLogPath,
      counters: {
        runtimePath: ingestionRuntimePath,
      },
    });
  }

  const crawlerPid = spawnWorker({
    cwd: crawlerAppRootDir,
    args: [
      'exec',
      'tsx',
      'src/worker.ts',
      '--run-manifest',
      buildRunManifestPath(run.runId),
      '--runtime-path',
      crawlerRuntimePath,
      '--generated-input-path',
      buildRunGeneratedInputPath(run.runId),
      '--broker-dir',
      controlPlaneBrokerRootDir,
    ],
    logPath: crawlerLogPath,
    envOverrides: buildCrawlerWorkerEnvOverrides({
      manifest,
      runId: run.runId,
      mongoDbName,
      crawlerSummaryPath,
      searchSpacesDir,
    }),
  });

  await updateRuntimeStatus(run.runId, {
    workerType: 'crawler',
    status: 'queued',
    pid: crawlerPid > 0 ? crawlerPid : undefined,
    logPath: crawlerLogPath,
    counters: {
      runtimePath: crawlerRuntimePath,
      summaryPath: crawlerSummaryPath,
      artifactRoot,
      brokerRoot: controlPlaneBrokerRootDir,
      searchSpacesDir,
    },
  });

  await publishBrokerEvent({
    broker: getBrokerTransportConfig(),
    event: buildCrawlerRunRequestedEvent({ runManifest: manifest }),
  });
}

export async function executeRun(input: ExecuteRunInput): Promise<void> {
  if (env.CONTROL_PLANE_EXECUTION_MODE === 'fixture') {
    await simulateFixtureExecution(input);
    return;
  }

  if (env.CONTROL_PLANE_EXECUTION_MODE === 'worker_http') {
    await startWorkerHttpExecution(input);
    return;
  }

  await startLocalCliExecution(input);
}
