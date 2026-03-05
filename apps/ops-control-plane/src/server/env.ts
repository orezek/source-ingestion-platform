import { loadEnv } from '@repo/env-config';
import { z } from 'zod';

const dataModeSchema = z.enum(['mongo', 'fixture']);
const executionModeSchema = z.enum(['fixture', 'local_cli']);
const brokerBackendSchema = z.enum(['local', 'gcp_pubsub']);
const managedStorageBackendSchema = z.enum(['local_filesystem', 'gcs']);
const ingestionParserBackendSchema = z.enum(['gemini', 'fixture']);
const timeRangeSchema = z.enum(['24h', '7d', '30d']);
const optionalStringSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}, z.string().optional());

const envSchema = z.object({
  DASHBOARD_DATA_MODE: dataModeSchema.default('mongo'),
  JOB_COMPASS_DB_PREFIX: z.string().trim().min(1).default('crawl-ops'),
  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: optionalStringSchema,
  MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION: z.string().default('crawl_run_summaries'),
  MONGODB_INGESTION_RUN_SUMMARIES_COLLECTION: z.string().default('ingestion_run_summaries'),
  MONGODB_INGESTION_TRIGGER_REQUESTS_COLLECTION: z.string().default('ingestion_trigger_requests'),
  DASHBOARD_DEFAULT_TIME_RANGE: timeRangeSchema.default('7d'),
  DASHBOARD_FIXTURE_DIR: z.string().default('./src/test/fixtures'),
  CONTROL_PLANE_DATA_DIR: z.string().default('./storage/control-plane'),
  CONTROL_PLANE_BROKER_DIR: z.string().default('./storage/control-plane/broker'),
  CONTROL_PLANE_WORKER_LOG_DIR: z.string().default('./storage/control-plane/logs'),
  CONTROL_PLANE_BOOTSTRAP_SEARCH_SPACES_DIR: z
    .string()
    .default('../jobs-crawler-actor/search-spaces'),
  CONTROL_PLANE_DEFAULT_ARTIFACT_DIR: z.string().default('../jobs-ingestion-service/scrapped_jobs'),
  CONTROL_PLANE_DEFAULT_JSON_OUTPUT_DIR: z
    .string()
    .default('../jobs-ingestion-service/output/control-plane'),
  CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND: managedStorageBackendSchema.default('local_filesystem'),
  CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET: optionalStringSchema,
  CONTROL_PLANE_ARTIFACT_STORAGE_GCS_PREFIX: z.string().default(''),
  CONTROL_PLANE_DOWNLOADABLE_OUTPUT_BACKEND:
    managedStorageBackendSchema.default('local_filesystem'),
  CONTROL_PLANE_DOWNLOADABLE_OUTPUT_GCS_BUCKET: optionalStringSchema,
  CONTROL_PLANE_DOWNLOADABLE_OUTPUT_GCS_PREFIX: z.string().default(''),
  CONTROL_PLANE_EXECUTION_MODE: executionModeSchema.default('fixture'),
  CONTROL_PLANE_INGESTION_PARSER_BACKEND: ingestionParserBackendSchema.default('gemini'),
  CONTROL_PLANE_BROKER_BACKEND: brokerBackendSchema.default('local'),
  CONTROL_PLANE_GCP_PROJECT_ID: optionalStringSchema,
  CONTROL_PLANE_GCP_PUBSUB_TOPIC: z.string().default('jobcompass-control-plane-events'),
  CONTROL_PLANE_GCP_PUBSUB_SUBSCRIPTION_PREFIX: z.string().default('jobcompass-control-plane-run'),
  CONTROL_PLANE_PNPM_BIN: z.string().default('pnpm'),
});

type ParsedDashboardEnv = z.infer<typeof envSchema>;
export type DashboardEnv = Omit<ParsedDashboardEnv, 'MONGODB_DB_NAME'> & {
  MONGODB_DB_NAME: string;
};

const parsedEnv = loadEnv(envSchema, import.meta.url);
export const env: DashboardEnv = {
  ...parsedEnv,
  MONGODB_DB_NAME: parsedEnv.MONGODB_DB_NAME ?? parsedEnv.JOB_COMPASS_DB_PREFIX,
};
