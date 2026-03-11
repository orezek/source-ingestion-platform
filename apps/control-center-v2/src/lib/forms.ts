import {
  createControlPlanePipelineRequestV2Schema,
  updateControlPlanePipelineRequestV2Schema,
} from '@repo/control-plane-contracts/v2';
import { z } from 'zod';
import type {
  CreateControlPlanePipelineRequest,
  UpdateControlPlanePipelineRequest,
} from '@/lib/contracts';
import { splitTextareaLines } from '@/lib/utils';

export const PIPELINE_NAME_MAX_LENGTH = 20;
export const START_URLS_MAX_COUNT = 20;
export const MAX_ITEMS_MIN = 1;
export const MAX_ITEMS_MAX = 1000;
export const CRAWLER_MAX_CONCURRENCY_MIN = 1;
export const CRAWLER_MAX_CONCURRENCY_MAX = 20;
export const CRAWLER_RPM_MIN = 1;
export const CRAWLER_RPM_MAX = 600;
export const INGESTION_CONCURRENCY_MIN = 1;
export const INGESTION_CONCURRENCY_MAX = 64;

const mongoDbNameCharsetRegex = /^[A-Za-z0-9_-]+$/u;
const mongoUriSchemeRegex = /^mongodb(?:\+srv)?:\/\//iu;
export const MONGO_DB_NAME_MAX_BYTES = 38;

const mongoDbNameSchema = z
  .string()
  .trim()
  .min(1, 'MongoDB database name is required.')
  .regex(
    mongoDbNameCharsetRegex,
    'MongoDB database name may contain only letters, numbers, underscore, and hyphen.',
  )
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MONGO_DB_NAME_MAX_BYTES, {
    message: `MongoDB database name must be at most ${MONGO_DB_NAME_MAX_BYTES} bytes.`,
  });

const mongoUriSchema = z
  .string()
  .trim()
  .min(1, 'MongoDB URI is required.')
  .url('MongoDB URI must be a valid URI.')
  .refine((value) => mongoUriSchemeRegex.test(value), {
    message: 'MongoDB URI must start with mongodb:// or mongodb+srv://.',
  });

const optionalMongoUriSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}, mongoUriSchema.optional());

const startUrlsTextSchema = z
  .string()
  .trim()
  .min(1, 'At least one start URL is required.')
  .refine((value) => splitTextareaLines(value).length <= START_URLS_MAX_COUNT, {
    message: `At most ${START_URLS_MAX_COUNT} start URLs are allowed.`,
  })
  .refine((value) => splitTextareaLines(value).every((url) => z.url().safeParse(url).success), {
    message: 'Each start URL must be a valid absolute URL.',
  });

export const pipelineCreateFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(PIPELINE_NAME_MAX_LENGTH, `Name must be at most ${PIPELINE_NAME_MAX_LENGTH} characters.`),
  source: z.string().trim().min(1, 'Source is required.'),
  mode: z.enum(['crawl_only', 'crawl_and_ingest']),
  searchSpaceName: z.string().trim().min(1, 'Search space name is required.'),
  searchSpaceDescription: z.string().trim().default(''),
  startUrlsText: startUrlsTextSchema,
  maxItems: z.coerce
    .number()
    .int()
    .min(MAX_ITEMS_MIN, `Max items must be at least ${MAX_ITEMS_MIN}.`)
    .max(MAX_ITEMS_MAX, `Max items must be at most ${MAX_ITEMS_MAX}.`),
  allowInactiveMarking: z.boolean().default(true),
  runtimeProfileName: z.string().trim().min(1, 'Runtime profile name is required.'),
  crawlerMaxConcurrency: z.coerce
    .number()
    .int()
    .min(
      CRAWLER_MAX_CONCURRENCY_MIN,
      `Crawler max concurrency must be at least ${CRAWLER_MAX_CONCURRENCY_MIN}.`,
    )
    .max(
      CRAWLER_MAX_CONCURRENCY_MAX,
      `Crawler max concurrency must be at most ${CRAWLER_MAX_CONCURRENCY_MAX}.`,
    )
    .optional(),
  crawlerMaxRequestsPerMinute: z.coerce
    .number()
    .int()
    .min(CRAWLER_RPM_MIN, `Crawler RPM must be at least ${CRAWLER_RPM_MIN}.`)
    .max(CRAWLER_RPM_MAX, `Crawler RPM must be at most ${CRAWLER_RPM_MAX}.`)
    .optional(),
  ingestionConcurrency: z.coerce
    .number()
    .int()
    .min(
      INGESTION_CONCURRENCY_MIN,
      `Ingestion concurrency must be at least ${INGESTION_CONCURRENCY_MIN}.`,
    )
    .max(
      INGESTION_CONCURRENCY_MAX,
      `Ingestion concurrency must be at most ${INGESTION_CONCURRENCY_MAX}.`,
    )
    .optional(),
  includeMongoOutput: z.boolean().default(true),
  includeDownloadableJson: z.boolean().default(false),
  operatorMongoUri: mongoUriSchema,
  operatorDbName: mongoDbNameSchema,
});

export type PipelineCreateFormValues = z.input<typeof pipelineCreateFormSchema>;
export type PipelineCreateFormData = z.output<typeof pipelineCreateFormSchema>;

export const pipelineUpdateFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(PIPELINE_NAME_MAX_LENGTH, `Name must be at most ${PIPELINE_NAME_MAX_LENGTH} characters.`),
  mode: z.enum(['crawl_only', 'crawl_and_ingest']),
  searchSpaceName: z.string().trim().min(1, 'Search space name is required.'),
  searchSpaceDescription: z.string().trim().default(''),
  startUrlsText: startUrlsTextSchema,
  maxItems: z.coerce
    .number()
    .int()
    .min(MAX_ITEMS_MIN, `Max items must be at least ${MAX_ITEMS_MIN}.`)
    .max(MAX_ITEMS_MAX, `Max items must be at most ${MAX_ITEMS_MAX}.`),
  allowInactiveMarking: z.boolean().default(true),
  runtimeProfileName: z.string().trim().min(1, 'Runtime profile name is required.'),
  crawlerMaxConcurrency: z.coerce
    .number()
    .int()
    .min(
      CRAWLER_MAX_CONCURRENCY_MIN,
      `Crawler max concurrency must be at least ${CRAWLER_MAX_CONCURRENCY_MIN}.`,
    )
    .max(
      CRAWLER_MAX_CONCURRENCY_MAX,
      `Crawler max concurrency must be at most ${CRAWLER_MAX_CONCURRENCY_MAX}.`,
    )
    .optional(),
  crawlerMaxRequestsPerMinute: z.coerce
    .number()
    .int()
    .min(CRAWLER_RPM_MIN, `Crawler RPM must be at least ${CRAWLER_RPM_MIN}.`)
    .max(CRAWLER_RPM_MAX, `Crawler RPM must be at most ${CRAWLER_RPM_MAX}.`)
    .optional(),
  ingestionConcurrency: z.coerce
    .number()
    .int()
    .min(
      INGESTION_CONCURRENCY_MIN,
      `Ingestion concurrency must be at least ${INGESTION_CONCURRENCY_MIN}.`,
    )
    .max(
      INGESTION_CONCURRENCY_MAX,
      `Ingestion concurrency must be at most ${INGESTION_CONCURRENCY_MAX}.`,
    )
    .optional(),
  includeMongoOutput: z.boolean().default(true),
  includeDownloadableJson: z.boolean().default(false),
  operatorMongoUri: optionalMongoUriSchema,
  operatorDbName: mongoDbNameSchema.optional(),
});

export type PipelineUpdateFormValues = z.input<typeof pipelineUpdateFormSchema>;
export type PipelineUpdateFormData = z.output<typeof pipelineUpdateFormSchema>;

export const buildCreatePipelinePayload = (
  values: PipelineCreateFormData,
): CreateControlPlanePipelineRequest => {
  const startUrls = splitTextareaLines(values.startUrlsText);
  const destinations =
    values.mode === 'crawl_only'
      ? []
      : [
          ...(values.includeMongoOutput ? [{ type: 'mongodb' as const }] : []),
          ...(values.includeDownloadableJson ? [{ type: 'downloadable_json' as const }] : []),
        ];
  const hasMongoDestination = destinations.some((destination) => destination.type === 'mongodb');

  return createControlPlanePipelineRequestV2Schema.parse({
    name: values.name,
    source: values.source,
    mode: values.mode,
    searchSpace: {
      name: values.searchSpaceName,
      description: values.searchSpaceDescription,
      startUrls,
      maxItems: values.maxItems,
      allowInactiveMarking: hasMongoDestination ? values.allowInactiveMarking : false,
    },
    runtimeProfile: {
      name: values.runtimeProfileName,
      crawlerMaxConcurrency: values.crawlerMaxConcurrency,
      crawlerMaxRequestsPerMinute: values.crawlerMaxRequestsPerMinute,
      ingestionConcurrency: values.mode === 'crawl_only' ? undefined : values.ingestionConcurrency,
    },
    structuredOutput: {
      destinations,
    },
    operatorSink: {
      mongodbUri: values.operatorMongoUri,
      dbName: values.operatorDbName,
    },
  });
};

export const buildUpdatePipelinePayload = (
  values: PipelineUpdateFormData,
): UpdateControlPlanePipelineRequest => {
  const startUrls = splitTextareaLines(values.startUrlsText);
  const destinations =
    values.mode === 'crawl_only'
      ? []
      : [
          ...(values.includeMongoOutput ? [{ type: 'mongodb' as const }] : []),
          ...(values.includeDownloadableJson ? [{ type: 'downloadable_json' as const }] : []),
        ];
  const hasMongoDestination = destinations.some((destination) => destination.type === 'mongodb');
  const operatorMongoUri = values.operatorMongoUri?.trim();
  const operatorDbName = values.operatorDbName?.trim();
  const operatorSink =
    operatorMongoUri || operatorDbName
      ? {
          ...(operatorMongoUri ? { mongodbUri: operatorMongoUri } : {}),
          ...(operatorDbName ? { dbName: operatorDbName } : {}),
        }
      : undefined;

  return updateControlPlanePipelineRequestV2Schema.parse({
    name: values.name,
    mode: values.mode,
    searchSpace: {
      name: values.searchSpaceName,
      description: values.searchSpaceDescription,
      startUrls,
      maxItems: values.maxItems,
      allowInactiveMarking: hasMongoDestination ? values.allowInactiveMarking : false,
    },
    runtimeProfile: {
      name: values.runtimeProfileName,
      crawlerMaxConcurrency: values.crawlerMaxConcurrency,
      crawlerMaxRequestsPerMinute: values.crawlerMaxRequestsPerMinute,
      ingestionConcurrency: values.mode === 'crawl_only' ? undefined : values.ingestionConcurrency,
    },
    structuredOutput: {
      destinations,
    },
    ...(operatorSink ? { operatorSink } : {}),
  });
};
