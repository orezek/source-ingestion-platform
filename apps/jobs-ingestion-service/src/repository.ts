import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { MongoClient } from 'mongodb';

import type { AppLogger } from './logger.js';

export const writeOutputToFile = async (
  outputJsonPath: string,
  documents: unknown[],
  logger: AppLogger,
): Promise<void> => {
  const absolutePath = path.resolve(outputJsonPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(documents, null, 2)}\n`, 'utf8');
  logger.info(
    { outputJsonPath: absolutePath, recordsWritten: documents.length },
    'Wrote normalized output file',
  );
};

export type MongoWriteConfig = {
  mongoUri: string;
  dbName: string;
  collectionName: string;
};

export const writeOutputToMongo = async (
  config: MongoWriteConfig,
  documents: Array<{ id: string }>,
  logger: AppLogger,
): Promise<number> => {
  if (documents.length === 0) {
    logger.info('No documents to persist to MongoDB');
    return 0;
  }

  const client = new MongoClient(config.mongoUri);
  logger.info(
    {
      dbName: config.dbName,
      collectionName: config.collectionName,
      recordsToWrite: documents.length,
    },
    'Connecting to MongoDB for bulk upsert',
  );
  await client.connect();

  try {
    const collection = client.db(config.dbName).collection<{ id: string }>(config.collectionName);

    const operations = documents.map((document) => ({
      updateOne: {
        filter: { id: document.id },
        update: { $set: document },
        upsert: true,
      },
    }));

    const result = await collection.bulkWrite(operations, { ordered: false });
    const applied = result.upsertedCount + result.modifiedCount;
    logger.info(
      {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedCount: result.upsertedCount,
        appliedCount: applied,
      },
      'Completed MongoDB bulk upsert',
    );
    return applied;
  } finally {
    await client.close();
    logger.info('Closed MongoDB connection');
  }
};
