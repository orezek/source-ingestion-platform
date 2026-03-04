import { MongoClient, type Collection } from 'mongodb';

import { envs } from './app.js';
import type { SourceListingRecord } from './schema.js';

export type RunTriggerRequest = {
  source: string;
  crawlRunId: string;
  searchSpaceId: string;
  mongoDbName: string;
};

export type ItemTriggerRequest = {
  source: string;
  crawlRunId: string;
  searchSpaceId: string;
  mongoDbName: string;
  listingRecord: SourceListingRecord;
  detailHtmlPath: string;
  datasetFileName: string;
  datasetRecordIndex: number;
};

export type IngestionTriggerStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'completed_with_errors'
  | 'failed';

export type IngestionTriggerDoc = {
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

export const runTriggerDocId = (
  source: string,
  crawlRunId: string,
  searchSpaceId: string,
): string => `run:${source}:${searchSpaceId}:${crawlRunId}`;

export const itemTriggerDocId = (
  source: string,
  crawlRunId: string,
  searchSpaceId: string,
  sourceId: string,
): string => `item:${source}:${searchSpaceId}:${crawlRunId}:${sourceId}`;

export function getTriggerCollection(
  mongoClient: MongoClient,
  dbName: string,
): Collection<IngestionTriggerDoc> {
  return mongoClient
    .db(dbName)
    .collection<IngestionTriggerDoc>(envs.MONGODB_INGESTION_TRIGGERS_COLLECTION);
}

export async function ensureTriggerIndexes(
  mongoClient: MongoClient,
  dbName: string,
): Promise<Collection<IngestionTriggerDoc>> {
  const collection = getTriggerCollection(mongoClient, dbName);
  try {
    await collection.dropIndex('source_crawlRunId_unique');
  } catch {
    // Legacy index may not exist.
  }

  await collection.createIndex({ id: 1 }, { unique: true, name: 'id_unique' });
  await collection.createIndex({ status: 1, updatedAt: -1 }, { name: 'status_updatedAt' });
  return collection;
}

export function buildRunTriggerDoc(trigger: RunTriggerRequest): IngestionTriggerDoc {
  const requestedAt = new Date().toISOString();
  return {
    id: runTriggerDocId(trigger.source, trigger.crawlRunId, trigger.searchSpaceId),
    triggerType: 'run',
    source: trigger.source,
    crawlRunId: trigger.crawlRunId,
    searchSpaceId: trigger.searchSpaceId,
    mongoDbName: trigger.mongoDbName,
    status: 'pending',
    requestedAt,
    updatedAt: requestedAt,
    attemptCount: 0,
  };
}

export function buildItemTriggerDoc(trigger: ItemTriggerRequest): IngestionTriggerDoc {
  const requestedAt = new Date().toISOString();
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
    requestedAt,
    updatedAt: requestedAt,
    attemptCount: 0,
  };
}

export async function seedTriggerDoc(
  collection: Collection<IngestionTriggerDoc>,
  triggerDoc: IngestionTriggerDoc,
): Promise<void> {
  await collection.updateOne(
    { id: triggerDoc.id },
    {
      $setOnInsert: triggerDoc,
    },
    { upsert: true },
  );
}

export async function claimTrigger(
  collection: Collection<IngestionTriggerDoc>,
  triggerDoc: IngestionTriggerDoc,
): Promise<
  { claimed: true; doc: IngestionTriggerDoc } | { claimed: false; doc: IngestionTriggerDoc | null }
> {
  await seedTriggerDoc(collection, triggerDoc);

  const startedAt = new Date().toISOString();
  const claimed = await collection.findOneAndUpdate(
    { id: triggerDoc.id, status: { $in: ['pending', 'failed'] } },
    {
      $set: {
        status: 'running' satisfies IngestionTriggerStatus,
        startedAt,
        updatedAt: startedAt,
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

  return { claimed: false, doc: await collection.findOne({ id: triggerDoc.id }) };
}

export async function updateTriggerSuccess(
  collection: Collection<IngestionTriggerDoc>,
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
): Promise<void> {
  const completedAt = new Date().toISOString();
  await collection.updateOne(
    { id: triggerDoc.id },
    {
      $set: {
        status: result.status,
        completedAt,
        updatedAt: completedAt,
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
}

export async function updateTriggerFailure(
  collection: Collection<IngestionTriggerDoc>,
  triggerDoc: IngestionTriggerDoc,
  error: unknown,
): Promise<void> {
  const completedAt = new Date().toISOString();
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  await collection.updateOne(
    { id: triggerDoc.id },
    {
      $set: {
        status: 'failed' satisfies IngestionTriggerStatus,
        completedAt,
        updatedAt: completedAt,
        errorMessage: normalizedError.message,
        errorStack: normalizedError.stack,
      },
      $unset: {
        result: 1,
      },
    },
  );
}
