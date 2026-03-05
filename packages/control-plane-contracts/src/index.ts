import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

export const CONTROL_PLANE_NAME_MAX_LENGTH = 80;
export const CONTROL_PLANE_RECORD_ID_MAX_LENGTH = 64;

const controlPlaneNameSchema = nonEmptyStringSchema.max(CONTROL_PLANE_NAME_MAX_LENGTH);
const controlPlaneOptionalIdSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}, z.string().trim().min(1).max(CONTROL_PLANE_RECORD_ID_MAX_LENGTH).optional());
const controlPlaneRecordIdSchema = nonEmptyStringSchema.max(CONTROL_PLANE_RECORD_ID_MAX_LENGTH);

export const sourceTypeSchema = z.enum(['jobs_cz']);
export const managedStorageTypeSchema = z.enum(['local_filesystem', 'gcs']);
export const structuredOutputDestinationTypeSchema = z.enum(['mongodb', 'downloadable_json']);
export const pipelineModeSchema = z.enum(['crawl_only', 'crawl_and_ingest']);
export const recordStatusSchema = z.enum(['draft', 'active', 'archived']);
export const runStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'completed_with_errors',
  'failed',
  'stopped',
]);

export const searchSpaceSchema = z.object({
  id: controlPlaneRecordIdSchema,
  name: controlPlaneNameSchema,
  description: optionalStringSchema.default(''),
  sourceType: sourceTypeSchema.default('jobs_cz'),
  startUrls: z.array(z.url()).min(1),
  maxItemsDefault: z.number().int().positive().default(100),
  allowInactiveMarkingOnPartialRuns: z.boolean().default(false),
  status: recordStatusSchema.default('draft'),
  version: z.number().int().positive().default(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createSearchSpaceInputSchema = z.object({
  id: controlPlaneOptionalIdSchema,
  name: controlPlaneNameSchema,
  description: optionalStringSchema.default(''),
  sourceType: sourceTypeSchema.default('jobs_cz'),
  startUrls: z.array(z.url()).min(1),
  maxItemsDefault: z.number().int().positive().default(100),
  allowInactiveMarkingOnPartialRuns: z.boolean().default(false),
  status: recordStatusSchema.default('active'),
});

export const runtimeProfileSchema = z.object({
  id: controlPlaneRecordIdSchema,
  name: controlPlaneNameSchema,
  crawlerMaxConcurrency: z.number().int().positive().default(5),
  crawlerMaxRequestsPerMinute: z.number().int().positive().default(120),
  ingestionConcurrency: z.number().int().positive().default(1),
  ingestionEnabled: z.boolean().default(true),
  debugLog: z.boolean().default(false),
  status: z.enum(['active', 'archived']).default('active'),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createRuntimeProfileInputSchema = z.object({
  id: controlPlaneOptionalIdSchema,
  name: controlPlaneNameSchema,
  crawlerMaxConcurrency: z.number().int().positive().default(5),
  crawlerMaxRequestsPerMinute: z.number().int().positive().default(120),
  ingestionConcurrency: z.number().int().positive().default(1),
  ingestionEnabled: z.boolean().default(true),
  debugLog: z.boolean().default(false),
  status: z.enum(['active', 'archived']).default('active'),
});

export const localFilesystemStorageConfigSchema = z.object({
  basePath: nonEmptyStringSchema,
});

export const gcsStorageConfigSchema = z.object({
  bucket: nonEmptyStringSchema,
  prefix: optionalStringSchema.default(''),
});

export const artifactStorageSnapshotSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local_filesystem'),
    config: localFilesystemStorageConfigSchema,
  }),
  z.object({
    type: z.literal('gcs'),
    config: gcsStorageConfigSchema,
  }),
]);

export const mongoStructuredOutputConfigSchema = z.object({
  connectionUri: optionalStringSchema.default('env:MONGODB_URI'),
});

export const downloadableJsonStructuredOutputConfigSchema = z.object({}).default({});

const structuredOutputDestinationBaseShape = {
  id: controlPlaneOptionalIdSchema,
  name: controlPlaneNameSchema,
  status: z.enum(['active', 'archived']).default('active'),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
} as const;

const mongoStructuredOutputDestinationSchema = z.object({
  ...structuredOutputDestinationBaseShape,
  id: controlPlaneRecordIdSchema,
  type: z.literal('mongodb'),
  config: mongoStructuredOutputConfigSchema,
});

const downloadableJsonStructuredOutputDestinationSchema = z.object({
  ...structuredOutputDestinationBaseShape,
  id: controlPlaneRecordIdSchema,
  type: z.literal('downloadable_json'),
  config: downloadableJsonStructuredOutputConfigSchema,
});

export const structuredOutputDestinationSchema = z.discriminatedUnion('type', [
  mongoStructuredOutputDestinationSchema,
  downloadableJsonStructuredOutputDestinationSchema,
]);

export const createStructuredOutputDestinationInputSchema = z.discriminatedUnion('type', [
  z.object({
    id: controlPlaneOptionalIdSchema,
    name: controlPlaneNameSchema,
    type: z.literal('mongodb'),
    config: mongoStructuredOutputConfigSchema.default({
      connectionUri: 'env:MONGODB_URI',
    }),
    status: z.enum(['active', 'archived']).default('active'),
  }),
  z.object({
    id: controlPlaneOptionalIdSchema,
    name: controlPlaneNameSchema,
    type: z.literal('downloadable_json'),
    config: downloadableJsonStructuredOutputConfigSchema.optional().default({}),
    status: z.enum(['active', 'archived']).default('active'),
  }),
]);

export const localFilesystemDownloadableJsonDeliveryConfigSchema = z.object({
  storageType: z.literal('local_filesystem'),
  basePath: nonEmptyStringSchema,
});

export const gcsDownloadableJsonDeliveryConfigSchema = z.object({
  storageType: z.literal('gcs'),
  bucket: nonEmptyStringSchema,
  prefix: optionalStringSchema.default(''),
});

export const downloadableJsonDeliveryConfigSchema = z.discriminatedUnion('storageType', [
  localFilesystemDownloadableJsonDeliveryConfigSchema,
  gcsDownloadableJsonDeliveryConfigSchema,
]);

export const pipelineSchema = z.object({
  id: controlPlaneRecordIdSchema,
  name: controlPlaneNameSchema,
  searchSpaceId: controlPlaneRecordIdSchema,
  runtimeProfileId: controlPlaneRecordIdSchema,
  structuredOutputDestinationIds: z.array(controlPlaneRecordIdSchema).default([]),
  mode: pipelineModeSchema,
  status: recordStatusSchema.default('draft'),
  version: z.number().int().positive().default(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createPipelineInputSchema = z.object({
  id: controlPlaneOptionalIdSchema,
  name: controlPlaneNameSchema,
  searchSpaceId: controlPlaneRecordIdSchema,
  runtimeProfileId: controlPlaneRecordIdSchema,
  structuredOutputDestinationIds: z.array(controlPlaneRecordIdSchema).default([]),
  mode: pipelineModeSchema,
  status: recordStatusSchema.default('active'),
});

export const searchSpaceSnapshotSchema = searchSpaceSchema.pick({
  id: true,
  name: true,
  sourceType: true,
  startUrls: true,
  maxItemsDefault: true,
  allowInactiveMarkingOnPartialRuns: true,
  version: true,
});

export const runtimeProfileSnapshotSchema = runtimeProfileSchema.pick({
  id: true,
  name: true,
  crawlerMaxConcurrency: true,
  crawlerMaxRequestsPerMinute: true,
  ingestionConcurrency: true,
  ingestionEnabled: true,
  debugLog: true,
});

export const structuredOutputDestinationSnapshotSchema = z.discriminatedUnion('type', [
  mongoStructuredOutputDestinationSchema.pick({
    id: true,
    name: true,
    type: true,
    config: true,
  }),
  z.object({
    id: controlPlaneRecordIdSchema,
    name: controlPlaneNameSchema,
    type: z.literal('downloadable_json'),
    config: downloadableJsonDeliveryConfigSchema,
  }),
]);

export const runManifestSchema = z.object({
  runId: nonEmptyStringSchema,
  pipelineId: nonEmptyStringSchema,
  pipelineVersion: z.number().int().positive(),
  sourceType: sourceTypeSchema,
  mode: pipelineModeSchema,
  searchSpaceSnapshot: searchSpaceSnapshotSchema,
  runtimeProfileSnapshot: runtimeProfileSnapshotSchema,
  artifactStorageSnapshot: artifactStorageSnapshotSchema,
  structuredOutputDestinationSnapshots: z
    .array(structuredOutputDestinationSnapshotSchema)
    .default([]),
  createdAt: isoDateTimeSchema,
  createdBy: nonEmptyStringSchema.default('local-operator'),
});

export const controlPlaneRunSchema = z.object({
  runId: nonEmptyStringSchema,
  pipelineId: nonEmptyStringSchema,
  pipelineVersion: z.number().int().positive(),
  status: runStatusSchema,
  requestedAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.optional(),
  finishedAt: isoDateTimeSchema.optional(),
  stopReason: optionalStringSchema.nullable().default(null),
  summary: z.record(z.string(), z.unknown()).default({}),
});

export const startRunRequestSchema = z.object({
  pipelineId: nonEmptyStringSchema,
  createdBy: optionalStringSchema.default('local-operator'),
});

export const sourceListingRecordSchema = z.object({
  sourceId: z.string(),
  adUrl: z.url(),
  jobTitle: z.string().min(1),
  companyName: z.string().nullable(),
  location: z.string().nullable(),
  salary: z.string().nullable(),
  publishedInfoText: z.string().nullable(),
  scrapedAt: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  htmlDetailPageKey: nonEmptyStringSchema,
});

export const storedArtifactRefSchema = z.object({
  artifactType: z.literal('html'),
  storageType: z.enum(['local_filesystem', 'gcs']),
  storagePath: nonEmptyStringSchema,
  checksum: nonEmptyStringSchema,
  sizeBytes: z.number().int().positive(),
});

export const eventEnvelopeSchema = z.object({
  eventId: nonEmptyStringSchema,
  eventType: nonEmptyStringSchema,
  eventVersion: z.literal('v1'),
  occurredAt: isoDateTimeSchema,
  runId: nonEmptyStringSchema,
  correlationId: nonEmptyStringSchema,
  producer: nonEmptyStringSchema,
  payload: z.unknown(),
});

export const crawlerRunRequestedPayloadSchema = z.object({
  runManifest: runManifestSchema,
});

export const crawlerRunRequestedEventSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('crawler.run.requested'),
  payload: crawlerRunRequestedPayloadSchema,
});

export const crawlerDetailCapturedPayloadSchema = z.object({
  crawlRunId: nonEmptyStringSchema,
  searchSpaceId: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  listingRecord: sourceListingRecordSchema,
  artifact: storedArtifactRefSchema,
  dedupeKey: nonEmptyStringSchema,
});

export const crawlerDetailCapturedEventSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('crawler.detail.captured'),
  payload: crawlerDetailCapturedPayloadSchema,
});

export const crawlerRunFinishedPayloadSchema = z.object({
  crawlRunId: nonEmptyStringSchema,
  searchSpaceId: nonEmptyStringSchema,
  status: runStatusSchema,
  summaryPath: optionalStringSchema,
  datasetPath: optionalStringSchema,
  newJobsCount: z.number().int().nonnegative(),
  failedRequests: z.number().int().nonnegative(),
  stopReason: optionalStringSchema,
});

export const crawlerRunFinishedEventSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('crawler.run.finished'),
  payload: crawlerRunFinishedPayloadSchema,
});

export const ingestionLifecyclePayloadSchema = z.object({
  crawlRunId: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  dedupeKey: nonEmptyStringSchema,
  documentId: optionalStringSchema,
  sinkResults: z
    .array(
      z.object({
        sinkType: structuredOutputDestinationTypeSchema,
        targetRef: nonEmptyStringSchema,
        writeMode: z.enum(['upsert', 'overwrite']),
      }),
    )
    .optional(),
  error: z
    .object({
      name: nonEmptyStringSchema,
      message: nonEmptyStringSchema,
    })
    .optional(),
  reason: optionalStringSchema,
});

export const ingestionItemStartedEventSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('ingestion.item.started'),
  payload: ingestionLifecyclePayloadSchema,
});

export const ingestionItemSucceededEventSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('ingestion.item.succeeded'),
  payload: ingestionLifecyclePayloadSchema,
});

export const ingestionItemFailedEventSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('ingestion.item.failed'),
  payload: ingestionLifecyclePayloadSchema,
});

export const ingestionItemRejectedEventSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('ingestion.item.rejected'),
  payload: ingestionLifecyclePayloadSchema,
});

export const brokerEventSchema = z.discriminatedUnion('eventType', [
  crawlerRunRequestedEventSchema,
  crawlerDetailCapturedEventSchema,
  crawlerRunFinishedEventSchema,
  ingestionItemStartedEventSchema,
  ingestionItemSucceededEventSchema,
  ingestionItemFailedEventSchema,
  ingestionItemRejectedEventSchema,
]);

export type SearchSpace = z.infer<typeof searchSpaceSchema>;
export type CreateSearchSpaceInput = z.infer<typeof createSearchSpaceInputSchema>;
export type RuntimeProfile = z.infer<typeof runtimeProfileSchema>;
export type CreateRuntimeProfileInput = z.infer<typeof createRuntimeProfileInputSchema>;
export type StructuredOutputDestination = z.infer<typeof structuredOutputDestinationSchema>;
export type CreateStructuredOutputDestinationInput = z.infer<
  typeof createStructuredOutputDestinationInputSchema
>;
export type SearchSpaceSnapshot = z.infer<typeof searchSpaceSnapshotSchema>;
export type RuntimeProfileSnapshot = z.infer<typeof runtimeProfileSnapshotSchema>;
export type ArtifactStorageSnapshot = z.infer<typeof artifactStorageSnapshotSchema>;
export type DownloadableJsonDeliveryConfig = z.infer<typeof downloadableJsonDeliveryConfigSchema>;
export type StructuredOutputDestinationSnapshot = z.infer<
  typeof structuredOutputDestinationSnapshotSchema
>;
export type Pipeline = z.infer<typeof pipelineSchema>;
export type CreatePipelineInput = z.infer<typeof createPipelineInputSchema>;
export type RunManifest = z.infer<typeof runManifestSchema>;
export type ControlPlaneRun = z.infer<typeof controlPlaneRunSchema>;
export type StartRunRequest = z.infer<typeof startRunRequestSchema>;
export type SourceListingRecord = z.infer<typeof sourceListingRecordSchema>;
export type StoredArtifactRef = z.infer<typeof storedArtifactRefSchema>;
export type BrokerEvent = z.infer<typeof brokerEventSchema>;
export type CrawlerRunRequestedEvent = z.infer<typeof crawlerRunRequestedEventSchema>;
export type CrawlerDetailCapturedEvent = z.infer<typeof crawlerDetailCapturedEventSchema>;
export type CrawlerRunFinishedEvent = z.infer<typeof crawlerRunFinishedEventSchema>;
export type IngestionLifecycleEvent =
  | z.infer<typeof ingestionItemStartedEventSchema>
  | z.infer<typeof ingestionItemSucceededEventSchema>
  | z.infer<typeof ingestionItemFailedEventSchema>
  | z.infer<typeof ingestionItemRejectedEventSchema>;

export const nowIso = (): string => new Date().toISOString();

export const buildRecordId = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
    .slice(0, CONTROL_PLANE_RECORD_ID_MAX_LENGTH)
    .replace(/-+$/g, '');

export const buildArtifactRunDir = (root: string, crawlRunId: string): string =>
  path.join(path.resolve(root), 'runs', crawlRunId);

export const buildArtifactRecordsDir = (root: string, crawlRunId: string): string =>
  path.join(buildArtifactRunDir(root, crawlRunId), 'records');

export const buildArtifactDatasetPath = (root: string, crawlRunId: string): string =>
  path.join(buildArtifactRunDir(root, crawlRunId), 'dataset.json');

export const buildArtifactHtmlFileName = (sourceId: string): string => `job-html-${sourceId}.html`;

export const buildStructuredJsonFileName = (sourceId: string): string =>
  `normalized-job-${sourceId}.json`;

export const buildStructuredRunDir = (root: string, crawlRunId: string): string =>
  path.join(path.resolve(root), 'runs', crawlRunId, 'records');

export const buildBrokerRunDir = (root: string, runId: string): string =>
  path.join(path.resolve(root), 'runs', runId);

export const buildDedupeKey = (input: {
  source: string;
  searchSpaceId: string;
  crawlRunId: string;
  sourceId: string;
}): string => `${input.source}:${input.searchSpaceId}:${input.crawlRunId}:${input.sourceId}`;

export const buildCrawlerRunRequestedEvent = (input: {
  runManifest: RunManifest;
  producer?: string;
}): CrawlerRunRequestedEvent =>
  crawlerRunRequestedEventSchema.parse({
    eventId: `evt-${randomUUID()}`,
    eventType: 'crawler.run.requested',
    eventVersion: 'v1',
    occurredAt: nowIso(),
    runId: input.runManifest.runId,
    correlationId: input.runManifest.runId,
    producer: input.producer ?? 'control-plane',
    payload: {
      runManifest: input.runManifest,
    },
  });

export const buildCrawlerDetailCapturedEvent = (input: {
  runId: string;
  crawlRunId: string;
  searchSpaceId: string;
  source: string;
  sourceId: string;
  listingRecord: SourceListingRecord;
  artifact: StoredArtifactRef;
  producer?: string;
}): CrawlerDetailCapturedEvent =>
  crawlerDetailCapturedEventSchema.parse({
    eventId: `evt-${randomUUID()}`,
    eventType: 'crawler.detail.captured',
    eventVersion: 'v1',
    occurredAt: nowIso(),
    runId: input.runId,
    correlationId: buildDedupeKey({
      source: input.source,
      searchSpaceId: input.searchSpaceId,
      crawlRunId: input.crawlRunId,
      sourceId: input.sourceId,
    }),
    producer: input.producer ?? 'crawler-worker',
    payload: {
      crawlRunId: input.crawlRunId,
      searchSpaceId: input.searchSpaceId,
      source: input.source,
      sourceId: input.sourceId,
      listingRecord: input.listingRecord,
      artifact: input.artifact,
      dedupeKey: buildDedupeKey({
        source: input.source,
        searchSpaceId: input.searchSpaceId,
        crawlRunId: input.crawlRunId,
        sourceId: input.sourceId,
      }),
    },
  });

export const buildCrawlerRunFinishedEvent = (input: {
  runId: string;
  crawlRunId: string;
  searchSpaceId: string;
  status: ControlPlaneRun['status'];
  summaryPath?: string;
  datasetPath?: string;
  newJobsCount: number;
  failedRequests: number;
  stopReason?: string;
  producer?: string;
}): CrawlerRunFinishedEvent =>
  crawlerRunFinishedEventSchema.parse({
    eventId: `evt-${randomUUID()}`,
    eventType: 'crawler.run.finished',
    eventVersion: 'v1',
    occurredAt: nowIso(),
    runId: input.runId,
    correlationId: input.runId,
    producer: input.producer ?? 'crawler-worker',
    payload: {
      crawlRunId: input.crawlRunId,
      searchSpaceId: input.searchSpaceId,
      status: input.status,
      summaryPath: input.summaryPath,
      datasetPath: input.datasetPath,
      newJobsCount: input.newJobsCount,
      failedRequests: input.failedRequests,
      stopReason: input.stopReason,
    },
  });

export const buildIngestionLifecycleEvent = (input: {
  eventType:
    | 'ingestion.item.started'
    | 'ingestion.item.succeeded'
    | 'ingestion.item.failed'
    | 'ingestion.item.rejected';
  runId: string;
  crawlRunId: string;
  source: string;
  sourceId: string;
  dedupeKey: string;
  documentId?: string;
  sinkResults?: Array<{
    sinkType: 'mongodb' | 'downloadable_json';
    targetRef: string;
    writeMode: 'upsert' | 'overwrite';
  }>;
  error?: {
    name: string;
    message: string;
  };
  reason?: string;
  producer?: string;
}): BrokerEvent =>
  brokerEventSchema.parse({
    eventId: `evt-${randomUUID()}`,
    eventType: input.eventType,
    eventVersion: 'v1',
    occurredAt: nowIso(),
    runId: input.runId,
    correlationId: input.dedupeKey,
    producer: input.producer ?? 'jobs-ingestion-service-worker',
    payload: {
      crawlRunId: input.crawlRunId,
      source: input.source,
      sourceId: input.sourceId,
      dedupeKey: input.dedupeKey,
      documentId: input.documentId,
      sinkResults: input.sinkResults,
      error: input.error,
      reason: input.reason,
    },
  });

const sanitizeEventTypeForFileName = (eventType: BrokerEvent['eventType']): string =>
  eventType.replace(/\./g, '-');

export const buildBrokerEventFileName = (event: BrokerEvent): string =>
  `${event.occurredAt.replace(/[:]/g, '-')}_${event.eventId}_${sanitizeEventTypeForFileName(event.eventType)}.json`;

export const writeBrokerEvent = async (root: string, event: BrokerEvent): Promise<string> => {
  const runDir = buildBrokerRunDir(root, event.runId);
  await mkdir(runDir, { recursive: true });
  const targetPath = path.join(runDir, buildBrokerEventFileName(event));
  await writeFile(targetPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  return targetPath;
};

export const readBrokerEvents = async (root: string, runId: string): Promise<BrokerEvent[]> => {
  const runDir = buildBrokerRunDir(root, runId);
  const entries = await readdir(runDir, { withFileTypes: true }).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  });

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const events = await Promise.all(
    files.map(async (fileName) => {
      const raw = await readFile(path.join(runDir, fileName), 'utf8');
      return brokerEventSchema.parse(JSON.parse(raw) as unknown);
    }),
  );

  return events;
};

export * from './v2.js';
