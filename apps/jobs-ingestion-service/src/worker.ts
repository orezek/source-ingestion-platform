import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import {
  brokerEventSchema,
  buildStructuredJsonFileName,
  buildStructuredRunDir,
  nowIso,
  readBrokerEvents,
  runManifestSchema,
  writeBrokerEvent,
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

function getLocalJsonSinkRoots(manifest: RunManifest): string[] {
  return manifest.structuredOutputDestinationSnapshots.flatMap((destination) =>
    destination.type === 'local_json' && 'basePath' in destination.config
      ? [path.resolve(destination.config.basePath)]
      : [],
  );
}

function getMongoDbName(manifest: RunManifest): string {
  return deriveMongoDbName({
    dbPrefix: process.env.JOB_COMPASS_DB_PREFIX ?? 'job-compass',
    searchSpaceId: manifest.searchSpaceSnapshot.id,
    explicitDbName: process.env.MONGODB_DB_NAME,
  });
}

function resolveRuntimeStatus(counters: RuntimeCounters): WorkerRuntime['status'] {
  if (counters.itemsFailed > 0 || counters.itemsSkipped > 0) {
    return 'completed_with_errors';
  }

  return 'succeeded';
}

async function publishLifecycleEvent(brokerRootDir: string, event: BrokerEvent): Promise<void> {
  await writeBrokerEvent(brokerRootDir, brokerEventSchema.parse(event));
}

async function writeLocalJsonSinks(input: {
  manifest: RunManifest;
  sourceId: string;
  structuredParsed: unknown[];
}): Promise<void> {
  if (input.structuredParsed.length === 0) {
    return;
  }

  await Promise.all(
    getLocalJsonSinkRoots(input.manifest).map(async (rootDir) => {
      const runDir = buildStructuredRunDir(rootDir, input.manifest.runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(
        path.join(runDir, buildStructuredJsonFileName(input.sourceId)),
        `${JSON.stringify(input.structuredParsed[0], null, 2)}\n`,
        'utf8',
      );
    }),
  );
}

async function processDetailCapturedEvent(input: {
  manifest: RunManifest;
  brokerRootDir: string;
  event: Extract<BrokerEvent, { eventType: 'crawler.detail.captured' }>;
  counters: RuntimeCounters;
}): Promise<void> {
  const mongoDbName = getMongoDbName(input.manifest);
  await publishLifecycleEvent(input.brokerRootDir, {
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

  await writeLocalJsonSinks({
    manifest: input.manifest,
    sourceId: input.event.payload.sourceId,
    structuredParsed: result.structuredParsed,
  });

  const eventType =
    result.failed > 0
      ? 'ingestion.item.failed'
      : result.skippedIncomplete > 0
        ? 'ingestion.item.rejected'
        : 'ingestion.item.succeeded';

  await publishLifecycleEvent(input.brokerRootDir, {
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
          destination.type === 'local_json' && 'basePath' in destination.config
            ? destination.config.basePath
            : destination.type === 'mongodb' && 'collectionName' in destination.config
              ? destination.config.collectionName
              : destination.type === 'gcs_json' && 'bucket' in destination.config
                ? destination.config.bucket
                : destination.id,
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

  const manifest = runManifestSchema.parse(
    JSON.parse(await readFile(path.resolve(runManifestPath), 'utf8')) as unknown,
  );
  const existingRuntime = await readWorkerRuntime(path.resolve(runtimePath));
  const counters = buildInitialCounters(existingRuntime);

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
    const events = await readBrokerEvents(path.resolve(brokerRootDir), manifest.runId);
    const unseenEvents = events.filter(
      (event) => !counters.processedEventIds.includes(event.eventId),
    );

    for (const event of unseenEvents) {
      if (event.eventType === 'crawler.detail.captured') {
        await processDetailCapturedEvent({
          manifest,
          brokerRootDir: path.resolve(brokerRootDir),
          event,
          counters,
        });
      } else if (event.eventType === 'crawler.run.finished') {
        counters.processedEventIds.push(event.eventId);
        counters.crawlerFinished = true;
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
}

void main().catch(async (error) => {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      'runtime-path': { type: 'string' },
    },
    allowPositionals: false,
  });
  const runtimePath = parsed.values['runtime-path'];

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
