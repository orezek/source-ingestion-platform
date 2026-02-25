import { access } from 'node:fs/promises';
import path from 'node:path';

import Fastify from 'fastify';
import { MongoClient } from 'mongodb';
import { z } from 'zod';

import { appRootDir, envs, inputRootDir, logger, runIngestionWorkflow } from './app.js';

const triggerRequestSchema = z.object({
  source: z.string().min(1),
  crawlRunId: z.string().min(1),
});

type TriggerRequest = z.infer<typeof triggerRequestSchema>;

type IngestionTriggerStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'completed_with_errors'
  | 'failed';

type IngestionTriggerDoc = {
  id: string;
  source: string;
  crawlRunId: string;
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

const triggerDocId = (source: string, crawlRunId: string): string => `${source}:${crawlRunId}`;

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
  collectionName: string,
): Promise<void> => {
  const collection = mongoClient
    .db(envs.MONGODB_DB_NAME)
    .collection<IngestionTriggerDoc>(collectionName);
  await collection.createIndex(
    { source: 1, crawlRunId: 1 },
    { unique: true, name: 'source_crawlRunId_unique' },
  );
  await collection.createIndex({ status: 1, updatedAt: -1 }, { name: 'status_updatedAt' });
};

const getTriggerCollection = (mongoClient: MongoClient) =>
  mongoClient
    .db(envs.MONGODB_DB_NAME)
    .collection<IngestionTriggerDoc>(envs.MONGODB_INGESTION_TRIGGERS_COLLECTION);

const seedTriggerDoc = async (mongoClient: MongoClient, trigger: TriggerRequest): Promise<void> => {
  const nowIso = new Date().toISOString();
  const id = triggerDocId(trigger.source, trigger.crawlRunId);
  const collection = getTriggerCollection(mongoClient);

  await collection.updateOne(
    { id },
    {
      $setOnInsert: {
        id,
        source: trigger.source,
        crawlRunId: trigger.crawlRunId,
        status: 'pending' satisfies IngestionTriggerStatus,
        requestedAt: nowIso,
        updatedAt: nowIso,
        attemptCount: 0,
      },
    },
    { upsert: true },
  );
};

const claimTrigger = async (
  mongoClient: MongoClient,
  trigger: TriggerRequest,
): Promise<
  { claimed: true; doc: IngestionTriggerDoc } | { claimed: false; doc: IngestionTriggerDoc | null }
> => {
  const nowIso = new Date().toISOString();
  const id = triggerDocId(trigger.source, trigger.crawlRunId);
  const collection = getTriggerCollection(mongoClient);

  await seedTriggerDoc(mongoClient, trigger);

  const claimed = await collection.findOneAndUpdate(
    { id, status: { $in: ['pending', 'failed'] } },
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

  const existing = await collection.findOne({ id });
  return { claimed: false, doc: existing };
};

const updateTriggerSuccess = async (
  mongoClient: MongoClient,
  trigger: TriggerRequest,
  inputRunDir: string,
  outputJsonPath: string,
  result: Awaited<ReturnType<typeof runIngestionWorkflow>>,
): Promise<void> => {
  const collection = getTriggerCollection(mongoClient);
  const nowIso = new Date().toISOString();
  const id = triggerDocId(trigger.source, trigger.crawlRunId);

  await collection.updateOne(
    { id },
    {
      $set: {
        status: result.status,
        completedAt: nowIso,
        updatedAt: nowIso,
        ingestionRunId: result.runId,
        inputRunDir,
        outputJsonPath,
        result: {
          jobsProcessed: result.structuredParsed.length,
          jobsSkippedIncomplete: result.skippedIncomplete,
          jobsFailed: result.failed,
          totalTokensUsed: result.stats.totalTokens,
          totalEstimatedCostUsd: result.stats.totalEstimatedCostUsd,
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
  mongoClient: MongoClient,
  trigger: TriggerRequest,
  inputRunDir: string,
  error: unknown,
): Promise<void> => {
  const collection = getTriggerCollection(mongoClient);
  const nowIso = new Date().toISOString();
  const id = triggerDocId(trigger.source, trigger.crawlRunId);
  const normalizedError = error instanceof Error ? error : new Error(String(error));

  await collection.updateOne(
    { id },
    {
      $set: {
        status: 'failed' satisfies IngestionTriggerStatus,
        completedAt: nowIso,
        updatedAt: nowIso,
        inputRunDir,
        errorMessage: normalizedError.message,
        errorStack: normalizedError.stack,
      },
      $unset: {
        result: 1,
      },
    },
  );
};

const runTriggerInBackground = async (
  mongoClient: MongoClient,
  trigger: TriggerRequest,
): Promise<void> => {
  const inputRunDir = resolveTriggerInputRunDir(trigger.crawlRunId);
  const triggerLogger = logger.child({
    component: 'IngestionApiTrigger',
    source: trigger.source,
    crawlRunId: trigger.crawlRunId,
  });

  try {
    await access(inputRunDir);
  } catch {
    throw new Error(`Crawl run input directory not found: ${inputRunDir}`);
  }

  const outputPath = resolveTriggerOutputJsonPath(trigger.crawlRunId);

  triggerLogger.info({ inputRunDir, outputPath }, 'Starting ingestion run for crawl trigger');
  const result = await runIngestionWorkflow({
    inputRootDirOverride: inputRunDir,
    recordsDirNameOverride: envs.INPUT_RECORDS_DIR_NAME,
    sampleSizeOverride: null,
    outputJsonPathOverride: outputPath,
  });
  await updateTriggerSuccess(mongoClient, trigger, inputRunDir, outputPath, result);
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
    'Completed ingestion run for crawl trigger',
  );
};

async function main(): Promise<void> {
  const mongoUri = getRequiredMongoUri();

  const apiLogger = logger.child({ component: 'IngestionApi' });
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  await ensureTriggerIndexes(mongoClient, envs.MONGODB_INGESTION_TRIGGERS_COLLECTION);

  const server = Fastify({ logger: false });

  server.get('/health', async () => ({ ok: true }));

  server.post('/ingestion/start', async (request, reply) => {
    const parsed = triggerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: 'Invalid request body',
        issues: parsed.error.issues,
      };
    }

    const trigger = parsed.data;
    const id = triggerDocId(trigger.source, trigger.crawlRunId);
    const triggerLogger = apiLogger.child({
      source: trigger.source,
      crawlRunId: trigger.crawlRunId,
    });

    const runningPromise = runningTriggers.get(id);
    if (runningPromise) {
      const existing = await getTriggerCollection(mongoClient).findOne({ id });
      reply.code(202);
      return {
        ok: true,
        accepted: true,
        deduplicated: true,
        trigger: existing,
      };
    }

    const claimResult = await claimTrigger(mongoClient, trigger);
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
        await runTriggerInBackground(mongoClient, trigger);
      } catch (error) {
        const inputRunDir = resolveTriggerInputRunDir(trigger.crawlRunId);
        await updateTriggerFailure(mongoClient, trigger, inputRunDir, error);
        triggerLogger.error({ err: error, inputRunDir }, 'Triggered ingestion run failed');
      } finally {
        runningTriggers.delete(id);
      }
    })();

    runningTriggers.set(id, backgroundPromise);

    reply.code(202);
    return {
      ok: true,
      accepted: true,
      deduplicated: false,
      trigger: claimResult.doc,
    };
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
      mongoDbName: envs.MONGODB_DB_NAME,
      mongoTriggersCollection: envs.MONGODB_INGESTION_TRIGGERS_COLLECTION,
    },
    'Ingestion Fastify API listening',
  );
}

void main().catch((error) => {
  logger.fatal({ err: error }, 'Unhandled fatal error in ingestion API server');
  process.exitCode = 1;
});
