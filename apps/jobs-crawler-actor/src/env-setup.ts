import { loadEnv } from '@repo/env-config';
import { z } from 'zod';

const crawleeLogLevels = z.enum(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'OFF']);
const toOptionalString = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}, z.string().optional());

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
  JOB_COMPASS_DB_PREFIX: z.string().trim().min(1).default('job-compass'),
  JOB_COMPASS_SEARCH_SPACES_DIR: toOptionalString,
  JOB_COMPASS_ARTIFACT_STORE_TYPE: z.enum(['local_filesystem', 'gcs']).default('local_filesystem'),
  LOCAL_SHARED_SCRAPED_JOBS_DIR: z.string().default('../jobs-ingestion-service/scrapped_jobs'),
  JOB_COMPASS_GCS_BUCKET: toOptionalString,
  JOB_COMPASS_GCS_PREFIX: toOptionalString,
  ENABLE_INGESTION_TRIGGER: toBoolean.default(false),
  INGESTION_TRIGGER_URL: z.string().url().default('http://127.0.0.1:3010/ingestion/item'),
  INGESTION_TRIGGER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  JOB_COMPASS_BROKER_BACKEND: z.enum(['local', 'gcp_pubsub']).default('local'),
  LOCAL_BROKER_DIR: toOptionalString,
  JOB_COMPASS_GCP_PROJECT_ID: toOptionalString,
  JOB_COMPASS_GCP_PUBSUB_TOPIC: toOptionalString,
  JOB_COMPASS_GCP_PUBSUB_SUBSCRIPTION_PREFIX: toOptionalString,
  CRAWL_RUN_ID: toOptionalString,
  CRAWL_RUN_SUMMARY_FILE_PATH: toOptionalString,
  MONGODB_JOBS_COLLECTION: z.string().default('normalized_job_ads'),
  CRAWL_INACTIVE_GUARD_MIN_ACTIVE_COUNT: z.coerce.number().int().nonnegative().default(100),
  CRAWL_INACTIVE_GUARD_MIN_SEEN_RATIO: z.coerce.number().min(0).max(1).default(0.5),
  ENABLE_MONGO_RUN_SUMMARY_WRITE: toBoolean.default(false),
  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: toOptionalString,
  MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION: z.string().default('crawl_run_summaries'),
});

type ParsedEnvSchema = z.infer<typeof envSchema>;
type EnvSchema = Omit<ParsedEnvSchema, 'MONGODB_DB_NAME'> & {
  MONGODB_DB_NAME: string;
};

const parsedEnv = loadEnv(envSchema, import.meta.url);

export const envs: EnvSchema = {
  ...parsedEnv,
  MONGODB_DB_NAME: parsedEnv.MONGODB_DB_NAME ?? '',
};
