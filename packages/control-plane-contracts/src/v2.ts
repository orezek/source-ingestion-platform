import { randomUUID } from 'node:crypto';
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
export const v2PipelineModeSchema = z.enum(['crawl_only', 'crawl_and_ingest']);
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
  mode: v2PipelineModeSchema,
  searchSpaceId: nonEmptyStringSchema,
  runtimeProfileId: nonEmptyStringSchema,
  structuredOutputDestinationIds: z.array(nonEmptyStringSchema).default([]),
});

export const crawlerRuntimeSnapshotV2Schema = z.object({
  crawlerMaxConcurrency: z.number().int().positive().optional(),
  crawlerMaxRequestsPerMinute: z.number().int().positive().optional(),
});

export const ingestionRuntimeSnapshotV2Schema = z.object({
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

export const v2DownloadableJsonDeliverySchema = z.discriminatedUnion('storageType', [
  z.object({
    storageType: z.literal('local_filesystem'),
    basePath: nonEmptyStringSchema,
    prefix: optionalStringSchema.default(''),
  }),
  z.object({
    storageType: z.literal('gcs'),
    bucket: nonEmptyStringSchema,
    prefix: optionalStringSchema.default(''),
  }),
]);

export const v2OutputSinkSchema = z
  .object({
    type: z.literal('downloadable_json'),
    delivery: v2DownloadableJsonDeliverySchema,
  })
  .strict();

const v2IngestionCancelStartupRollbackDetailsSchema = z
  .object({
    failedWorker: z.literal('crawler').default('crawler'),
    failedAction: z.literal('start_run').default('start_run'),
    errorCode: optionalStringSchema,
    errorMessage: optionalStringSchema,
  })
  .strict();

const v2IngestionCancelOperatorRequestDetailsSchema = z
  .object({
    requestedBy: z.enum(['operator', 'control_service']).default('control_service'),
    requestedAt: isoDateTimeSchema.optional(),
    note: optionalStringSchema,
  })
  .strict();

export const ingestionCancelRunRequestV2Schema = z.discriminatedUnion('reason', [
  z
    .object({
      reason: z.literal('startup_rollback'),
      details: v2IngestionCancelStartupRollbackDetailsSchema.optional(),
    })
    .strict(),
  z
    .object({
      reason: z.literal('operator_request'),
      details: v2IngestionCancelOperatorRequestDetailsSchema.optional(),
    })
    .strict(),
]);

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

export const v2SourceListingRecordSchema = z.object({
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

export const v2StoredArtifactRefSchema = z.object({
  artifactType: z.literal('html'),
  storageType: z.enum(['local_filesystem', 'gcs']),
  storagePath: nonEmptyStringSchema,
  checksum: nonEmptyStringSchema,
  sizeBytes: z.number().int().positive(),
});

export const v2IngestionInputRefSchema = z.object({
  crawlRunId: nonEmptyStringSchema,
  searchSpaceId: nonEmptyStringSchema,
});

export const v2RunTimeoutsSchema = z.object({
  hardTimeoutSeconds: z.number().int().positive().optional(),
  idleTimeoutSeconds: z.number().int().positive().optional(),
});

const v2StartRunRequestBaseSchema = z.object({
  contractVersion: v2ContractVersionSchema.default('v2'),
  runId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
  persistenceTargets: v2PersistenceTargetsSchema,
  timeouts: v2RunTimeoutsSchema.optional(),
});

export const crawlerStartRunRequestV2Schema = v2StartRunRequestBaseSchema
  .extend({
    runtimeSnapshot: crawlerRuntimeSnapshotV2Schema,
    inputRef: v2CrawlerInputRefSchema,
    artifactSink: v2ArtifactSinkSchema,
  })
  .strict();

export const ingestionStartRunRequestV2Schema = v2StartRunRequestBaseSchema
  .extend({
    runtimeSnapshot: ingestionRuntimeSnapshotV2Schema,
    inputRef: v2IngestionInputRefSchema,
    outputSinks: z.array(v2OutputSinkSchema).default([]),
  })
  .strict();

export const startRunRequestV2Schema = z.union([
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

export const v2WorkerLifecycleEnvelopeSchema = z.object({
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

export const crawlerDetailCapturedPayloadV2Schema = z.object({
  crawlRunId: nonEmptyStringSchema,
  searchSpaceId: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  listingRecord: v2SourceListingRecordSchema,
  artifact: v2StoredArtifactRefSchema,
  dedupeKey: nonEmptyStringSchema,
});

export const crawlerDetailCapturedEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('crawler.detail.captured'),
  payload: crawlerDetailCapturedPayloadV2Schema,
});

export const crawlerRunFinishedPayloadV2Schema = z.object({
  crawlRunId: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  searchSpaceId: nonEmptyStringSchema,
  status: z.enum(['succeeded', 'completed_with_errors', 'failed', 'stopped']),
  stopReason: optionalStringSchema,
});

export const crawlerRunFinishedEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('crawler.run.finished'),
  payload: crawlerRunFinishedPayloadV2Schema,
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

export const ingestionItemBasePayloadV2Schema = z.object({
  crawlRunId: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  dedupeKey: nonEmptyStringSchema,
});

export const ingestionItemStartedPayloadV2Schema = ingestionItemBasePayloadV2Schema;

export const ingestionItemSucceededPayloadV2Schema = ingestionItemBasePayloadV2Schema.extend({
  documentId: nonEmptyStringSchema,
});

export const ingestionItemFailedPayloadV2Schema = ingestionItemBasePayloadV2Schema.extend({
  error: z.object({
    name: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
  }),
});

export const ingestionItemRejectedPayloadV2Schema = ingestionItemBasePayloadV2Schema.extend({
  reason: optionalStringSchema,
});

export const ingestionItemStartedEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('ingestion.item.started'),
  payload: ingestionItemStartedPayloadV2Schema,
});

export const ingestionItemSucceededEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('ingestion.item.succeeded'),
  payload: ingestionItemSucceededPayloadV2Schema,
});

export const ingestionItemFailedEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('ingestion.item.failed'),
  payload: ingestionItemFailedPayloadV2Schema,
});

export const ingestionItemRejectedEventV2Schema = v2WorkerLifecycleEnvelopeSchema.extend({
  eventType: z.literal('ingestion.item.rejected'),
  payload: ingestionItemRejectedPayloadV2Schema,
});

export const workerLifecycleEventV2Schema = z.discriminatedUnion('eventType', [
  crawlerRunStartedEventV2Schema,
  crawlerRunFinishedEventV2Schema,
  ingestionRunStartedEventV2Schema,
  ingestionRunFinishedEventV2Schema,
]);

export const runtimeBrokerEventV2Schema = z.discriminatedUnion('eventType', [
  crawlerRunStartedEventV2Schema,
  crawlerDetailCapturedEventV2Schema,
  crawlerRunFinishedEventV2Schema,
  ingestionRunStartedEventV2Schema,
  ingestionItemStartedEventV2Schema,
  ingestionItemSucceededEventV2Schema,
  ingestionItemFailedEventV2Schema,
  ingestionItemRejectedEventV2Schema,
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
  runId: 'crawl-run-v2-fixture-001',
  idempotencyKey: 'idmp-crawler-v2-fixture-001',
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
  runId: 'ingestion-run-v2-fixture-001',
  idempotencyKey: 'idmp-ingestion-v2-fixture-001',
  runtimeSnapshot: {
    ingestionConcurrency: 4,
  },
  persistenceTargets: {
    dbName: 'crawl-ops-prague-tech',
  },
  inputRef: {
    crawlRunId: 'crawl-run-v2-fixture-001',
    searchSpaceId: 'prague-tech-jobs',
  },
  outputSinks: [
    {
      type: 'downloadable_json',
      delivery: {
        storageType: 'gcs',
        bucket: 'crawl-ops-artifacts',
        prefix: 'pipelines/pipeline-v2-fixture-001/runs/ingestion-run-v2-fixture-001/outputs',
      },
    },
  ],
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
    correlationId: 'crawl-run-v2-fixture-001',
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
    runId: 'ingestion-run-v2-fixture-001',
    correlationId: 'ingestion-run-v2-fixture-001',
    producer: 'ingestion-worker',
    payload: {
      runId: 'ingestion-run-v2-fixture-001',
      workerType: 'ingestion',
      status: 'completed_with_errors',
      counters: {
        jobsProcessed: 14,
        jobsFailed: 1,
      },
    },
  }),
] as const;

export const runtimeBrokerEventV2Fixtures = [
  crawlerDetailCapturedEventV2Schema.parse({
    eventId: 'evt-v2-crawler-detail-001',
    eventVersion: 'v2',
    eventType: 'crawler.detail.captured',
    occurredAt: '2026-03-05T10:02:30.000Z',
    runId: 'crawl-run-v2-fixture-001',
    correlationId: 'jobs.cz:prague-tech-jobs:crawl-run-v2-fixture-001:2000905774',
    producer: 'crawler-worker',
    payload: {
      crawlRunId: 'crawl-run-v2-fixture-001',
      searchSpaceId: 'prague-tech-jobs',
      source: 'jobs.cz',
      sourceId: '2000905774',
      listingRecord: {
        sourceId: '2000905774',
        adUrl: 'https://www.jobs.cz/rpd/2000905774/',
        jobTitle: 'Senior Software Engineer',
        companyName: 'OmniCrawl Labs',
        location: 'Prague',
        salary: null,
        publishedInfoText: 'Aktualizováno dnes',
        scrapedAt: '2026-03-05T10:02:29.000Z',
        source: 'jobs.cz',
        htmlDetailPageKey: 'job-html-2000905774.html',
      },
      artifact: {
        artifactType: 'html',
        storageType: 'gcs',
        storagePath:
          'gs://crawl-ops-artifacts/runs/crawl-run-v2-fixture-001/records/job-html-2000905774.html',
        checksum: 'sha256:fixture',
        sizeBytes: 2048,
      },
      dedupeKey: 'jobs.cz:prague-tech-jobs:crawl-run-v2-fixture-001:2000905774',
    },
  }),
  crawlerRunFinishedEventV2Schema.parse({
    eventId: 'evt-v2-crawler-finished-001',
    eventVersion: 'v2',
    eventType: 'crawler.run.finished',
    occurredAt: '2026-03-05T10:10:15.000Z',
    runId: 'crawl-run-v2-fixture-001',
    correlationId: 'crawl-run-v2-fixture-001',
    producer: 'crawler-worker',
    payload: {
      crawlRunId: 'crawl-run-v2-fixture-001',
      source: 'jobs.cz',
      searchSpaceId: 'prague-tech-jobs',
      status: 'succeeded',
      stopReason: 'completed',
    },
  }),
  ingestionItemSucceededEventV2Schema.parse({
    eventId: 'evt-v2-ingestion-item-succeeded-001',
    eventVersion: 'v2',
    eventType: 'ingestion.item.succeeded',
    occurredAt: '2026-03-05T10:12:10.000Z',
    runId: 'ingestion-run-v2-fixture-001',
    correlationId: 'jobs.cz:prague-tech-jobs:crawl-run-v2-fixture-001:2000905774',
    producer: 'ingestion-worker',
    payload: {
      crawlRunId: 'crawl-run-v2-fixture-001',
      source: 'jobs.cz',
      sourceId: '2000905774',
      dedupeKey: 'jobs.cz:prague-tech-jobs:crawl-run-v2-fixture-001:2000905774',
      documentId: 'jobs.cz:2000905774',
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

export const v2ControlPlanePipelineStatusSchema = z.enum(['active', 'deleted']);

export const v2ControlPlaneSearchSpaceSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    description: optionalStringSchema.default(''),
    startUrls: z.array(z.url()).min(1),
    maxItems: z.number().int().positive(),
    allowInactiveMarking: z.boolean(),
  })
  .strict();

export const v2ControlPlaneRuntimeProfileSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    crawlerMaxConcurrency: z.number().int().positive().optional(),
    crawlerMaxRequestsPerMinute: z.number().int().positive().optional(),
    ingestionConcurrency: z.number().int().positive().optional(),
    ingestionEnabled: z.boolean().default(true),
    debugLog: z.boolean().default(false),
  })
  .strict();

export const v2ControlPlaneStructuredOutputDestinationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('mongodb'),
  }),
  z.object({
    type: z.literal('downloadable_json'),
  }),
]);

export const v2ControlPlaneStructuredOutputSchema = z
  .object({
    destinations: z.array(v2ControlPlaneStructuredOutputDestinationSchema).default([]),
  })
  .strict();

export const createControlPlanePipelineRequestV2Schema = z
  .object({
    name: nonEmptyStringSchema,
    source: nonEmptyStringSchema,
    mode: v2PipelineModeSchema,
    searchSpace: v2ControlPlaneSearchSpaceSchema,
    runtimeProfile: v2ControlPlaneRuntimeProfileSchema,
    structuredOutput: v2ControlPlaneStructuredOutputSchema,
  })
  .strict();

export const updateControlPlanePipelineRequestV2Schema = z
  .object({
    name: nonEmptyStringSchema,
  })
  .strict();

export const controlPlanePipelineV2Schema = createControlPlanePipelineRequestV2Schema
  .extend({
    pipelineId: nonEmptyStringSchema,
    dbName: nonEmptyStringSchema,
    version: z.number().int().positive(),
    status: v2ControlPlanePipelineStatusSchema.default('active'),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const controlServiceStartPipelineRunRequestV2Schema = z.object({}).strict();
export const controlServiceCancelRunRequestV2Schema = z.object({}).strict();

export const controlPlaneRunWorkerCommandsV2Schema = z
  .object({
    crawler: crawlerStartRunRequestV2Schema,
    ingestion: ingestionStartRunRequestV2Schema.optional(),
  })
  .strict();

export const controlPlaneRunManifestV2Schema = z
  .object({
    runId: nonEmptyStringSchema,
    pipelineId: nonEmptyStringSchema,
    pipelineVersion: z.number().int().positive(),
    pipelineSnapshot: controlPlanePipelineV2Schema,
    workerCommands: controlPlaneRunWorkerCommandsV2Schema,
    createdAt: isoDateTimeSchema,
    createdBy: nonEmptyStringSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.pipelineId !== value.pipelineSnapshot.pipelineId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pipelineSnapshot', 'pipelineId'],
        message: 'pipelineSnapshot.pipelineId must match pipelineId.',
      });
    }

    if (value.pipelineVersion !== value.pipelineSnapshot.version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pipelineSnapshot', 'version'],
        message: 'pipelineSnapshot.version must match pipelineVersion.',
      });
    }

    if (value.workerCommands.crawler.runId !== value.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workerCommands', 'crawler', 'runId'],
        message: 'Crawler StartRun runId must match manifest runId.',
      });
    }

    if (value.workerCommands.crawler.persistenceTargets.dbName !== value.pipelineSnapshot.dbName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workerCommands', 'crawler', 'persistenceTargets', 'dbName'],
        message: 'Crawler StartRun dbName must match pipelineSnapshot.dbName.',
      });
    }

    const expectsIngestion = value.pipelineSnapshot.mode === 'crawl_and_ingest';
    if (expectsIngestion && !value.workerCommands.ingestion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workerCommands', 'ingestion'],
        message: 'Ingestion StartRun is required when pipeline mode is crawl_and_ingest.',
      });
    }

    if (!expectsIngestion && value.workerCommands.ingestion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workerCommands', 'ingestion'],
        message: 'Ingestion StartRun must be omitted when pipeline mode is crawl_only.',
      });
    }

    if (value.workerCommands.ingestion && value.workerCommands.ingestion.runId !== value.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workerCommands', 'ingestion', 'runId'],
        message: 'Ingestion StartRun runId must match manifest runId.',
      });
    }

    if (
      value.workerCommands.ingestion &&
      value.workerCommands.ingestion.persistenceTargets.dbName !== value.pipelineSnapshot.dbName
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workerCommands', 'ingestion', 'persistenceTargets', 'dbName'],
        message: 'Ingestion StartRun dbName must match pipelineSnapshot.dbName.',
      });
    }
  });

export const runtimeBrokerEventTypeV2Schema = z.enum([
  'crawler.run.started',
  'crawler.detail.captured',
  'crawler.run.finished',
  'ingestion.run.started',
  'ingestion.item.started',
  'ingestion.item.succeeded',
  'ingestion.item.failed',
  'ingestion.item.rejected',
  'ingestion.run.finished',
]);

export const v2ControlPlaneRunEventProjectionStatusSchema = z.enum(['applied', 'orphaned']);

export const controlPlaneRunEventIndexV2Schema = z
  .object({
    eventId: nonEmptyStringSchema,
    runId: nonEmptyStringSchema,
    eventType: runtimeBrokerEventTypeV2Schema,
    eventVersion: v2ContractVersionSchema.default('v2'),
    occurredAt: isoDateTimeSchema,
    correlationId: nonEmptyStringSchema,
    producer: nonEmptyStringSchema,
    crawlRunId: optionalStringSchema,
    searchSpaceId: optionalStringSchema,
    source: optionalStringSchema,
    sourceId: optionalStringSchema,
    dedupeKey: optionalStringSchema,
    payload: z.unknown(),
    projectionStatus: v2ControlPlaneRunEventProjectionStatusSchema.default('applied'),
    ingestedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const parsed = runtimeBrokerEventV2Schema.safeParse({
      eventId: value.eventId,
      eventType: value.eventType,
      eventVersion: value.eventVersion,
      occurredAt: value.occurredAt,
      runId: value.runId,
      correlationId: value.correlationId,
      producer: value.producer,
      payload: value.payload,
    });

    if (!parsed.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload'],
        message: 'payload must match runtimeBrokerEventV2Schema for the provided event envelope.',
      });
    }
  });

const nullableDateTimeSchema = z.union([isoDateTimeSchema, z.null()]);
const nullableNonNegativeIntSchema = z.number().int().nonnegative().nullable();
const nullableNonNegativeNumberSchema = z.number().nonnegative().nullable();

export const controlPlaneRunCrawlerStateV2Schema = z
  .object({
    status: v2RunStatusSchema,
    startedAt: nullableDateTimeSchema.default(null),
    finishedAt: nullableDateTimeSchema.default(null),
    detailPagesCaptured: z.number().int().nonnegative().default(0),
  })
  .strict();

export const controlPlaneRunIngestionStateV2Schema = z
  .object({
    enabled: z.boolean(),
    status: z.union([v2RunStatusSchema, z.null()]).default(null),
    startedAt: nullableDateTimeSchema.default(null),
    finishedAt: nullableDateTimeSchema.default(null),
    jobsProcessed: z.number().int().nonnegative().default(0),
    jobsFailed: z.number().int().nonnegative().default(0),
    jobsSkippedIncomplete: z.number().int().nonnegative().default(0),
  })
  .strict();

export const controlPlaneRunArtifactsV2Schema = z
  .object({
    detailCapturedCount: z.number().int().nonnegative().default(0),
  })
  .strict();

export const controlPlaneRunOutputsV2Schema = z
  .object({
    downloadableJsonEnabled: z.boolean().default(false),
    downloadableJsonCount: z.number().int().nonnegative().default(0),
  })
  .strict();

export const controlPlaneRunSummaryExcerptV2Schema = z
  .object({
    newJobsCount: nullableNonNegativeIntSchema.default(null),
    existingJobsCount: nullableNonNegativeIntSchema.default(null),
    inactiveMarkedCount: nullableNonNegativeIntSchema.default(null),
    failedRequests: nullableNonNegativeIntSchema.default(null),
    totalTokens: nullableNonNegativeIntSchema.default(null),
    totalEstimatedCostUsd: nullableNonNegativeNumberSchema.default(null),
  })
  .strict();

export const controlPlaneRunV2Schema = z
  .object({
    runId: nonEmptyStringSchema,
    pipelineId: nonEmptyStringSchema,
    pipelineName: nonEmptyStringSchema,
    mode: v2PipelineModeSchema,
    dbName: nonEmptyStringSchema,
    source: nonEmptyStringSchema,
    searchSpaceId: nonEmptyStringSchema,
    status: v2RunStatusSchema,
    requestedAt: isoDateTimeSchema,
    startedAt: nullableDateTimeSchema.default(null),
    finishedAt: nullableDateTimeSchema.default(null),
    lastEventAt: nullableDateTimeSchema.default(null),
    stopReason: z.union([nonEmptyStringSchema, z.null()]).default(null),
    crawler: controlPlaneRunCrawlerStateV2Schema,
    ingestion: controlPlaneRunIngestionStateV2Schema,
    artifacts: controlPlaneRunArtifactsV2Schema,
    outputs: controlPlaneRunOutputsV2Schema,
    summary: controlPlaneRunSummaryExcerptV2Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const expectsIngestion = value.mode === 'crawl_and_ingest';

    if (expectsIngestion !== value.ingestion.enabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ingestion', 'enabled'],
        message: 'ingestion.enabled must match whether mode is crawl_and_ingest.',
      });
    }

    if (!value.ingestion.enabled && value.ingestion.status !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ingestion', 'status'],
        message: 'ingestion.status must be null when ingestion is disabled.',
      });
    }
  });

const v2PaginationLimitSchema = z.coerce.number().int().positive().max(200);
const v2CursorQuerySchema = optionalStringSchema;
const v2NextCursorSchema = z.union([nonEmptyStringSchema, z.null()]).default(null);

export const controlServiceErrorResponseV2Schema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: nonEmptyStringSchema,
        message: nonEmptyStringSchema,
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

export const controlServiceHealthzResponseV2Schema = z
  .object({
    ok: z.literal(true),
    serviceName: nonEmptyStringSchema,
    serviceVersion: nonEmptyStringSchema,
    now: isoDateTimeSchema,
  })
  .strict();

export const controlServiceReadyzResponseV2Schema = z
  .object({
    ok: z.boolean(),
    serviceName: nonEmptyStringSchema,
    serviceVersion: nonEmptyStringSchema,
    now: isoDateTimeSchema,
    mongoReady: z.boolean(),
    subscriptionEnabled: z.boolean(),
    consumerReady: z.boolean(),
  })
  .strict();

export const controlServiceHeartbeatResponseV2Schema = z
  .object({
    serviceName: nonEmptyStringSchema,
    serviceVersion: nonEmptyStringSchema,
    now: isoDateTimeSchema,
    mongoReady: z.boolean(),
    subscriptionEnabled: z.boolean(),
    consumerReady: z.boolean(),
    subscriptionName: optionalStringSchema,
    lastMessageReceivedAt: nullableDateTimeSchema.default(null),
    lastMessageAppliedAt: nullableDateTimeSchema.default(null),
    lastErrorAt: nullableDateTimeSchema.default(null),
  })
  .strict();

export const controlServicePubSubConfigV2Schema = z
  .object({
    gcpProjectId: nonEmptyStringSchema,
    eventsTopic: nonEmptyStringSchema,
    eventsSubscription: nonEmptyStringSchema,
    autoCreateSubscription: z.boolean().default(true),
    consumerEnabled: z.boolean().default(true),
  })
  .strict();

export const listControlPlanePipelinesQueryV2Schema = z
  .object({
    limit: v2PaginationLimitSchema.default(20),
    cursor: v2CursorQuerySchema,
  })
  .strict();

export const listControlPlanePipelinesResponseV2Schema = z
  .object({
    items: z.array(controlPlanePipelineV2Schema),
    nextCursor: v2NextCursorSchema,
  })
  .strict();

export const controlServiceStartPipelineRunAcceptedResponseV2Schema = z
  .object({
    ok: z.literal(true),
    accepted: z.literal(true),
    pipelineId: nonEmptyStringSchema,
    runId: nonEmptyStringSchema,
    status: z.enum(['queued', 'running']),
    message: optionalStringSchema,
  })
  .strict();

export const controlServiceStartPipelineRunResponseV2Schema = z.union([
  controlServiceStartPipelineRunAcceptedResponseV2Schema,
  controlServiceErrorResponseV2Schema,
]);

export const controlServiceCancelRunAcceptedResponseV2Schema = z
  .object({
    ok: z.literal(true),
    accepted: z.literal(true),
    runId: nonEmptyStringSchema,
    message: optionalStringSchema,
  })
  .strict();

export const controlServiceCancelRunResponseV2Schema = z.union([
  controlServiceCancelRunAcceptedResponseV2Schema,
  controlServiceErrorResponseV2Schema,
]);

export const listControlPlaneRunsQueryV2Schema = z
  .object({
    pipelineId: optionalStringSchema,
    status: v2RunStatusSchema.optional(),
    source: optionalStringSchema,
    limit: v2PaginationLimitSchema.default(20),
    cursor: v2CursorQuerySchema,
  })
  .strict();

export const listControlPlaneRunsResponseV2Schema = z
  .object({
    items: z.array(controlPlaneRunV2Schema),
    nextCursor: v2NextCursorSchema,
  })
  .strict();

export const listControlPlaneRunEventsQueryV2Schema = z
  .object({
    limit: v2PaginationLimitSchema.default(100),
    cursor: v2CursorQuerySchema,
  })
  .strict();

export const listControlPlaneRunEventsResponseV2Schema = z
  .object({
    items: z.array(controlPlaneRunEventIndexV2Schema),
    nextCursor: v2NextCursorSchema,
  })
  .strict();

export const controlServiceStreamQueryV2Schema = z
  .object({
    pipelineId: optionalStringSchema,
    runId: optionalStringSchema,
  })
  .strict();

export const controlServiceSseHelloDataV2Schema = z
  .object({
    connectedAt: isoDateTimeSchema,
    filters: controlServiceStreamQueryV2Schema,
    heartbeatIntervalSeconds: z.number().int().positive().default(15),
  })
  .strict();

export const controlServiceSseRunUpsertedDataV2Schema = z
  .object({
    run: controlPlaneRunV2Schema,
  })
  .strict();

export const controlServiceSseRunEventAppendedDataV2Schema = z
  .object({
    event: controlPlaneRunEventIndexV2Schema,
  })
  .strict();

export const controlServiceSseHeartbeatDataV2Schema = controlServiceHeartbeatResponseV2Schema;

const controlServiceSseEnvelopeBaseV2Schema = z
  .object({
    id: nonEmptyStringSchema,
  })
  .strict();

export const controlServiceSseHelloEventV2Schema = controlServiceSseEnvelopeBaseV2Schema.extend({
  event: z.literal('stream.hello'),
  data: controlServiceSseHelloDataV2Schema,
});

export const controlServiceSseRunUpsertedEventV2Schema =
  controlServiceSseEnvelopeBaseV2Schema.extend({
    event: z.literal('run.upserted'),
    data: controlServiceSseRunUpsertedDataV2Schema,
  });

export const controlServiceSseRunEventAppendedEventV2Schema =
  controlServiceSseEnvelopeBaseV2Schema.extend({
    event: z.literal('run.event.appended'),
    data: controlServiceSseRunEventAppendedDataV2Schema,
  });

export const controlServiceSseHeartbeatEventV2Schema = controlServiceSseEnvelopeBaseV2Schema.extend(
  {
    event: z.literal('stream.heartbeat'),
    data: controlServiceSseHeartbeatDataV2Schema,
  },
);

export const controlServiceSseEventV2Schema = z.discriminatedUnion('event', [
  controlServiceSseHelloEventV2Schema,
  controlServiceSseRunUpsertedEventV2Schema,
  controlServiceSseRunEventAppendedEventV2Schema,
  controlServiceSseHeartbeatEventV2Schema,
]);

export const createControlPlanePipelineRequestV2Fixture =
  createControlPlanePipelineRequestV2Schema.parse({
    name: 'Prague Tech Pipeline',
    source: 'jobs.cz',
    mode: 'crawl_and_ingest',
    searchSpace: {
      id: 'prague-tech-jobs',
      name: 'Prague Tech Jobs',
      description: 'Jobs.cz search pages for Prague tech roles.',
      startUrls: [
        'https://www.jobs.cz/prace/praha/?q=software',
        'https://www.jobs.cz/prace/praha/?q=data',
      ],
      maxItems: 200,
      allowInactiveMarking: true,
    },
    runtimeProfile: {
      id: 'runtime-prague-tech',
      name: 'Prague Tech Runtime',
      crawlerMaxConcurrency: 3,
      crawlerMaxRequestsPerMinute: 60,
      ingestionConcurrency: 4,
      ingestionEnabled: true,
      debugLog: false,
    },
    structuredOutput: {
      destinations: [{ type: 'mongodb' }, { type: 'downloadable_json' }],
    },
  });

export const updateControlPlanePipelineRequestV2Fixture =
  updateControlPlanePipelineRequestV2Schema.parse({
    name: 'Prague Tech Pipeline Renamed',
  });

export const controlPlanePipelineV2Fixture = controlPlanePipelineV2Schema.parse({
  pipelineId: 'pipeline-v2-fixture-001',
  dbName: 'crawl-ops-prague-tech',
  version: 1,
  status: 'active',
  createdAt: '2026-03-05T09:59:00.000Z',
  updatedAt: '2026-03-05T09:59:00.000Z',
  ...createControlPlanePipelineRequestV2Fixture,
});

export const controlServiceStartPipelineRunRequestV2Fixture =
  controlServiceStartPipelineRunRequestV2Schema.parse({});

export const controlServiceCancelRunRequestV2Fixture = controlServiceCancelRunRequestV2Schema.parse(
  {},
);

export const ingestionCancelRunRequestV2Fixture = ingestionCancelRunRequestV2Schema.parse({
  reason: 'operator_request',
  details: {
    requestedBy: 'operator',
    requestedAt: '2026-03-05T10:15:00.000Z',
    note: 'Cancelled from control center.',
  },
});

export const controlPlaneRunManifestV2Fixture = controlPlaneRunManifestV2Schema.parse({
  runId: 'crawl-run-v2-fixture-001',
  pipelineId: controlPlanePipelineV2Fixture.pipelineId,
  pipelineVersion: controlPlanePipelineV2Fixture.version,
  pipelineSnapshot: controlPlanePipelineV2Fixture,
  workerCommands: {
    crawler: crawlerStartRunRequestV2Schema.parse({
      ...crawlerStartRunRequestV2Fixture,
      runId: 'crawl-run-v2-fixture-001',
      idempotencyKey: 'idmp-crawl-run-v2-fixture-001',
      persistenceTargets: {
        dbName: controlPlanePipelineV2Fixture.dbName,
      },
      inputRef: {
        ...crawlerStartRunRequestV2Fixture.inputRef,
        searchSpaceId: controlPlanePipelineV2Fixture.searchSpace.id,
      },
    }),
    ingestion: ingestionStartRunRequestV2Schema.parse({
      ...ingestionStartRunRequestV2Fixture,
      runId: 'crawl-run-v2-fixture-001',
      idempotencyKey: 'idmp-crawl-run-v2-fixture-001',
      persistenceTargets: {
        dbName: controlPlanePipelineV2Fixture.dbName,
      },
      inputRef: {
        crawlRunId: 'crawl-run-v2-fixture-001',
        searchSpaceId: controlPlanePipelineV2Fixture.searchSpace.id,
      },
    }),
  },
  createdAt: '2026-03-05T10:00:00.000Z',
  createdBy: 'control-service',
});

export const controlPlaneRunEventIndexV2Fixture = controlPlaneRunEventIndexV2Schema.parse({
  eventId: 'evt-v2-crawler-detail-001',
  runId: 'crawl-run-v2-fixture-001',
  eventType: 'crawler.detail.captured',
  eventVersion: 'v2',
  occurredAt: '2026-03-05T10:02:30.000Z',
  correlationId: 'jobs.cz:prague-tech-jobs:crawl-run-v2-fixture-001:2000905774',
  producer: 'crawler-worker',
  crawlRunId: 'crawl-run-v2-fixture-001',
  searchSpaceId: 'prague-tech-jobs',
  source: 'jobs.cz',
  sourceId: '2000905774',
  dedupeKey: 'jobs.cz:prague-tech-jobs:crawl-run-v2-fixture-001:2000905774',
  payload: runtimeBrokerEventV2Fixtures[0].payload,
  projectionStatus: 'applied',
  ingestedAt: '2026-03-05T10:02:30.300Z',
});

export const controlPlaneRunV2Fixture = controlPlaneRunV2Schema.parse({
  runId: 'crawl-run-v2-fixture-001',
  pipelineId: controlPlanePipelineV2Fixture.pipelineId,
  pipelineName: controlPlanePipelineV2Fixture.name,
  mode: 'crawl_and_ingest',
  dbName: controlPlanePipelineV2Fixture.dbName,
  source: controlPlanePipelineV2Fixture.source,
  searchSpaceId: controlPlanePipelineV2Fixture.searchSpace.id,
  status: 'running',
  requestedAt: '2026-03-05T10:00:00.000Z',
  startedAt: '2026-03-05T10:00:05.000Z',
  finishedAt: null,
  lastEventAt: '2026-03-05T10:02:30.000Z',
  stopReason: null,
  crawler: {
    status: 'running',
    startedAt: '2026-03-05T10:00:05.000Z',
    finishedAt: null,
    detailPagesCaptured: 1,
  },
  ingestion: {
    enabled: true,
    status: 'running',
    startedAt: '2026-03-05T10:00:03.000Z',
    finishedAt: null,
    jobsProcessed: 0,
    jobsFailed: 0,
    jobsSkippedIncomplete: 0,
  },
  artifacts: {
    detailCapturedCount: 1,
  },
  outputs: {
    downloadableJsonEnabled: true,
    downloadableJsonCount: 0,
  },
  summary: {
    newJobsCount: null,
    existingJobsCount: null,
    inactiveMarkedCount: null,
    failedRequests: null,
    totalTokens: null,
    totalEstimatedCostUsd: null,
  },
});

export const controlServiceHealthzResponseV2Fixture = controlServiceHealthzResponseV2Schema.parse({
  ok: true,
  serviceName: 'control-service',
  serviceVersion: '2.0.0',
  now: '2026-03-05T10:00:00.000Z',
});

export const controlServiceReadyzResponseV2Fixture = controlServiceReadyzResponseV2Schema.parse({
  ok: true,
  serviceName: 'control-service',
  serviceVersion: '2.0.0',
  now: '2026-03-05T10:00:00.000Z',
  mongoReady: true,
  subscriptionEnabled: true,
  consumerReady: true,
});

export const controlServiceHeartbeatResponseV2Fixture =
  controlServiceHeartbeatResponseV2Schema.parse({
    serviceName: 'control-service',
    serviceVersion: '2.0.0',
    now: '2026-03-05T10:05:00.000Z',
    mongoReady: true,
    subscriptionEnabled: true,
    consumerReady: true,
    subscriptionName: 'control-service-run-events-sub',
    lastMessageReceivedAt: '2026-03-05T10:04:58.000Z',
    lastMessageAppliedAt: '2026-03-05T10:04:58.100Z',
    lastErrorAt: null,
  });

export const controlServicePubSubConfigV2Fixture = controlServicePubSubConfigV2Schema.parse({
  gcpProjectId: 'omnicrawl-prod',
  eventsTopic: 'run-events',
  eventsSubscription: 'control-service-events-subscription',
  autoCreateSubscription: true,
  consumerEnabled: true,
});

export const listControlPlanePipelinesQueryV2Fixture = listControlPlanePipelinesQueryV2Schema.parse(
  {
    limit: 20,
  },
);

export const listControlPlanePipelinesResponseV2Fixture =
  listControlPlanePipelinesResponseV2Schema.parse({
    items: [controlPlanePipelineV2Fixture],
    nextCursor: null,
  });

export const controlServiceStartPipelineRunAcceptedResponseV2Fixture =
  controlServiceStartPipelineRunAcceptedResponseV2Schema.parse({
    ok: true,
    accepted: true,
    pipelineId: controlPlanePipelineV2Fixture.pipelineId,
    runId: controlPlaneRunV2Fixture.runId,
    status: 'queued',
    message: 'Run queued for worker dispatch.',
  });

export const controlServiceCancelRunAcceptedResponseV2Fixture =
  controlServiceCancelRunAcceptedResponseV2Schema.parse({
    ok: true,
    accepted: true,
    runId: controlPlaneRunV2Fixture.runId,
    message: 'Cancellation accepted.',
  });

export const listControlPlaneRunsQueryV2Fixture = listControlPlaneRunsQueryV2Schema.parse({
  pipelineId: controlPlanePipelineV2Fixture.pipelineId,
  status: 'running',
  source: controlPlaneRunV2Fixture.source,
  limit: 20,
});

export const listControlPlaneRunsResponseV2Fixture = listControlPlaneRunsResponseV2Schema.parse({
  items: [controlPlaneRunV2Fixture],
  nextCursor: null,
});

export const listControlPlaneRunEventsQueryV2Fixture = listControlPlaneRunEventsQueryV2Schema.parse(
  {
    limit: 100,
  },
);

export const listControlPlaneRunEventsResponseV2Fixture =
  listControlPlaneRunEventsResponseV2Schema.parse({
    items: [controlPlaneRunEventIndexV2Fixture],
    nextCursor: null,
  });

export const controlServiceStreamQueryV2Fixture = controlServiceStreamQueryV2Schema.parse({
  runId: controlPlaneRunV2Fixture.runId,
});

export const controlServiceSseHelloEventV2Fixture = controlServiceSseHelloEventV2Schema.parse({
  id: 'stream-evt-001',
  event: 'stream.hello',
  data: {
    connectedAt: '2026-03-05T10:05:00.000Z',
    filters: controlServiceStreamQueryV2Fixture,
    heartbeatIntervalSeconds: 15,
  },
});

export const controlServiceSseRunUpsertedEventV2Fixture =
  controlServiceSseRunUpsertedEventV2Schema.parse({
    id: 'stream-evt-002',
    event: 'run.upserted',
    data: {
      run: controlPlaneRunV2Fixture,
    },
  });

export const controlServiceSseRunEventAppendedEventV2Fixture =
  controlServiceSseRunEventAppendedEventV2Schema.parse({
    id: 'stream-evt-003',
    event: 'run.event.appended',
    data: {
      event: controlPlaneRunEventIndexV2Fixture,
    },
  });

export const controlServiceSseHeartbeatEventV2Fixture =
  controlServiceSseHeartbeatEventV2Schema.parse({
    id: 'stream-evt-004',
    event: 'stream.heartbeat',
    data: controlServiceHeartbeatResponseV2Fixture,
  });

const nowIso = (): string => new Date().toISOString();

export const buildCrawlerDetailCapturedEventV2 = (input: {
  runId: string;
  crawlRunId: string;
  searchSpaceId: string;
  source: string;
  sourceId: string;
  listingRecord: z.infer<typeof v2SourceListingRecordSchema>;
  artifact: z.infer<typeof v2StoredArtifactRefSchema>;
  producer?: string;
}) =>
  crawlerDetailCapturedEventV2Schema.parse({
    eventId: `evt-${randomUUID()}`,
    eventVersion: 'v2',
    eventType: 'crawler.detail.captured',
    occurredAt: nowIso(),
    runId: input.runId,
    correlationId: `${input.source}:${input.searchSpaceId}:${input.crawlRunId}:${input.sourceId}`,
    producer: input.producer ?? 'crawler-worker',
    payload: {
      crawlRunId: input.crawlRunId,
      searchSpaceId: input.searchSpaceId,
      source: input.source,
      sourceId: input.sourceId,
      listingRecord: input.listingRecord,
      artifact: input.artifact,
      dedupeKey: `${input.source}:${input.searchSpaceId}:${input.crawlRunId}:${input.sourceId}`,
    },
  });

export const buildCrawlerRunFinishedEventV2 = (input: {
  runId: string;
  crawlRunId: string;
  source: string;
  searchSpaceId: string;
  status: z.infer<typeof crawlerRunFinishedPayloadV2Schema>['status'];
  stopReason?: string;
  producer?: string;
}) =>
  crawlerRunFinishedEventV2Schema.parse({
    eventId: `evt-${randomUUID()}`,
    eventVersion: 'v2',
    eventType: 'crawler.run.finished',
    occurredAt: nowIso(),
    runId: input.runId,
    correlationId: input.runId,
    producer: input.producer ?? 'crawler-worker',
    payload: {
      crawlRunId: input.crawlRunId,
      source: input.source,
      searchSpaceId: input.searchSpaceId,
      status: input.status,
      stopReason: input.stopReason,
    },
  });

export const buildIngestionLifecycleEventV2 = (
  input:
    | {
        eventType: 'ingestion.item.started';
        runId: string;
        crawlRunId: string;
        source: string;
        sourceId: string;
        dedupeKey: string;
        producer?: string;
      }
    | {
        eventType: 'ingestion.item.succeeded';
        runId: string;
        crawlRunId: string;
        source: string;
        sourceId: string;
        dedupeKey: string;
        documentId: string;
        producer?: string;
      }
    | {
        eventType: 'ingestion.item.failed';
        runId: string;
        crawlRunId: string;
        source: string;
        sourceId: string;
        dedupeKey: string;
        error: {
          name: string;
          message: string;
        };
        producer?: string;
      }
    | {
        eventType: 'ingestion.item.rejected';
        runId: string;
        crawlRunId: string;
        source: string;
        sourceId: string;
        dedupeKey: string;
        reason: string;
        producer?: string;
      },
) => {
  const envelope = {
    eventId: `evt-${randomUUID()}`,
    eventVersion: 'v2' as const,
    occurredAt: nowIso(),
    runId: input.runId,
    correlationId: input.dedupeKey,
    producer: input.producer ?? 'ingestion-worker',
  };

  switch (input.eventType) {
    case 'ingestion.item.started':
      return ingestionItemStartedEventV2Schema.parse({
        ...envelope,
        eventType: input.eventType,
        payload: {
          crawlRunId: input.crawlRunId,
          source: input.source,
          sourceId: input.sourceId,
          dedupeKey: input.dedupeKey,
        },
      });
    case 'ingestion.item.succeeded':
      return ingestionItemSucceededEventV2Schema.parse({
        ...envelope,
        eventType: input.eventType,
        payload: {
          crawlRunId: input.crawlRunId,
          source: input.source,
          sourceId: input.sourceId,
          dedupeKey: input.dedupeKey,
          documentId: input.documentId,
        },
      });
    case 'ingestion.item.failed':
      return ingestionItemFailedEventV2Schema.parse({
        ...envelope,
        eventType: input.eventType,
        payload: {
          crawlRunId: input.crawlRunId,
          source: input.source,
          sourceId: input.sourceId,
          dedupeKey: input.dedupeKey,
          error: input.error,
        },
      });
    case 'ingestion.item.rejected':
      return ingestionItemRejectedEventV2Schema.parse({
        ...envelope,
        eventType: input.eventType,
        payload: {
          crawlRunId: input.crawlRunId,
          source: input.source,
          sourceId: input.sourceId,
          dedupeKey: input.dedupeKey,
          reason: input.reason,
        },
      });
  }
};

export type V2StartRunRequest = z.infer<typeof startRunRequestV2Schema>;
export type V2StartRunResponse = z.infer<typeof startRunResponseV2Schema>;
export type V2IngestionCancelRunRequest = z.infer<typeof ingestionCancelRunRequestV2Schema>;
export type V2WorkerLifecycleEvent = z.infer<typeof workerLifecycleEventV2Schema>;
export type V2RuntimeBrokerEvent = z.infer<typeof runtimeBrokerEventV2Schema>;
export type V2CrawlRunSummaryProjection = z.infer<typeof crawlRunSummaryProjectionV2Schema>;
export type V2IngestionRunSummaryProjection = z.infer<typeof ingestionRunSummaryProjectionV2Schema>;
