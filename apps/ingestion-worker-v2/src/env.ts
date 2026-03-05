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

const thinkingLevelSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return value;
  },
  z.enum(['THINKING_LEVEL_UNSPECIFIED', 'LOW', 'MEDIUM', 'HIGH']).nullable(),
);

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
    INGESTION_PARSER_BACKEND: z.enum(['gemini', 'fixture']).default('gemini'),
    GEMINI_API_KEY: optionalStringSchema,
    LANGSMITH_API_KEY: optionalStringSchema,
    LLM_EXTRACTOR_PROMPT_NAME: z.string().default('jobcompass-job-ad-structured-extractor'),
    LLM_CLEANER_PROMPT_NAME: z.string().default('jobcompass-job-ad-text-cleaner'),
    GEMINI_MODEL: z.string().default('gemini-3-flash-preview'),
    GEMINI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0),
    GEMINI_THINKING_LEVEL: thinkingLevelSchema.default('LOW'),
    GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS: z.coerce.number().nonnegative().default(0.5),
    GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS: z.coerce.number().nonnegative().default(3),
    DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS: z.coerce.number().int().min(100).max(300_000).default(700),
    LOG_TEXT_TRANSFORM_CONTENT: toBoolean.default(false),
    LOG_TEXT_TRANSFORM_PREVIEW_CHARS: z.coerce.number().int().min(120).max(20_000).default(1200),
    PARSER_VERSION: z.string().default('ingestion-worker-v2-v1-model'),
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

    if (value.INGESTION_PARSER_BACKEND === 'gemini' && !value.GEMINI_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when INGESTION_PARSER_BACKEND=gemini.',
      });
    }

    if (value.INGESTION_PARSER_BACKEND === 'gemini' && !value.LANGSMITH_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LANGSMITH_API_KEY'],
        message: 'LANGSMITH_API_KEY is required when INGESTION_PARSER_BACKEND=gemini.',
      });
    }
  });

export type EnvSchema = z.infer<typeof envSchema>;

export const envs: EnvSchema = loadEnv(envSchema, import.meta.url);
