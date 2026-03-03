import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  createBrokerRunConsumer,
  publishBrokerEvent,
  type BrokerTransportConfig,
  writeStructuredJsonDocument,
} from '@repo/control-plane-adapters';
import {
  brokerEventSchema,
  nowIso,
  runManifestSchema,
  type BrokerEvent,
  type RunManifest,
} from '@repo/control-plane-contracts';
import { deriveMongoDbName } from '@repo/job-search-spaces';
import { runIngestionRecordWorkflow } from './app.js';

type WorkerRuntime = {
  workerType: 'ingestion';
  status: 'queued' | 'running' | 'succeeded' | 'completed_with_errors' | 'failed' | 'stopped';
  startedAt?: string;
  finishedAt?: string;
  lastHeartbeatAt?: string;
  pid?: number;
  logPath?: string;
  errorMessage?: string;
  exitCode?: number | null;
  counters?: Record<string, unknown>;
};

type RuntimeCounters = {
  processedEventIds: string[];
  itemsProcessed: number;
  itemsFailed: number;
  itemsSkipped: number;
  crawlerFinished: boolean;
};

const workerEnvSchema = z.object({
  JOB_COMPASS_BROKER_BACKEND: z.enum(['local', 'gcp_pubsub']).default('local'),
  LOCAL_BROKER_DIR: z.string().trim().min(1),
  JOB_COMPASS_GCP_PROJECT_ID: z.string().trim().min(1).optional(),
  JOB_COMPASS_GCP_PUBSUB_TOPIC: z.string().trim().min(1).optional(),
  JOB_COMPASS_GCP_PUBSUB_SUBSCRIPTION_PREFIX: z.string().trim().min(1).optional(),
});

function buildInitialCounters(runtime: WorkerRuntime | null): RuntimeCounters {
  const counters = runtime?.counters ?? {};
  const processedEventIds = Array.isArray(counters.processedEventIds)
    ? counters.processedEventIds.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    processedEventIds,
    itemsProcessed: typeof counters.itemsProcessed === 'number' ? counters.itemsProcessed : 0,
    itemsFailed: typeof counters.itemsFailed === 'number' ? counters.itemsFailed : 0,
    itemsSkipped: typeof counters.itemsSkipped === 'number' ? counters.itemsSkipped : 0,
    crawlerFinished: counters.crawlerFinished === true,
  };
}

async function readWorkerRuntime(runtimePath: string): Promise<WorkerRuntime | null> {
  try {
    const raw = await readFile(runtimePath, 'utf8');
    return JSON.parse(raw) as WorkerRuntime;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function writeWorkerRuntime(runtimePath: string, runtime: WorkerRuntime): Promise<void> {
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
}

function getMongoDbName(manifest: RunManifest): string {
  return deriveMongoDbName({
    dbPrefix: process.env.JOB_COMPASS_DB_PREFIX ?? 'job-compass',
    searchSpaceId: manifest.searchSpaceSnapshot.id,
    explicitDbName: process.env.MONGODB_DB_NAME,
  });
}

function getBrokerTransportFromEnv(): BrokerTransportConfig {
  const parsedEnv = workerEnvSchema.parse({
    JOB_COMPASS_BROKER_BACKEND: process.env.JOB_COMPASS_BROKER_BACKEND,
    LOCAL_BROKER_DIR: process.env.LOCAL_BROKER_DIR,
    JOB_COMPASS_GCP_PROJECT_ID: process.env.JOB_COMPASS_GCP_PROJECT_ID,
    JOB_COMPASS_GCP_PUBSUB_TOPIC: process.env.JOB_COMPASS_GCP_PUBSUB_TOPIC,
    JOB_COMPASS_GCP_PUBSUB_SUBSCRIPTION_PREFIX:
      process.env.JOB_COMPASS_GCP_PUBSUB_SUBSCRIPTION_PREFIX,
  });

  if (parsedEnv.JOB_COMPASS_BROKER_BACKEND === 'gcp_pubsub') {
    if (!parsedEnv.JOB_COMPASS_GCP_PROJECT_ID || !parsedEnv.JOB_COMPASS_GCP_PUBSUB_TOPIC) {
      throw new Error(
        'JOB_COMPASS_BROKER_BACKEND=gcp_pubsub requires JOB_COMPASS_GCP_PROJECT_ID and JOB_COMPASS_GCP_PUBSUB_TOPIC.',
      );
    }

    return {
      type: 'gcp_pubsub',
      archiveRootDir: path.resolve(parsedEnv.LOCAL_BROKER_DIR),
      projectId: parsedEnv.JOB_COMPASS_GCP_PROJECT_ID,
      topicName: parsedEnv.JOB_COMPASS_GCP_PUBSUB_TOPIC,
      subscriptionNamePrefix: parsedEnv.JOB_COMPASS_GCP_PUBSUB_SUBSCRIPTION_PREFIX ?? undefined,
    };
  }

  return {
    type: 'local',
    archiveRootDir: path.resolve(parsedEnv.LOCAL_BROKER_DIR),
  };
}

function resolveRuntimeStatus(counters: RuntimeCounters): WorkerRuntime['status'] {
  if (counters.itemsFailed > 0 || counters.itemsSkipped > 0) {
    return 'completed_with_errors';
  }

  return 'succeeded';
}

async function publishLifecycleEvent(
  brokerTransport: BrokerTransportConfig,
  event: BrokerEvent,
): Promise<void> {
  await publishBrokerEvent({
    broker: brokerTransport,
    event: brokerEventSchema.parse(event),
  });
}

async function writeDownloadableJsonSinks(input: {
  manifest: RunManifest;
  sourceId: string;
  structuredParsed: unknown[];
  gcpProjectId?: string;
}): Promise<void> {
  if (input.structuredParsed.length === 0) {
    return;
  }

  await Promise.all(
    input.manifest.structuredOutputDestinationSnapshots
      .filter((destination) => destination.type === 'downloadable_json')
      .map(async (destination) =>
        writeStructuredJsonDocument({
          destination,
          crawlRunId: input.manifest.runId,
          sourceId: input.sourceId,
          document: input.structuredParsed[0],
          projectId: input.gcpProjectId,
        }),
      ),
  );
}

async function processDetailCapturedEvent(input: {
  manifest: RunManifest;
  brokerTransport: BrokerTransportConfig;
  event: Extract<BrokerEvent, { eventType: 'crawler.detail.captured' }>;
  counters: RuntimeCounters;
}): Promise<void> {
  const mongoDbName = getMongoDbName(input.manifest);
  await publishLifecycleEvent(input.brokerTransport, {
    eventId: `evt-${randomUUID()}`,
    eventType: 'ingestion.item.started',
    eventVersion: 'v1',
    occurredAt: nowIso(),
    runId: input.event.runId,
    correlationId: input.event.payload.dedupeKey,
    producer: 'jobs-ingestion-service-worker',
    payload: {
      crawlRunId: input.event.payload.crawlRunId,
      source: input.event.payload.source,
      sourceId: input.event.payload.sourceId,
      dedupeKey: input.event.payload.dedupeKey,
      reason: undefined,
    },
  });

  const result = await runIngestionRecordWorkflow({
    crawlRunId: input.event.payload.crawlRunId,
    searchSpaceId: input.event.payload.searchSpaceId,
    mongoDbNameOverride: mongoDbName,
    inputRecord: {
      datasetFileName: 'dataset.json',
      datasetRecordIndex: 0,
      listingRecord: input.event.payload.listingRecord,
      detailHtmlPath: input.event.payload.artifact.storagePath,
    },
  });

  input.counters.processedEventIds.push(input.event.eventId);
  input.counters.itemsProcessed += result.structuredParsed.length;
  input.counters.itemsSkipped += result.skippedIncomplete;
  input.counters.itemsFailed += result.failed;

  const gcpProjectId =
    input.brokerTransport.type === 'gcp_pubsub' ? input.brokerTransport.projectId : undefined;
  await writeDownloadableJsonSinks({
    manifest: input.manifest,
    sourceId: input.event.payload.sourceId,
    structuredParsed: result.structuredParsed,
    gcpProjectId,
  });

  const eventType =
    result.failed > 0
      ? 'ingestion.item.failed'
      : result.skippedIncomplete > 0
        ? 'ingestion.item.rejected'
        : 'ingestion.item.succeeded';

  await publishLifecycleEvent(input.brokerTransport, {
    eventId: `evt-${randomUUID()}`,
    eventType,
    eventVersion: 'v1',
    occurredAt: nowIso(),
    runId: input.event.runId,
    correlationId: input.event.payload.dedupeKey,
    producer: 'jobs-ingestion-service-worker',
    payload: {
      crawlRunId: input.event.payload.crawlRunId,
      source: input.event.payload.source,
      sourceId: input.event.payload.sourceId,
      dedupeKey: input.event.payload.dedupeKey,
      documentId:
        result.structuredParsed.length > 0 &&
        typeof (result.structuredParsed[0] as { id?: unknown }).id === 'string'
          ? (result.structuredParsed[0] as { id: string }).id
          : undefined,
      sinkResults: input.manifest.structuredOutputDestinationSnapshots.map((destination) => ({
        sinkType: destination.type,
        targetRef:
          destination.type === 'downloadable_json'
            ? destination.config.storageType === 'local_filesystem'
              ? destination.config.basePath
              : destination.config.bucket
            : destination.config.connectionUri || 'env:MONGODB_URI',
        writeMode: destination.type === 'mongodb' ? 'upsert' : 'overwrite',
      })),
      error:
        result.failed > 0
          ? {
              name: 'IngestionItemFailed',
              message: 'One or more ingestion item failures were recorded.',
            }
          : undefined,
      reason: result.skippedIncomplete > 0 ? 'skipped_incomplete' : undefined,
    },
  });
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      'run-manifest': { type: 'string' },
      'runtime-path': { type: 'string' },
      'broker-dir': { type: 'string' },
    },
    allowPositionals: false,
  });

  const runManifestPath = parsed.values['run-manifest'];
  const runtimePath = parsed.values['runtime-path'];
  const brokerRootDir = parsed.values['broker-dir'];

  if (!runManifestPath || !runtimePath || !brokerRootDir) {
    throw new Error('--run-manifest, --runtime-path, and --broker-dir are required.');
  }

  process.env.LOCAL_BROKER_DIR = path.resolve(brokerRootDir);

  const manifest = runManifestSchema.parse(
    JSON.parse(await readFile(path.resolve(runManifestPath), 'utf8')) as unknown,
  );
  const existingRuntime = await readWorkerRuntime(path.resolve(runtimePath));
  const counters = buildInitialCounters(existingRuntime);
  const brokerTransport = getBrokerTransportFromEnv();
  const brokerConsumer = await createBrokerRunConsumer({
    broker: brokerTransport,
    runId: manifest.runId,
  });

  try {
    await writeWorkerRuntime(path.resolve(runtimePath), {
      workerType: 'ingestion',
      status: 'running',
      startedAt: existingRuntime?.startedAt ?? nowIso(),
      lastHeartbeatAt: nowIso(),
      pid: process.pid,
      logPath: existingRuntime?.logPath,
      counters,
    });

    let idlePollsAfterCrawlerFinished = 0;

    while (true) {
      const events = await brokerConsumer.poll();
      const unseenEvents = events.filter(
        (event) => !counters.processedEventIds.includes(event.eventId),
      );

      for (const event of unseenEvents) {
        if (event.eventType === 'crawler.detail.captured') {
          await processDetailCapturedEvent({
            manifest,
            brokerTransport,
            event,
            counters,
          });
        } else if (event.eventType === 'crawler.run.finished') {
          counters.processedEventIds.push(event.eventId);
          counters.crawlerFinished = true;
        } else {
          counters.processedEventIds.push(event.eventId);
        }

        await writeWorkerRuntime(path.resolve(runtimePath), {
          workerType: 'ingestion',
          status: 'running',
          startedAt: existingRuntime?.startedAt ?? nowIso(),
          lastHeartbeatAt: nowIso(),
          pid: process.pid,
          logPath: existingRuntime?.logPath,
          counters,
        });
      }

      if (counters.crawlerFinished && unseenEvents.length === 0) {
        idlePollsAfterCrawlerFinished += 1;
        if (idlePollsAfterCrawlerFinished >= 2) {
          break;
        }
      } else {
        idlePollsAfterCrawlerFinished = 0;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await writeWorkerRuntime(path.resolve(runtimePath), {
      workerType: 'ingestion',
      status: resolveRuntimeStatus(counters),
      startedAt: existingRuntime?.startedAt ?? nowIso(),
      finishedAt: nowIso(),
      lastHeartbeatAt: nowIso(),
      pid: process.pid,
      logPath: existingRuntime?.logPath,
      exitCode: 0,
      counters,
    });
  } finally {
    await brokerConsumer.close();
  }
}

void main().catch(async (error) => {
  const runtimePathIndex = process.argv.findIndex((value) => value === '--runtime-path');
  const runtimePath =
    runtimePathIndex >= 0 && runtimePathIndex + 1 < process.argv.length
      ? process.argv[runtimePathIndex + 1]
      : undefined;

  if (runtimePath) {
    const existingRuntime = await readWorkerRuntime(path.resolve(runtimePath)).catch(() => null);
    await writeWorkerRuntime(path.resolve(runtimePath), {
      workerType: 'ingestion',
      status: 'failed',
      startedAt: existingRuntime?.startedAt ?? nowIso(),
      finishedAt: nowIso(),
      lastHeartbeatAt: nowIso(),
      pid: process.pid,
      logPath: existingRuntime?.logPath,
      errorMessage: error instanceof Error ? error.message : 'Unknown ingestion worker error.',
      exitCode: 1,
      counters: existingRuntime?.counters ?? {},
    }).catch(() => undefined);
  }

  throw error;
});
