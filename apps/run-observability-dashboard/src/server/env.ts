import { loadEnv } from '@repo/env-config';
import { z } from 'zod';

const dataModeSchema = z.enum(['mongo', 'fixture']);
const timeRangeSchema = z.enum(['24h', '7d', '30d']);
const optionalStringSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}, z.string().optional());

const envSchema = z.object({
  DASHBOARD_DATA_MODE: dataModeSchema.default('mongo'),
  JOB_COMPASS_PROD_DB_NAME: z.string().default('job-compass'),
  JOB_COMPASS_DEV_DB_NAME: z.string().default('job-compass-dev'),
  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: optionalStringSchema,
  MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION: z.string().default('crawl_run_summaries'),
  MONGODB_INGESTION_RUN_SUMMARIES_COLLECTION: z.string().default('ingestion_run_summaries'),
  MONGODB_INGESTION_TRIGGER_REQUESTS_COLLECTION: z.string().default('ingestion_trigger_requests'),
  DASHBOARD_DEFAULT_TIME_RANGE: timeRangeSchema.default('7d'),
  DASHBOARD_FIXTURE_DIR: z.string().default('./src/test/fixtures'),
});

type ParsedDashboardEnv = z.infer<typeof envSchema>;
export type DashboardEnv = Omit<ParsedDashboardEnv, 'MONGODB_DB_NAME'> & {
  MONGODB_DB_NAME: string;
};

const parsedEnv = loadEnv(envSchema, import.meta.url);
export const env: DashboardEnv = {
  ...parsedEnv,
  MONGODB_DB_NAME: parsedEnv.MONGODB_DB_NAME ?? parsedEnv.JOB_COMPASS_PROD_DB_NAME,
};
