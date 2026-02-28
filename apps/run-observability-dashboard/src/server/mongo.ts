import { MongoClient, type Db } from 'mongodb';
import { env } from '@/server/env';

const globalForMongo = globalThis as typeof globalThis & {
  __runObservabilityDashboardMongoClient?: MongoClient;
};

async function getMongoClient(): Promise<MongoClient> {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required when DASHBOARD_DATA_MODE=mongo.');
  }

  if (!globalForMongo.__runObservabilityDashboardMongoClient) {
    globalForMongo.__runObservabilityDashboardMongoClient = new MongoClient(env.MONGODB_URI);
    await globalForMongo.__runObservabilityDashboardMongoClient.connect();
  }

  return globalForMongo.__runObservabilityDashboardMongoClient;
}

export async function getMongoDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(env.MONGODB_DB_NAME);
}
