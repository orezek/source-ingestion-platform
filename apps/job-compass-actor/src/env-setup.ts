import { loadEnv } from '@repo/env-config';
import { z } from 'zod';

const crawleeLogLevels = z.enum(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'OFF']);
const toBoolean = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === '') {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  CRAWLEE_LOG_LEVEL: crawleeLogLevels.describe(
    'Crawlee logger constant for setting up logging levels.',
  ),
  LOCAL_SHARED_SCRAPED_JOBS_DIR: z.string().default('../job-ingestion-service/scrapped_jobs'),
  ENABLE_INGESTION_TRIGGER: toBoolean.default(false),
  INGESTION_TRIGGER_URL: z
    .string()
    .url()
    .default('http://127.0.0.1:3010/ingestion/start'),
  INGESTION_TRIGGER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  MONGODB_CRAWL_JOBS_COLLECTION: z.string().default('crawlJobsCollection'),
  CRAWL_INACTIVE_GUARD_MIN_ACTIVE_COUNT: z.coerce.number().int().nonnegative().default(100),
  CRAWL_INACTIVE_GUARD_MIN_SEEN_RATIO: z.coerce.number().min(0).max(1).default(0.5),
  ENABLE_MONGO_RUN_SUMMARY_WRITE: toBoolean.default(false),
  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: z.string().default('jobCompass'),
  MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION: z.string().default('crawlRunSummaryCollection'),
});

type EnvSchema = z.infer<typeof envSchema>;

export const envs: EnvSchema = loadEnv(envSchema, import.meta.url);
