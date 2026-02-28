import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import Fastify from 'fastify';
import { MongoClient } from 'mongodb';
import { searchSpaceIdSchema } from '@repo/job-search-spaces';
import { z } from 'zod';

import {
  appRootDir,
  envs,
  inputRootDir,
  logger,
  runIngestionRecordWorkflow,
  runIngestionWorkflow,
} from './app.js';
import { sourceListingRecordSchema } from './schema.js';

const runTriggerRequestSchema = z.object({
  source: z.string().min(1),
  crawlRunId: z.string().min(1),
  searchSpaceId: searchSpaceIdSchema,
  mongoDbName: z.string().min(1),
});

const itemTriggerRequestSchema = z.object({
  source: z.string().min(1),
  crawlRunId: z.string().min(1),
  searchSpaceId: searchSpaceIdSchema,
  mongoDbName: z.string().min(1),
  listingRecord: sourceListingRecordSchema,
  detailHtmlPath: z.string().min(1),
  datasetFileName: z.string().default('dataset.json'),
  datasetRecordIndex: z.number().int().nonnegative(),
});

type RunTriggerRequest = z.infer<typeof runTriggerRequestSchema>;
type ItemTriggerRequest = z.infer<typeof itemTriggerRequestSchema>;

type IngestionTriggerStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'completed_with_errors'
  | 'failed';

type IngestionTriggerDoc = {
  id: string;
  triggerType: 'run' | 'item';
  source: string;
  crawlRunId: string;
  searchSpaceId: string;
  mongoDbName: string;
  sourceId?: string;
  detailHtmlPath?: string;
  datasetFileName?: string;
  datasetRecordIndex?: number;
  status: IngestionTriggerStatus;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  attemptCount: number;
  ingestionRunId?: string;
  inputRunDir?: string;
  outputJsonPath?: string;
  errorMessage?: string;
  errorStack?: string;
  result?: {
    jobsProcessed: number;
    jobsSkippedIncomplete: number;
    jobsFailed: number;
    totalTokensUsed: number;
    totalEstimatedCostUsd: number;
    mongoWritesStructured: number;
    mongoWritesRunSummary: number;
  };
};

const runningTriggers = new Map<string, Promise<void>>();

const runTriggerDocId = (source: string, crawlRunId: string, searchSpaceId: string): string =>
  `run:${source}:${searchSpaceId}:${crawlRunId}`;

const itemTriggerDocId = (
  source: string,
  crawlRunId: string,
  searchSpaceId: string,
  sourceId: string,
): string => `item:${source}:${searchSpaceId}:${crawlRunId}:${sourceId}`;

const resolveTriggerInputRunDir = (crawlRunId: string): string =>
  path.join(inputRootDir, envs.CRAWL_RUNS_SUBDIR, crawlRunId);

const resolveTriggerOutputJsonPath = (crawlRunId: string): string =>
  path.join(appRootDir, 'output', 'runs', `normalized-jobs-${crawlRunId}.json`);

const getRequiredMongoUri = (): string => {
  if (!envs.ENABLE_MONGO_WRITE) {
    throw new Error(
      'Fastify ingestion API requires ENABLE_MONGO_WRITE=true for idempotency and persistence.',
    );
  }

  if (!envs.MONGODB_URI) {
    throw new Error('Fastify ingestion API requires MONGODB_URI to be configured.');
  }

  return envs.MONGODB_URI;
};

const ensureTriggerIndexes = async (
  mongoClient: MongoClient,
  dbName: string,
  collectionName: string,
): Promise<void> => {
  const collection = mongoClient.db(dbName).collection<IngestionTriggerDoc>(collectionName);
  try {
    await collection.dropIndex('source_crawlRunId_unique');
  } catch {
    // legacy index may not exist
  }
  await collection.createIndex({ id: 1 }, { unique: true, name: 'id_unique' });
  await collection.createIndex({ status: 1, updatedAt: -1 }, { name: 'status_updatedAt' });
};

const getTriggerCollection = (mongoClient: MongoClient, dbName: string) =>
  mongoClient
    .db(dbName)
    .collection<IngestionTriggerDoc>(envs.MONGODB_INGESTION_TRIGGERS_COLLECTION);

const buildRunTriggerDoc = (trigger: RunTriggerRequest): IngestionTriggerDoc => {
  const nowIso = new Date().toISOString();
  return {
    id: runTriggerDocId(trigger.source, trigger.crawlRunId, trigger.searchSpaceId),
    triggerType: 'run',
    source: trigger.source,
    crawlRunId: trigger.crawlRunId,
    searchSpaceId: trigger.searchSpaceId,
    mongoDbName: trigger.mongoDbName,
    status: 'pending',
    requestedAt: nowIso,
    updatedAt: nowIso,
    attemptCount: 0,
  };
};

const buildItemTriggerDoc = (trigger: ItemTriggerRequest): IngestionTriggerDoc => {
  const nowIso = new Date().toISOString();
  return {
    id: itemTriggerDocId(
      trigger.source,
      trigger.crawlRunId,
      trigger.searchSpaceId,
      trigger.listingRecord.sourceId,
    ),
    triggerType: 'item',
    source: trigger.source,
    crawlRunId: trigger.crawlRunId,
    searchSpaceId: trigger.searchSpaceId,
    mongoDbName: trigger.mongoDbName,
    sourceId: trigger.listingRecord.sourceId,
    detailHtmlPath: trigger.detailHtmlPath,
    datasetFileName: trigger.datasetFileName,
    datasetRecordIndex: trigger.datasetRecordIndex,
    status: 'pending',
    requestedAt: nowIso,
    updatedAt: nowIso,
    attemptCount: 0,
  };
};

const seedTriggerDoc = async (
  collection: ReturnType<typeof getTriggerCollection>,
  triggerDoc: IngestionTriggerDoc,
): Promise<void> => {
  await collection.updateOne(
    { id: triggerDoc.id },
    {
      $setOnInsert: triggerDoc,
    },
    { upsert: true },
  );
};

const claimTrigger = async (
  collection: ReturnType<typeof getTriggerCollection>,
  triggerDoc: IngestionTriggerDoc,
): Promise<
  { claimed: true; doc: IngestionTriggerDoc } | { claimed: false; doc: IngestionTriggerDoc | null }
> => {
  await seedTriggerDoc(collection, triggerDoc);

  const nowIso = new Date().toISOString();
  const claimed = await collection.findOneAndUpdate(
    { id: triggerDoc.id, status: { $in: ['pending', 'failed'] } },
    {
      $set: {
        status: 'running' satisfies IngestionTriggerStatus,
        startedAt: nowIso,
        updatedAt: nowIso,
      },
      $inc: { attemptCount: 1 },
      $unset: {
        completedAt: 1,
        result: 1,
        errorMessage: 1,
        errorStack: 1,
      },
    },
    { returnDocument: 'after' },
  );

  if (claimed) {
    return { claimed: true, doc: claimed };
  }

  const existing = await collection.findOne({ id: triggerDoc.id });
  return { claimed: false, doc: existing };
};

const updateTriggerSuccess = async (
  collection: ReturnType<typeof getTriggerCollection>,
  triggerDoc: IngestionTriggerDoc,
  result: {
    status: IngestionTriggerStatus;
    ingestionRunId: string;
    inputRunDir?: string;
    outputJsonPath?: string;
    jobsProcessed: number;
    jobsSkippedIncomplete: number;
    jobsFailed: number;
    totalTokensUsed: number;
    totalEstimatedCostUsd: number;
    mongoWritesStructured: number;
    mongoWritesRunSummary: number;
  },
): Promise<void> => {
  const nowIso = new Date().toISOString();
  await collection.updateOne(
    { id: triggerDoc.id },
    {
      $set: {
        status: result.status,
        completedAt: nowIso,
        updatedAt: nowIso,
        ingestionRunId: result.ingestionRunId,
        inputRunDir: result.inputRunDir,
        outputJsonPath: result.outputJsonPath,
        result: {
          jobsProcessed: result.jobsProcessed,
          jobsSkippedIncomplete: result.jobsSkippedIncomplete,
          jobsFailed: result.jobsFailed,
          totalTokensUsed: result.totalTokensUsed,
          totalEstimatedCostUsd: result.totalEstimatedCostUsd,
          mongoWritesStructured: result.mongoWritesStructured,
          mongoWritesRunSummary: result.mongoWritesRunSummary,
        },
      },
      $unset: {
        errorMessage: 1,
        errorStack: 1,
      },
    },
  );
};

const updateTriggerFailure = async (
  collection: ReturnType<typeof getTriggerCollection>,
  triggerDoc: IngestionTriggerDoc,
  error: unknown,
): Promise<void> => {
  const nowIso = new Date().toISOString();
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  await collection.updateOne(
    { id: triggerDoc.id },
    {
      $set: {
        status: 'failed' satisfies IngestionTriggerStatus,
        completedAt: nowIso,
        updatedAt: nowIso,
        errorMessage: normalizedError.message,
        errorStack: normalizedError.stack,
      },
      $unset: {
        result: 1,
      },
    },
  );
};

const runRunTriggerInBackground = async (
  collection: ReturnType<typeof getTriggerCollection>,
  trigger: RunTriggerRequest,
  triggerDoc: IngestionTriggerDoc,
): Promise<void> => {
  const inputRunDir = resolveTriggerInputRunDir(trigger.crawlRunId);
  const outputJsonPath = resolveTriggerOutputJsonPath(trigger.crawlRunId);
  const triggerLogger = logger.child({
    component: 'IngestionApiRunTrigger',
    source: trigger.source,
    crawlRunId: trigger.crawlRunId,
    searchSpaceId: trigger.searchSpaceId,
    mongoDbName: trigger.mongoDbName,
  });

  await access(inputRunDir);

  const result = await runIngestionWorkflow({
    crawlRunId: trigger.crawlRunId,
    searchSpaceId: trigger.searchSpaceId,
    mongoDbNameOverride: trigger.mongoDbName,
    inputRootDirOverride: inputRunDir,
    recordsDirNameOverride: envs.INPUT_RECORDS_DIR_NAME,
    sampleSizeOverride: null,
    outputJsonPathOverride: outputJsonPath,
  });

  await updateTriggerSuccess(collection, triggerDoc, {
    status: result.status,
    ingestionRunId: result.runId,
    inputRunDir,
    outputJsonPath,
    jobsProcessed: result.structuredParsed.length,
    jobsSkippedIncomplete: result.skippedIncomplete,
    jobsFailed: result.failed,
    totalTokensUsed: result.stats.totalTokens,
    totalEstimatedCostUsd: result.stats.totalEstimatedCostUsd,
    mongoWritesStructured: result.mongoWritesStructured,
    mongoWritesRunSummary: result.mongoWritesRunSummary,
  });

  triggerLogger.info(
    {
      ingestionRunId: result.runId,
      status: result.status,
      jobsProcessed: result.structuredParsed.length,
      jobsSkippedIncomplete: result.skippedIncomplete,
      jobsFailed: result.failed,
      totalTokensUsed: result.stats.totalTokens,
      totalEstimatedCostUsd: result.stats.totalEstimatedCostUsd,
    },
    'Completed ingestion run trigger',
  );
};

const runItemTriggerInBackground = async (
  collection: ReturnType<typeof getTriggerCollection>,
  trigger: ItemTriggerRequest,
  triggerDoc: IngestionTriggerDoc,
): Promise<void> => {
  const triggerLogger = logger.child({
    component: 'IngestionApiItemTrigger',
    source: trigger.source,
    crawlRunId: trigger.crawlRunId,
    searchSpaceId: trigger.searchSpaceId,
    mongoDbName: trigger.mongoDbName,
    sourceId: trigger.listingRecord.sourceId,
  });

  await access(trigger.detailHtmlPath);

  const result = await runIngestionRecordWorkflow({
    crawlRunId: trigger.crawlRunId,
    searchSpaceId: trigger.searchSpaceId,
    mongoDbNameOverride: trigger.mongoDbName,
    inputRecord: {
      datasetFileName: trigger.datasetFileName,
      datasetRecordIndex: trigger.datasetRecordIndex,
      listingRecord: trigger.listingRecord,
      detailHtmlPath: trigger.detailHtmlPath,
    },
  });

  await updateTriggerSuccess(collection, triggerDoc, {
    status: result.status,
    ingestionRunId: result.runId,
    jobsProcessed: result.structuredParsed.length,
    jobsSkippedIncomplete: result.skippedIncomplete,
    jobsFailed: result.failed,
    totalTokensUsed: result.stats.totalTokens,
    totalEstimatedCostUsd: result.stats.totalEstimatedCostUsd,
    mongoWritesStructured: result.mongoWritesStructured,
    mongoWritesRunSummary: result.mongoWritesRunSummary,
  });

  triggerLogger.info(
    {
      ingestionRunId: result.runId,
      status: result.status,
      jobsProcessed: result.structuredParsed.length,
      jobsSkippedIncomplete: result.skippedIncomplete,
      jobsFailed: result.failed,
      totalTokensUsed: result.stats.totalTokens,
      totalEstimatedCostUsd: result.stats.totalEstimatedCostUsd,
    },
    'Completed ingestion item trigger',
  );
};

async function main(): Promise<void> {
  const mongoUri = getRequiredMongoUri();
  const apiLogger = logger.child({ component: 'IngestionApi' });
  const mongoClient = new MongoClient(mongoUri);
  const server = Fastify({ logger: false });
  let mongoConnected = false;

  try {
    await mongoClient.connect();
    mongoConnected = true;

    server.get('/health', async () => ({ ok: true }));

    server.post('/ingestion/start', async (request, reply) => {
      const parsed = runTriggerRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: 'Invalid request body', issues: parsed.error.issues };
      }

      const trigger = parsed.data;
      await ensureTriggerIndexes(
        mongoClient,
        trigger.mongoDbName,
        envs.MONGODB_INGESTION_TRIGGERS_COLLECTION,
      );
      const collection = getTriggerCollection(mongoClient, trigger.mongoDbName);
      const triggerDoc = buildRunTriggerDoc(trigger);
      const runningPromise = runningTriggers.get(triggerDoc.id);

      if (runningPromise) {
        const existing = await collection.findOne({ id: triggerDoc.id });
        reply.code(202);
        return { ok: true, accepted: true, deduplicated: true, trigger: existing };
      }

      const claimResult = await claimTrigger(collection, triggerDoc);
      if (!claimResult.claimed) {
        reply.code(claimResult.doc?.status === 'running' ? 202 : 200);
        return {
          ok: true,
          accepted: claimResult.doc?.status === 'running',
          deduplicated: true,
          trigger: claimResult.doc,
        };
      }

      const backgroundPromise = (async () => {
        try {
          await runRunTriggerInBackground(collection, trigger, triggerDoc);
        } catch (error) {
          await updateTriggerFailure(collection, triggerDoc, error);
          apiLogger.error(
            { err: error, triggerType: 'run', triggerId: triggerDoc.id },
            'Run trigger failed',
          );
        } finally {
          runningTriggers.delete(triggerDoc.id);
        }
      })();

      runningTriggers.set(triggerDoc.id, backgroundPromise);
      reply.code(202);
      return { ok: true, accepted: true, deduplicated: false, trigger: claimResult.doc };
    });

    server.post('/ingestion/item', async (request, reply) => {
      const parsed = itemTriggerRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: 'Invalid request body', issues: parsed.error.issues };
      }

      const trigger = parsed.data;
      await ensureTriggerIndexes(
        mongoClient,
        trigger.mongoDbName,
        envs.MONGODB_INGESTION_TRIGGERS_COLLECTION,
      );
      const collection = getTriggerCollection(mongoClient, trigger.mongoDbName);
      const triggerDoc = buildItemTriggerDoc(trigger);
      const runningPromise = runningTriggers.get(triggerDoc.id);

      if (runningPromise) {
        const existing = await collection.findOne({ id: triggerDoc.id });
        reply.code(202);
        return { ok: true, accepted: true, deduplicated: true, trigger: existing };
      }

      const claimResult = await claimTrigger(collection, triggerDoc);
      if (!claimResult.claimed) {
        reply.code(claimResult.doc?.status === 'running' ? 202 : 200);
        return {
          ok: true,
          accepted: claimResult.doc?.status === 'running',
          deduplicated: true,
          trigger: claimResult.doc,
        };
      }

      const backgroundPromise = (async () => {
        try {
          await runItemTriggerInBackground(collection, trigger, triggerDoc);
        } catch (error) {
          await updateTriggerFailure(collection, triggerDoc, error);
          apiLogger.error(
            { err: error, triggerType: 'item', triggerId: triggerDoc.id },
            'Item trigger failed',
          );
        } finally {
          runningTriggers.delete(triggerDoc.id);
        }
      })();

      runningTriggers.set(triggerDoc.id, backgroundPromise);
      reply.code(202);
      return { ok: true, accepted: true, deduplicated: false, trigger: claimResult.doc };
    });

    server.addHook('onClose', async () => {
      await mongoClient.close();
    });

    const address = await server.listen({
      host: envs.INGESTION_API_HOST,
      port: envs.INGESTION_API_PORT,
    });
    apiLogger.info(
      {
        address,
        host: envs.INGESTION_API_HOST,
        port: envs.INGESTION_API_PORT,
        crawlRunsSubdir: envs.CRAWL_RUNS_SUBDIR,
        mongoDbNameDefault: envs.MONGODB_DB_NAME,
        mongoTriggersCollection: envs.MONGODB_INGESTION_TRIGGERS_COLLECTION,
      },
      'Ingestion Fastify API listening',
    );
  } catch (error) {
    try {
      await server.close();
    } catch {
      // ignore startup cleanup errors
    }

    if (mongoConnected) {
      try {
        await mongoClient.close();
      } catch {
        // ignore startup cleanup errors
      }
    }

    throw error;
  }
}

void main().catch((error) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EADDRINUSE'
  ) {
    logger.fatal(
      {
        err: error,
        host: envs.INGESTION_API_HOST,
        port: envs.INGESTION_API_PORT,
      },
      'Ingestion API port is already in use',
    );
  } else {
    logger.fatal({ err: error }, 'Unhandled fatal error in ingestion API server');
  }

  process.exit(1);
});
