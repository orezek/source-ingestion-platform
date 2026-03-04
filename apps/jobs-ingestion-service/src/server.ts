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
import {
  buildItemTriggerDoc,
  buildRunTriggerDoc,
  claimTrigger,
  ensureTriggerIndexes,
  getTriggerCollection,
  type IngestionTriggerDoc,
  updateTriggerFailure,
  updateTriggerSuccess,
} from './trigger-store.js';

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

const runningTriggers = new Map<string, Promise<void>>();

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
      await ensureTriggerIndexes(mongoClient, trigger.mongoDbName);
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
      await ensureTriggerIndexes(mongoClient, trigger.mongoDbName);
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
