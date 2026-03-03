import { openSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { actorOperatorInputSchema, deriveMongoDbName } from '@repo/job-search-spaces';
import type {
  ControlPlaneRun,
  RunManifest,
  SourceListingRecord,
} from '@repo/control-plane-contracts';
import {
  buildArtifactDatasetPath,
  buildArtifactHtmlFileName,
  buildArtifactRunDir,
  buildCrawlerDetailCapturedEvent,
  buildCrawlerRunFinishedEvent,
  buildCrawlerRunRequestedEvent,
  buildStructuredJsonFileName,
  buildStructuredRunDir,
  nowIso,
  writeBrokerEvent,
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
  artifactRoot: string;
  crawlerSummaryPath: string;
};

type IngestionWorkerEnvInput = {
  manifest: RunManifest;
  mongoDbName: string;
};

const workerEnvFileNames = ['.env', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env.local'];

function getLocalArtifactBasePath(manifest: RunManifest): string {
  if (
    manifest.artifactDestinationSnapshot.type !== 'local_filesystem' ||
    !('basePath' in manifest.artifactDestinationSnapshot.config)
  ) {
    throw new Error(
      `Execution mode "${env.CONTROL_PLANE_EXECUTION_MODE}" only supports local filesystem artifact destinations in v1.`,
    );
  }

  return path.resolve(manifest.artifactDestinationSnapshot.config.basePath);
}

function getMongoDbName(manifest: RunManifest): string {
  return deriveMongoDbName({
    dbPrefix: env.JOB_COMPASS_DB_PREFIX,
    searchSpaceId: manifest.searchSpaceSnapshot.id,
  });
}

function hasMongoSink(manifest: RunManifest): boolean {
  return manifest.structuredOutputDestinationSnapshots.some(
    (destination) => destination.type === 'mongodb',
  );
}

function getLocalJsonSinkRoots(manifest: RunManifest): string[] {
  return manifest.structuredOutputDestinationSnapshots.flatMap((destination) =>
    destination.type === 'local_json' && 'basePath' in destination.config
      ? [path.resolve(destination.config.basePath)]
      : [],
  );
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
  return {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    CRAWLEE_LOG_LEVEL: input.manifest.runtimeProfileSnapshot.debugLog ? 'DEBUG' : 'INFO',
    JOB_COMPASS_DB_PREFIX: env.JOB_COMPASS_DB_PREFIX,
    MONGODB_URI: env.MONGODB_URI ?? '',
    MONGODB_DB_NAME: input.mongoDbName,
    ENABLE_MONGO_RUN_SUMMARY_WRITE: 'true',
    LOCAL_SHARED_SCRAPED_JOBS_DIR: input.artifactRoot,
    CRAWL_RUN_ID: input.runId,
    CRAWL_RUN_SUMMARY_FILE_PATH: input.crawlerSummaryPath,
    LOCAL_BROKER_DIR: controlPlaneBrokerRootDir,
    ENABLE_INGESTION_TRIGGER: 'false',
  };
}

export function buildIngestionWorkerEnvOverrides(
  input: IngestionWorkerEnvInput,
): Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    JOB_COMPASS_DB_PREFIX: env.JOB_COMPASS_DB_PREFIX,
    SEARCH_SPACE_ID: input.manifest.searchSpaceSnapshot.id,
    MONGODB_URI: env.MONGODB_URI ?? '',
    ENABLE_MONGO_WRITE: hasMongoSink(input.manifest) ? 'true' : 'false',
    MONGODB_DB_NAME: input.mongoDbName,
  };
}

export async function assertExecutableRunPrerequisites(manifest: RunManifest): Promise<void> {
  if (env.CONTROL_PLANE_EXECUTION_MODE !== 'local_cli') {
    return;
  }

  if (!env.MONGODB_URI) {
    throw new Error(
      'CONTROL_PLANE_EXECUTION_MODE=local_cli requires MONGODB_URI because the current crawler still reconciles against normalized_job_ads.',
    );
  }

  getLocalArtifactBasePath(manifest);

  const shouldRunIngestion =
    manifest.mode === 'crawl_and_ingest' && manifest.runtimeProfileSnapshot.ingestionEnabled;
  if (!shouldRunIngestion) {
    return;
  }

  const hasGeminiKey = await hasWorkerEnvValueInAppDir(ingestionAppRootDir, 'GEMINI_API_KEY');
  if (!hasGeminiKey) {
    throw new Error(
      'CONTROL_PLANE_EXECUTION_MODE=local_cli with ingestion enabled requires GEMINI_API_KEY in the runtime environment or apps/jobs-ingestion-service/.env(.local).',
    );
  }
}

async function updateRuntimeStatus(runId: string, runtime: WorkerRuntime): Promise<void> {
  await writeWorkerRuntime(runId, runtime);
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
  const artifactRoot = getLocalArtifactBasePath(manifest);
  const artifactRunDir = buildArtifactRunDir(artifactRoot, manifest.runId);
  const artifactDatasetPath = buildArtifactDatasetPath(artifactRoot, manifest.runId);
  const recordsDir = path.dirname(
    path.join(artifactRunDir, 'records', buildArtifactHtmlFileName('fixture-001')),
  );
  await mkdir(recordsDir, { recursive: true });

  const listingRecord: SourceListingRecord = {
    sourceId: 'fixture-001',
    adUrl: manifest.searchSpaceSnapshot.startUrls[0] ?? 'https://www.jobs.cz/rpd/fixture-001/',
    jobTitle: 'Fixture platform engineer',
    companyName: 'JobCompass Labs',
    location: 'Prague',
    salary: '90 000 CZK',
    publishedInfoText: 'Fixture mode',
    scrapedAt: nowIso(),
    source: 'jobs.cz',
    htmlDetailPageKey: buildArtifactHtmlFileName('fixture-001'),
  };
  const htmlPath = path.join(recordsDir, listingRecord.htmlDetailPageKey);
  const detailHtml = `<!doctype html><html><body><main><h1>${listingRecord.jobTitle}</h1><p>Fixture detail for control-plane testing.</p></main></body></html>`;
  await writeFile(htmlPath, detailHtml, 'utf8');
  await writeFile(artifactDatasetPath, `${JSON.stringify([listingRecord], null, 2)}\n`, 'utf8');

  await updateRuntimeStatus(run.runId, {
    workerType: 'crawler',
    status: 'running',
    startedAt: run.startedAt,
    lastHeartbeatAt: nowIso(),
    counters: {},
  });

  await writeBrokerEvent(
    controlPlaneBrokerRootDir,
    buildCrawlerRunRequestedEvent({ runManifest: manifest, producer: 'control-plane-fixture' }),
  );

  await writeBrokerEvent(
    controlPlaneBrokerRootDir,
    buildCrawlerDetailCapturedEvent({
      runId: run.runId,
      crawlRunId: manifest.runId,
      searchSpaceId: manifest.searchSpaceSnapshot.id,
      source: 'jobs.cz',
      sourceId: listingRecord.sourceId,
      listingRecord,
      artifact: {
        artifactType: 'html',
        storageType: 'local_filesystem',
        storagePath: htmlPath,
        checksum: 'fixture-checksum',
        sizeBytes: Buffer.byteLength(detailHtml, 'utf8'),
      },
      producer: 'crawler-worker-fixture',
    }),
  );

  await writeBrokerEvent(
    controlPlaneBrokerRootDir,
    buildCrawlerRunFinishedEvent({
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
  );

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
      getLocalJsonSinkRoots(manifest).map(async (rootDir) => {
        const runDir = buildStructuredRunDir(rootDir, manifest.runId);
        await mkdir(runDir, { recursive: true });
        await writeFile(
          path.join(runDir, buildStructuredJsonFileName(listingRecord.sourceId)),
          `${JSON.stringify(normalizedDocument, null, 2)}\n`,
          'utf8',
        );
      }),
    );

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
  const artifactRoot = getLocalArtifactBasePath(manifest);
  const mongoDbName = getMongoDbName(manifest);
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
      artifactRoot,
      crawlerSummaryPath,
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
    },
  });

  await writeBrokerEvent(
    controlPlaneBrokerRootDir,
    buildCrawlerRunRequestedEvent({ runManifest: manifest }),
  );
}

export async function executeRun(input: ExecuteRunInput): Promise<void> {
  if (env.CONTROL_PLANE_EXECUTION_MODE === 'fixture') {
    await simulateFixtureExecution(input);
    return;
  }

  await startLocalCliExecution(input);
}
