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
}, z.string().min(1).optional());

export const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3020),
    SERVICE_NAME: z.string().trim().min(1).default('ingestion-worker'),
    SERVICE_VERSION: z.string().trim().min(1).default('2.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().max(128).default(4),
    CONTROL_AUTH_MODE: z.enum(['token', 'jwt']).default('token'),
    CONTROL_SHARED_TOKEN: optionalStringSchema,
    CONTROL_JWT_PUBLIC_KEY: optionalStringSchema,
    GCP_PROJECT_ID: z.string().trim().min(1),
    PUBSUB_EVENTS_TOPIC: z.string().trim().min(1),
    PUBSUB_EVENTS_SUBSCRIPTION: optionalStringSchema,
    PUBSUB_AUTO_CREATE_SUBSCRIPTION: toBoolean.default(true),
    ENABLE_PUBSUB_CONSUMER: toBoolean.default(true),
    OUTPUTS_BUCKET: z.string().trim().min(1),
    OUTPUTS_PREFIX: z.string().default(''),
    MONGODB_URI: z.string().trim().min(1),
    MONGODB_DB_NAME: z.string().trim().min(1),
    MONGODB_INGESTION_RUN_SUMMARIES_COLLECTION: z
      .string()
      .trim()
      .min(1)
      .default('ingestion_run_summaries'),
    MONGODB_INGESTION_TRIGGER_REQUESTS_COLLECTION: z
      .string()
      .trim()
      .min(1)
      .default('ingestion_trigger_requests'),
    MONGODB_NORMALIZED_JOB_ADS_COLLECTION: z.string().trim().min(1).default('normalized_job_ads'),
  })
  .superRefine((value, context) => {
    if (value.CONTROL_AUTH_MODE === 'token' && !value.CONTROL_SHARED_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONTROL_SHARED_TOKEN'],
        message: 'CONTROL_SHARED_TOKEN is required when CONTROL_AUTH_MODE=token.',
      });
    }

    if (value.CONTROL_AUTH_MODE === 'jwt' && !value.CONTROL_JWT_PUBLIC_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONTROL_JWT_PUBLIC_KEY'],
        message: 'CONTROL_JWT_PUBLIC_KEY is required when CONTROL_AUTH_MODE=jwt.',
      });
    }
  });

export type EnvSchema = z.infer<typeof envSchema>;

export const envs: EnvSchema = loadEnv(envSchema, import.meta.url);
