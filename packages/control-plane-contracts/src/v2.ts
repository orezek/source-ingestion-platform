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
  crawlRunSummariesCollection: nonEmptyStringSchema.default('crawl_run_summaries'),
  ingestionRunSummariesCollection: nonEmptyStringSchema.default('ingestion_run_summaries'),
  ingestionTriggerRequestsCollection: nonEmptyStringSchema.default('ingestion_trigger_requests'),
  normalizedJobAdsCollection: nonEmptyStringSchema.default('normalized_job_ads'),
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
  ingestionEnabled: z.boolean().optional(),
  debugLog: z.boolean().optional(),
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

export const v2OutputSinkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('mongodb'),
    collection: nonEmptyStringSchema.default('normalized_job_ads'),
    writeMode: z.enum(['upsert', 'overwrite']).default('upsert'),
  }),
  z.object({
    type: z.literal('downloadable_json'),
    storageType: z.enum(['local_filesystem', 'gcs']),
    targetPath: nonEmptyStringSchema,
    writeMode: z.enum(['upsert', 'overwrite']).default('overwrite'),
  }),
]);

export const v2IngestionInputRefSchema = z.object({
  crawlRunId: nonEmptyStringSchema,
  searchSpaceId: nonEmptyStringSchema,
  records: z.array(
    z.object({
      sourceId: nonEmptyStringSchema,
      dedupeKey: nonEmptyStringSchema,
      detailHtmlPath: nonEmptyStringSchema,
      datasetFileName: nonEmptyStringSchema.default('dataset.json'),
      datasetRecordIndex: z.number().int().nonnegative(),
    }),
  ),
});

export const v2RunTimeoutsSchema = z.object({
  hardTimeoutSeconds: z.number().int().positive().optional(),
  idleTimeoutSeconds: z.number().int().positive().optional(),
});

export const v2EventContextSchema = z.object({
  requestedBy: nonEmptyStringSchema.default('control-plane'),
  tags: z.record(z.string(), z.string()).default({}),
});

const v2StartRunRequestBaseSchema = z.object({
  contractVersion: v2ContractVersionSchema.default('v2'),
  runId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
  requestedAt: isoDateTimeSchema,
  correlationId: nonEmptyStringSchema,
  manifestVersion: z.number().int().positive(),
  pipelineSnapshot: v2PipelineSnapshotSchema,
  runtimeSnapshot: v2RuntimeSnapshotSchema,
  persistenceTargets: v2PersistenceTargetsSchema,
  artifactSink: v2ArtifactSinkSchema.optional(),
  outputSinks: z.array(v2OutputSinkSchema).default([]),
  eventContext: v2EventContextSchema.default({
    requestedBy: 'control-plane',
    tags: {},
  }),
  timeouts: v2RunTimeoutsSchema.optional(),
});

export const crawlerStartRunRequestV2Schema = v2StartRunRequestBaseSchema.extend({
  workerType: z.literal('crawler'),
  inputRef: z.undefined().optional(),
});

export const ingestionStartRunRequestV2Schema = v2StartRunRequestBaseSchema.extend({
  workerType: z.literal('ingestion'),
  inputRef: v2IngestionInputRefSchema,
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
  parserVersion: nonEmptyStringSchema.optional(),
  extractorModel: nonEmptyStringSchema.optional(),
  jobsTotal: z.number().int().nonnegative(),
  jobsProcessed: z.number().int().nonnegative(),
  jobsSkippedIncomplete: z.number().int().nonnegative(),
  jobsFailed: z.number().int().nonnegative(),
  jobsSuccessRate: z.number().min(0).max(1).optional(),
  jobsNonSuccessRate: z.number().min(0).max(1).optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  totalEstimatedCostUsd: z.number().nonnegative().optional(),
});

export const ingestionTriggerRequestProjectionV2Schema = z.object({
  id: nonEmptyStringSchema,
  triggerType: z.enum(['run', 'item']),
  source: nonEmptyStringSchema,
  crawlRunId: nonEmptyStringSchema,
  searchSpaceId: nonEmptyStringSchema,
  mongoDbName: nonEmptyStringSchema,
  sourceId: optionalStringSchema,
  detailHtmlPath: optionalStringSchema,
  datasetFileName: optionalStringSchema,
  datasetRecordIndex: z.number().int().nonnegative().optional(),
  status: z.enum(['pending', 'running', 'succeeded', 'completed_with_errors', 'failed']),
  requestedAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema,
  attemptCount: z.number().int().nonnegative(),
  ingestionRunId: optionalStringSchema,
  errorMessage: optionalStringSchema,
  result: z
    .object({
      jobsProcessed: z.number().int().nonnegative(),
      jobsSkippedIncomplete: z.number().int().nonnegative(),
      jobsFailed: z.number().int().nonnegative(),
      totalTokensUsed: z.number().int().nonnegative(),
      totalEstimatedCostUsd: z.number().nonnegative(),
      mongoWritesStructured: z.number().int().nonnegative(),
      mongoWritesRunSummary: z.number().int().nonnegative(),
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
  manifestVersion: 2,
  pipelineSnapshot: {
    id: 'pipeline-prague-tech',
    name: 'Prague Tech Crawl+Ingest',
    version: 7,
    mode: 'crawl_and_ingest',
    searchSpaceId: 'prague-tech-jobs',
    runtimeProfileId: 'runtime-balanced',
    structuredOutputDestinationIds: ['mongo-normalized-jobs', 'downloadable-json-default'],
  },
  runtimeSnapshot: {
    crawlerMaxConcurrency: 3,
    crawlerMaxRequestsPerMinute: 60,
    ingestionConcurrency: 4,
    ingestionEnabled: true,
    debugLog: false,
  },
  persistenceTargets: {
    dbName: 'crawl-ops-prague-tech',
    crawlRunSummariesCollection: 'crawl_run_summaries',
    ingestionRunSummariesCollection: 'ingestion_run_summaries',
    ingestionTriggerRequestsCollection: 'ingestion_trigger_requests',
    normalizedJobAdsCollection: 'normalized_job_ads',
  },
  artifactSink: {
    type: 'gcs',
    bucket: 'crawl-ops-artifacts',
    prefix: 'runs/',
  },
  outputSinks: [
    {
      type: 'mongodb',
      collection: 'normalized_job_ads',
      writeMode: 'upsert',
    },
  ],
  eventContext: {
    requestedBy: 'ops-control-plane',
    tags: {
      env: 'staging',
    },
  },
  timeouts: {
    hardTimeoutSeconds: 7200,
    idleTimeoutSeconds: 300,
  },
});

export const ingestionStartRunRequestV2Fixture = ingestionStartRunRequestV2Schema.parse({
  ...crawlerStartRunRequestV2Fixture,
  workerType: 'ingestion',
  inputRef: {
    crawlRunId: 'crawl-run-v2-fixture-001',
    searchSpaceId: 'prague-tech-jobs',
    records: [
      {
        sourceId: '2000905774',
        dedupeKey: 'jobs.cz:prague-tech-jobs:crawl-run-v2-fixture-001:2000905774',
        detailHtmlPath:
          'gs://crawl-ops-artifacts/runs/crawl-run-v2-fixture-001/records/job-html-2000905774.html',
        datasetFileName: 'dataset.json',
        datasetRecordIndex: 0,
      },
    ],
  },
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
  jobsSkippedIncomplete: 0,
  jobsFailed: 1,
  jobsSuccessRate: 14 / 15,
  jobsNonSuccessRate: 1 / 15,
  totalTokens: 183_220,
  totalEstimatedCostUsd: 0.7421,
});

export const ingestionTriggerRequestProjectionV2Fixture =
  ingestionTriggerRequestProjectionV2Schema.parse({
    id: 'item:jobs.cz:prague-tech-jobs:crawl-run-v2-fixture-001:2000905774',
    triggerType: 'item',
    source: 'jobs.cz',
    crawlRunId: 'crawl-run-v2-fixture-001',
    searchSpaceId: 'prague-tech-jobs',
    mongoDbName: 'crawl-ops-prague-tech',
    sourceId: '2000905774',
    detailHtmlPath:
      'gs://crawl-ops-artifacts/runs/crawl-run-v2-fixture-001/records/job-html-2000905774.html',
    datasetFileName: 'dataset.json',
    datasetRecordIndex: 0,
    status: 'succeeded',
    requestedAt: '2026-03-05T10:10:25.000Z',
    startedAt: '2026-03-05T10:10:27.000Z',
    completedAt: '2026-03-05T10:10:44.000Z',
    updatedAt: '2026-03-05T10:10:44.000Z',
    attemptCount: 1,
    ingestionRunId: 'ingestion-run-v2-fixture-001',
    result: {
      jobsProcessed: 1,
      jobsSkippedIncomplete: 0,
      jobsFailed: 0,
      totalTokensUsed: 11_420,
      totalEstimatedCostUsd: 0.0413,
      mongoWritesStructured: 1,
      mongoWritesRunSummary: 1,
    },
  });

export type V2StartRunRequest = z.infer<typeof startRunRequestV2Schema>;
export type V2StartRunResponse = z.infer<typeof startRunResponseV2Schema>;
export type V2WorkerLifecycleEvent = z.infer<typeof workerLifecycleEventV2Schema>;
export type V2CrawlRunSummaryProjection = z.infer<typeof crawlRunSummaryProjectionV2Schema>;
export type V2IngestionRunSummaryProjection = z.infer<typeof ingestionRunSummaryProjectionV2Schema>;
export type V2IngestionTriggerRequestProjection = z.infer<
  typeof ingestionTriggerRequestProjectionV2Schema
>;
