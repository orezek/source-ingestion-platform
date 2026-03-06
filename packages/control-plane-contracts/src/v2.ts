import { z } from 'zod';

const isoDateTimeSchema = z.iso.datetime();
const nonEmptyStringSchema = z.string().trim().min(1);
const optionalStringSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}, z.string().trim().min(1).optional());

export const v2ContractVersionSchema = z.literal('v2');
export const v2WorkerTypeSchema = z.enum(['crawler', 'ingestion']);
export const v2RunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'completed_with_errors',
  'failed',
  'stopped',
]);

export const v2PersistenceTargetsSchema = z.object({
  dbName: nonEmptyStringSchema,
});

export const v2PipelineSnapshotSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  version: z.number().int().positive(),
  mode: z.enum(['crawl_only', 'crawl_and_ingest']),
  searchSpaceId: nonEmptyStringSchema,
  runtimeProfileId: nonEmptyStringSchema,
  structuredOutputDestinationIds: z.array(nonEmptyStringSchema).default([]),
});

export const v2RuntimeSnapshotSchema = z.object({
  crawlerMaxConcurrency: z.number().int().positive().optional(),
  crawlerMaxRequestsPerMinute: z.number().int().positive().optional(),
  ingestionConcurrency: z.number().int().positive().optional(),
});

export const v2ArtifactSinkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local_filesystem'),
    basePath: nonEmptyStringSchema,
  }),
  z.object({
    type: z.literal('gcs'),
    bucket: nonEmptyStringSchema,
    prefix: optionalStringSchema.default(''),
  }),
]);

export const v2OutputSinkSchema = z.object({
  type: z.literal('downloadable_json'),
});

export const v2CrawlerSearchSpaceSnapshotSchema = z.object({
  name: nonEmptyStringSchema,
  description: optionalStringSchema.default(''),
  startUrls: z.array(z.url()).min(1),
  maxItems: z.number().int().positive(),
  allowInactiveMarking: z.boolean(),
});

export const v2CrawlerInputRefSchema = z.object({
  source: nonEmptyStringSchema,
  searchSpaceId: nonEmptyStringSchema,
  searchSpaceSnapshot: v2CrawlerSearchSpaceSnapshotSchema,
  emitDetailCapturedEvents: z.boolean(),
});

const v2SourceListingRecordSchema = z.object({
  sourceId: nonEmptyStringSchema,
  adUrl: z.url(),
  jobTitle: nonEmptyStringSchema,
  companyName: z.string().nullable(),
  location: z.string().nullable(),
  salary: z.string().nullable(),
  publishedInfoText: z.string().nullable(),
  scrapedAt: isoDateTimeSchema,
  source: nonEmptyStringSchema,
  htmlDetailPageKey: nonEmptyStringSchema,
});

const v2IngestionInputRecordSchema = z
  .object({
    source: nonEmptyStringSchema,
    sourceId: nonEmptyStringSchema,
    dedupeKey: nonEmptyStringSchema,
    detailHtmlPath: nonEmptyStringSchema,
    listingRecord: v2SourceListingRecordSchema,
  })
  .superRefine((value, context) => {
    if (value.source !== value.listingRecord.source) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['listingRecord', 'source'],
        message: 'listingRecord.source must match record.source.',
      });
    }

    if (value.sourceId !== value.listingRecord.sourceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['listingRecord', 'sourceId'],
        message: 'listingRecord.sourceId must match record.sourceId.',
      });
    }
  });

export const v2IngestionInputRefSchema = z.object({
  crawlRunId: nonEmptyStringSchema,
  searchSpaceId: nonEmptyStringSchema,
  records: z.array(v2IngestionInputRecordSchema),
});

export const v2RunTimeoutsSchema = z.object({
  hardTimeoutSeconds: z.number().int().positive().optional(),
  idleTimeoutSeconds: z.number().int().positive().optional(),
});

const v2StartRunRequestBaseSchema = z.object({
  contractVersion: v2ContractVersionSchema.default('v2'),
  runId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
  requestedAt: isoDateTimeSchema,
  correlationId: nonEmptyStringSchema,
  runtimeSnapshot: v2RuntimeSnapshotSchema,
  persistenceTargets: v2PersistenceTargetsSchema,
  artifactSink: v2ArtifactSinkSchema.optional(),
  timeouts: v2RunTimeoutsSchema.optional(),
});

export const crawlerStartRunRequestV2Schema = v2StartRunRequestBaseSchema.extend({
  workerType: z.literal('crawler'),
  inputRef: v2CrawlerInputRefSchema,
  artifactSink: v2ArtifactSinkSchema,
});

export const ingestionStartRunRequestV2Schema = v2StartRunRequestBaseSchema.extend({
  workerType: z.literal('ingestion'),
  inputRef: v2IngestionInputRefSchema,
  outputSinks: z.array(v2OutputSinkSchema).default([]),
});

export const startRunRequestV2Schema = z.discriminatedUnion('workerType', [
  crawlerStartRunRequestV2Schema,
  ingestionStartRunRequestV2Schema,
]);

export const startRunAcceptedResponseV2Schema = z.object({
  contractVersion: v2ContractVersionSchema.default('v2'),
  ok: z.literal(true),
  runId: nonEmptyStringSchema,
  workerType: v2WorkerTypeSchema,
  accepted: z.boolean(),
  deduplicated: z.boolean(),
  state: z.enum(['accepted', 'running', 'queued', 'deduplicated']),
  message: optionalStringSchema,
});

export const startRunRejectedResponseV2Schema = z.object({
  contractVersion: v2ContractVersionSchema.default('v2'),
  ok: z.literal(false),
  accepted: z.literal(false),
  deduplicated: z.literal(false),
  state: z.literal('rejected'),
  workerType: v2WorkerTypeSchema.optional(),
  runId: optionalStringSchema,
  error: z.object({
    code: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const startRunResponseV2Schema = z.union([
  startRunAcceptedResponseV2Schema,
  startRunRejectedResponseV2Schema,
]);

export const workerLifecyclePayloadV2Schema = z.object({
  runId: nonEmptyStringSchema,
  workerType: v2WorkerTypeSchema,
  status: v2RunStatusSchema,
  counters: z.record(z.string(), z.number().nonnegative()).default({}),
  error: z
    .object({
      name: nonEmptyStringSchema,
      message: nonEmptyStringSchema,
    })
    .optional(),
});

const v2WorkerLifecycleEnvelopeSchema = z.object({
  eventId: nonEmptyStringSchema,
  eventVersion: v2ContractVersionSchema.default('v2'),
  occurredAt: isoDateTimeSchema,
  runId: nonEmptyStringSchema,
  correlationId: nonEmptyStringSchema,
  producer: nonEmptyStringSchema,
});

export const crawlerRunStartedEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('crawler.run.started'),
  payload: workerLifecyclePayloadV2Schema.extend({
    workerType: z.literal('crawler'),
    status: z.literal('running'),
  }),
});

export const crawlerRunFinishedEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('crawler.run.finished'),
  payload: workerLifecyclePayloadV2Schema.extend({
    workerType: z.literal('crawler'),
    status: z.enum(['succeeded', 'completed_with_errors', 'failed', 'stopped']),
  }),
});

export const ingestionRunStartedEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('ingestion.run.started'),
  payload: workerLifecyclePayloadV2Schema.extend({
    workerType: z.literal('ingestion'),
    status: z.literal('running'),
  }),
});

export const ingestionRunFinishedEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('ingestion.run.finished'),
  payload: workerLifecyclePayloadV2Schema.extend({
    workerType: z.literal('ingestion'),
    status: z.enum(['succeeded', 'completed_with_errors', 'failed', 'stopped']),
  }),
});

export const workerLifecycleEventV2Schema = z.discriminatedUnion('eventType', [
  crawlerRunStartedEventV2Schema,
  crawlerRunFinishedEventV2Schema,
  ingestionRunStartedEventV2Schema,
  ingestionRunFinishedEventV2Schema,
]);

export const crawlRunSummaryProjectionV2Schema = z.object({
  crawlRunId: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  status: v2RunStatusSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.optional(),
  stopReason: optionalStringSchema,
  newJobsCount: z.number().int().nonnegative().default(0),
  existingJobsCount: z.number().int().nonnegative().default(0),
  inactiveMarkedCount: z.number().int().nonnegative().default(0),
  datasetRecordsStored: z.number().int().nonnegative().default(0),
  failedRequests: z.number().int().nonnegative().default(0),
  runSummary: z.record(z.string(), z.unknown()).optional(),
});

export const ingestionRunSummaryProjectionV2Schema = z.object({
  runId: nonEmptyStringSchema,
  crawlRunId: nonEmptyStringSchema.nullable(),
  status: v2RunStatusSchema,
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.optional(),
  runDurationSeconds: z.number().nonnegative().optional(),
  parserVersion: nonEmptyStringSchema.optional(),
  extractorModel: nonEmptyStringSchema.optional(),
  llmExtractorPromptName: nonEmptyStringSchema.optional(),
  llmCleanerPromptName: nonEmptyStringSchema.optional(),
  concurrency: z.number().int().positive().optional(),
  jobsTotal: z.number().int().nonnegative(),
  jobsProcessed: z.number().int().nonnegative(),
  processedJobIds: z.array(nonEmptyStringSchema).default([]),
  jobsSkippedIncomplete: z.number().int().nonnegative(),
  skippedIncompleteJobIds: z.array(nonEmptyStringSchema).default([]),
  jobsFailed: z.number().int().nonnegative(),
  failedJobIds: z.array(nonEmptyStringSchema).default([]),
  jobsNonSuccess: z.number().int().nonnegative().optional(),
  nonSuccessJobIds: z.array(nonEmptyStringSchema).default([]),
  jobsSuccessRate: z.number().min(0).max(1).optional(),
  jobsNonSuccessRate: z.number().min(0).max(1).optional(),
  jobsSkippedIncompleteRate: z.number().min(0).max(1).optional(),
  jobsFailedRate: z.number().min(0).max(1).optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  totalInputTokens: z.number().int().nonnegative().optional(),
  totalOutputTokens: z.number().int().nonnegative().optional(),
  totalEstimatedCostUsd: z.number().nonnegative().optional(),
  avgTimeToProcssSeconds: z.number().nonnegative().optional(),
  p50TimeToProcssSeconds: z.number().nonnegative().optional(),
  p95TimeToProcssSeconds: z.number().nonnegative().optional(),
  avgLlmCleanerCallDurationSeconds: z.number().nonnegative().optional(),
  avgLlmExtractorCallDurationSeconds: z.number().nonnegative().optional(),
  avgLlmTotalCallDurationSeconds: z.number().nonnegative().optional(),
  p50LlmTotalCallDurationSeconds: z.number().nonnegative().optional(),
  p95LlmTotalCallDurationSeconds: z.number().nonnegative().optional(),
  llmCleanerStats: z
    .object({
      calls: z.number().int().nonnegative(),
      avgCallDurationSeconds: z.number().nonnegative(),
      p50CallDurationSeconds: z.number().nonnegative(),
      p95CallDurationSeconds: z.number().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      inputCostUsd: z.number().nonnegative(),
      outputCostUsd: z.number().nonnegative(),
      totalCostUsd: z.number().nonnegative(),
    })
    .optional(),
  llmExtractorStats: z
    .object({
      calls: z.number().int().nonnegative(),
      avgCallDurationSeconds: z.number().nonnegative(),
      p50CallDurationSeconds: z.number().nonnegative(),
      p95CallDurationSeconds: z.number().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      inputCostUsd: z.number().nonnegative(),
      outputCostUsd: z.number().nonnegative(),
      totalCostUsd: z.number().nonnegative(),
    })
    .optional(),
  llmTotalStats: z
    .object({
      calls: z.number().int().nonnegative(),
      avgCallDurationSeconds: z.number().nonnegative(),
      p50CallDurationSeconds: z.number().nonnegative(),
      p95CallDurationSeconds: z.number().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      inputCostUsd: z.number().nonnegative(),
      outputCostUsd: z.number().nonnegative(),
      totalCostUsd: z.number().nonnegative(),
    })
    .optional(),
});

export const crawlerStartRunRequestV2Fixture = crawlerStartRunRequestV2Schema.parse({
  contractVersion: 'v2',
  workerType: 'crawler',
  runId: 'crawl-run-v2-fixture-001',
  idempotencyKey: 'idmp-crawler-v2-fixture-001',
  requestedAt: '2026-03-05T10:00:00.000Z',
  correlationId: 'corr-v2-fixture-001',
  runtimeSnapshot: {
    crawlerMaxConcurrency: 3,
    crawlerMaxRequestsPerMinute: 60,
  },
  inputRef: {
    source: 'jobs.cz',
    searchSpaceId: 'prague-tech-jobs',
    searchSpaceSnapshot: {
      name: 'Prague Tech Jobs',
      description: 'Jobs.cz search pages for Prague tech roles.',
      startUrls: [
        'https://www.jobs.cz/prace/praha/?q=software',
        'https://www.jobs.cz/prace/praha/?q=data',
      ],
      maxItems: 200,
      allowInactiveMarking: true,
    },
    emitDetailCapturedEvents: true,
  },
  persistenceTargets: {
    dbName: 'crawl-ops-prague-tech',
  },
  artifactSink: {
    type: 'gcs',
    bucket: 'crawl-ops-artifacts',
    prefix: 'runs/',
  },
  timeouts: {
    hardTimeoutSeconds: 7200,
    idleTimeoutSeconds: 300,
  },
});

export const ingestionStartRunRequestV2Fixture = ingestionStartRunRequestV2Schema.parse({
  contractVersion: 'v2',
  workerType: 'ingestion',
  runId: 'ingestion-run-v2-fixture-001',
  idempotencyKey: 'idmp-ingestion-v2-fixture-001',
  requestedAt: '2026-03-05T10:00:00.000Z',
  correlationId: 'corr-v2-fixture-001',
  runtimeSnapshot: {
    ingestionConcurrency: 4,
  },
  persistenceTargets: {
    dbName: 'crawl-ops-prague-tech',
  },
  inputRef: {
    crawlRunId: 'crawl-run-v2-fixture-001',
    searchSpaceId: 'prague-tech-jobs',
    records: [
      {
        source: 'jobs.cz',
        sourceId: '2000905774',
        dedupeKey: 'jobs.cz:prague-tech-jobs:crawl-run-v2-fixture-001:2000905774',
        detailHtmlPath:
          'gs://crawl-ops-artifacts/runs/crawl-run-v2-fixture-001/records/job-html-2000905774.html',
        listingRecord: {
          sourceId: '2000905774',
          adUrl: 'https://www.jobs.cz/rpd/2000905774/',
          jobTitle: 'Senior Software Engineer',
          companyName: 'JobCompass Labs',
          location: 'Prague',
          salary: null,
          publishedInfoText: 'Aktualizováno dnes',
          scrapedAt: '2026-03-05T10:00:30.000Z',
          source: 'jobs.cz',
          htmlDetailPageKey: 'job-html-2000905774.html',
        },
      },
    ],
  },
  outputSinks: [{ type: 'downloadable_json' }],
});

export const startRunAcceptedResponseV2Fixture = startRunAcceptedResponseV2Schema.parse({
  contractVersion: 'v2',
  ok: true,
  runId: 'crawl-run-v2-fixture-001',
  workerType: 'crawler',
  accepted: true,
  deduplicated: false,
  state: 'accepted',
  message: 'Run accepted for execution.',
});

export const workerLifecycleEventV2Fixtures = [
  crawlerRunStartedEventV2Schema.parse({
    eventId: 'evt-v2-crawler-started-001',
    eventVersion: 'v2',
    eventType: 'crawler.run.started',
    occurredAt: '2026-03-05T10:00:05.000Z',
    runId: 'crawl-run-v2-fixture-001',
    correlationId: 'corr-v2-fixture-001',
    producer: 'crawler-worker',
    payload: {
      runId: 'crawl-run-v2-fixture-001',
      workerType: 'crawler',
      status: 'running',
      counters: {
        listPagesVisited: 1,
      },
    },
  }),
  ingestionRunFinishedEventV2Schema.parse({
    eventId: 'evt-v2-ingestion-finished-001',
    eventVersion: 'v2',
    eventType: 'ingestion.run.finished',
    occurredAt: '2026-03-05T10:18:10.000Z',
    runId: 'crawl-run-v2-fixture-001',
    correlationId: 'corr-v2-fixture-001',
    producer: 'ingestion-worker',
    payload: {
      runId: 'crawl-run-v2-fixture-001',
      workerType: 'ingestion',
      status: 'completed_with_errors',
      counters: {
        jobsProcessed: 14,
        jobsFailed: 1,
      },
    },
  }),
] as const;

export const crawlRunSummaryProjectionV2Fixture = crawlRunSummaryProjectionV2Schema.parse({
  crawlRunId: 'crawl-run-v2-fixture-001',
  source: 'jobs.cz',
  status: 'succeeded',
  startedAt: '2026-03-05T10:00:05.000Z',
  finishedAt: '2026-03-05T10:10:15.000Z',
  stopReason: 'completed',
  newJobsCount: 15,
  existingJobsCount: 1631,
  inactiveMarkedCount: 12,
  datasetRecordsStored: 15,
  failedRequests: 0,
});

export const ingestionRunSummaryProjectionV2Fixture = ingestionRunSummaryProjectionV2Schema.parse({
  runId: 'ingestion-run-v2-fixture-001',
  crawlRunId: 'crawl-run-v2-fixture-001',
  status: 'completed_with_errors',
  startedAt: '2026-03-05T10:10:20.000Z',
  completedAt: '2026-03-05T10:18:10.000Z',
  parserVersion: 'jobs-ingestion-service-v2.0.0',
  extractorModel: 'gemini-3-flash-preview',
  jobsTotal: 15,
  jobsProcessed: 14,
  processedJobIds: Array.from({ length: 14 }, (_, index) => `jobs.cz:${2000905700 + index}`),
  jobsSkippedIncomplete: 0,
  skippedIncompleteJobIds: [],
  jobsFailed: 1,
  failedJobIds: ['jobs.cz:2000905774'],
  jobsSuccessRate: 14 / 15,
  jobsNonSuccessRate: 1 / 15,
  jobsNonSuccess: 1,
  nonSuccessJobIds: ['jobs.cz:2000905774'],
  totalTokens: 183_220,
  totalEstimatedCostUsd: 0.7421,
});

export type V2StartRunRequest = z.infer<typeof startRunRequestV2Schema>;
export type V2StartRunResponse = z.infer<typeof startRunResponseV2Schema>;
export type V2WorkerLifecycleEvent = z.infer<typeof workerLifecycleEventV2Schema>;
export type V2CrawlRunSummaryProjection = z.infer<typeof crawlRunSummaryProjectionV2Schema>;
export type V2IngestionRunSummaryProjection = z.infer<typeof ingestionRunSummaryProjectionV2Schema>;
