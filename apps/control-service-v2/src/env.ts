import { loadEnv } from '@repo/env-config';
import { z } from 'zod';

const toBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

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

const optionalStringSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}, z.string().trim().min(1).optional());

export const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    HOST: z.string().trim().min(1).default('0.0.0.0'),
    SERVICE_NAME: z.string().trim().min(1).default('control-service-v2'),
    SERVICE_VERSION: z.string().trim().min(1).default('dev'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: toBoolean.default(false),
    CONTROL_SHARED_TOKEN: z.string().trim().min(1),
    MONGODB_URI: z.string().trim().min(1),
    CONTROL_PLANE_DB_NAME: z.string().trim().min(1),
    CRAWLER_WORKER_BASE_URL: z.url(),
    INGESTION_WORKER_BASE_URL: z.url(),
    CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND: z
      .enum(['local_filesystem', 'gcs'])
      .default('local_filesystem'),
    CONTROL_PLANE_ARTIFACT_STORAGE_LOCAL_BASE_PATH: z
      .string()
      .trim()
      .min(1)
      .default('control-plane-artifacts'),
    CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET: optionalStringSchema,
    CONTROL_PLANE_ARTIFACT_STORAGE_GCS_PREFIX: z.string().default(''),
    GCP_PROJECT_ID: z.string().trim().min(1),
    PUBSUB_EVENTS_TOPIC: z.string().trim().min(1),
    PUBSUB_EVENTS_SUBSCRIPTION: z.string().trim().min(1),
    PUBSUB_AUTO_CREATE_SUBSCRIPTION: toBoolean.default(true),
    ENABLE_PUBSUB_CONSUMER: toBoolean.default(true),
    SSE_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND === 'gcs' &&
      !value.CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET'],
        message:
          'CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET is required when CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND=gcs.',
      });
    }
  });

export type EnvSchema = z.infer<typeof envSchema>;

export const envs: EnvSchema = loadEnv(envSchema, import.meta.url);
