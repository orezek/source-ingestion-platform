import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  controlPlanePipelineV2Schema,
  controlPlaneRunEventIndexV2Schema,
  controlPlaneRunManifestV2Schema,
  controlPlaneRunV2Schema,
  crawlerStartRunRequestV2Schema,
  ingestionStartRunRequestV2Schema,
  v2ArtifactSinkSchema,
  type V2RuntimeBrokerEvent,
} from '@repo/control-plane-contracts';

export type ControlPlanePipeline = z.infer<typeof controlPlanePipelineV2Schema>;
export type ControlPlaneRunManifest = z.infer<typeof controlPlaneRunManifestV2Schema>;
export type ControlPlaneRun = z.infer<typeof controlPlaneRunV2Schema>;
export type ControlPlaneRunEventIndex = z.infer<typeof controlPlaneRunEventIndexV2Schema>;
export type ControlPlaneArtifactSink = z.infer<typeof v2ArtifactSinkSchema>;

const DISPATCH_FAILURE_STOP_REASONS = new Set([
  'ingestion_dispatch_failed',
  'crawler_dispatch_failed',
  'startup_rollback_cancel_failed',
]);
const MONGO_DB_NAME_MAX_BYTES = 38;
const PIPELINE_DB_PREFIX = 'pl';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 24);
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function joinPathSegments(...parts: string[]): string {
  return parts
    .map((part) => trimSlashes(part))
    .filter((part) => part.length > 0)
    .join('/');
}

export function generatePipelineId(name: string): string {
  const slug = slugify(name);
  const suffix = randomUUID().split('-')[0] ?? randomUUID();
  return slug.length > 0 ? `pipeline-${slug}-${suffix}` : `pipeline-${suffix}`;
}

export function generateRunId(): string {
  return `run-${randomUUID()}`;
}

function extractPipelineSuffix(pipelineId: string): string {
  const suffix = pipelineId.split('-').at(-1)?.trim();
  return suffix && suffix.length > 0 ? suffix : randomUUID().split('-')[0]!;
}

function truncateToMaxBytes(value: string, maxBytes: number): string {
  let truncated = '';
  for (const character of value) {
    if (Buffer.byteLength(`${truncated}${character}`, 'utf8') > maxBytes) {
      break;
    }

    truncated += character;
  }

  return truncated.replace(/-+$/u, '');
}

export function buildPipelineDbName(name: string, pipelineId: string): string {
  const slug = slugify(name) || 'pipeline';
  const suffix = extractPipelineSuffix(pipelineId);
  const candidate = `${PIPELINE_DB_PREFIX}-${slug}-${suffix}`;

  if (Buffer.byteLength(candidate, 'utf8') <= MONGO_DB_NAME_MAX_BYTES) {
    return candidate;
  }

  const slugMaxBytes =
    MONGO_DB_NAME_MAX_BYTES - Buffer.byteLength(`${PIPELINE_DB_PREFIX}--${suffix}`, 'utf8');

  const truncatedSlug = truncateToMaxBytes(slug, slugMaxBytes);
  if (truncatedSlug.length === 0) {
    return `${PIPELINE_DB_PREFIX}-${suffix}`;
  }

  return `${PIPELINE_DB_PREFIX}-${truncatedSlug}-${suffix}`;
}

export function assertPipelineCreateRequestConsistency(input: {
  mode: 'crawl_only' | 'crawl_and_ingest';
  runtimeProfile: {
    ingestionEnabled: boolean;
  };
  structuredOutput: {
    destinations: Array<{ type: 'mongodb' | 'downloadable_json' }>;
  };
}): void {
  if (input.mode === 'crawl_and_ingest' && !input.runtimeProfile.ingestionEnabled) {
    throw new Error('crawl_and_ingest pipelines require runtimeProfile.ingestionEnabled=true.');
  }

  if (input.mode === 'crawl_only' && input.runtimeProfile.ingestionEnabled) {
    throw new Error('crawl_only pipelines require runtimeProfile.ingestionEnabled=false.');
  }

  if (input.mode === 'crawl_and_ingest' && input.structuredOutput.destinations.length === 0) {
    throw new Error('crawl_and_ingest pipelines must configure at least one structured output.');
  }
}

export function buildCrawlerStartRunRequest(
  pipeline: ControlPlanePipeline,
  runId: string,
  artifactSink: ControlPlaneArtifactSink,
) {
  return crawlerStartRunRequestV2Schema.parse({
    contractVersion: 'v2',
    runId,
    idempotencyKey: `idmp-${runId}`,
    runtimeSnapshot: {
      crawlerMaxConcurrency: pipeline.runtimeProfile.crawlerMaxConcurrency,
      crawlerMaxRequestsPerMinute: pipeline.runtimeProfile.crawlerMaxRequestsPerMinute,
    },
    inputRef: {
      source: pipeline.source,
      searchSpaceId: pipeline.searchSpace.id,
      searchSpaceSnapshot: {
        name: pipeline.searchSpace.name,
        description: pipeline.searchSpace.description,
        startUrls: pipeline.searchSpace.startUrls,
        maxItems: pipeline.searchSpace.maxItems,
        allowInactiveMarking: pipeline.searchSpace.allowInactiveMarking,
      },
      emitDetailCapturedEvents: pipeline.mode === 'crawl_and_ingest',
    },
    persistenceTargets: {
      dbName: pipeline.dbName,
    },
    artifactSink,
  });
}

export function buildIngestionStartRunRequest(
  pipeline: ControlPlanePipeline,
  runId: string,
  artifactSink: ControlPlaneArtifactSink,
) {
  const deliveryPrefix = joinPathSegments(
    artifactSink.type === 'gcs' ? artifactSink.prefix : '',
    'pipelines',
    pipeline.pipelineId,
    'runs',
    runId,
    'outputs',
    'downloadable-json',
  );

  return ingestionStartRunRequestV2Schema.parse({
    contractVersion: 'v2',
    runId,
    idempotencyKey: `idmp-${runId}`,
    runtimeSnapshot: {
      ingestionConcurrency: pipeline.runtimeProfile.ingestionConcurrency,
    },
    inputRef: {
      crawlRunId: runId,
      searchSpaceId: pipeline.searchSpace.id,
    },
    persistenceTargets: {
      dbName: pipeline.dbName,
    },
    outputSinks: pipeline.structuredOutput.destinations
      .filter((destination) => destination.type === 'downloadable_json')
      .map(() => ({
        type: 'downloadable_json' as const,
        delivery:
          artifactSink.type === 'gcs'
            ? {
                storageType: 'gcs' as const,
                bucket: artifactSink.bucket,
                prefix: deliveryPrefix,
              }
            : {
                storageType: 'local_filesystem' as const,
                basePath: artifactSink.basePath,
                prefix: deliveryPrefix,
              },
      })),
  });
}

export function buildRunManifest(input: {
  pipeline: ControlPlanePipeline;
  runId: string;
  createdBy: string;
  artifactSink: ControlPlaneArtifactSink;
}): ControlPlaneRunManifest {
  const { pipeline, runId, createdBy, artifactSink } = input;

  return controlPlaneRunManifestV2Schema.parse({
    runId,
    pipelineId: pipeline.pipelineId,
    pipelineVersion: pipeline.version,
    pipelineSnapshot: pipeline,
    workerCommands: {
      crawler: buildCrawlerStartRunRequest(pipeline, runId, artifactSink),
      ...(pipeline.mode === 'crawl_and_ingest'
        ? {
            ingestion: buildIngestionStartRunRequest(pipeline, runId, artifactSink),
          }
        : {}),
    },
    createdAt: new Date().toISOString(),
    createdBy,
  });
}

export function buildInitialRun(input: {
  pipeline: ControlPlanePipeline;
  runId: string;
}): ControlPlaneRun {
  const { pipeline, runId } = input;
  const now = new Date().toISOString();
  const ingestionEnabled = pipeline.mode === 'crawl_and_ingest';
  const downloadableJsonEnabled = pipeline.structuredOutput.destinations.some(
    (destination) => destination.type === 'downloadable_json',
  );

  return controlPlaneRunV2Schema.parse({
    runId,
    pipelineId: pipeline.pipelineId,
    pipelineName: pipeline.name,
    mode: pipeline.mode,
    dbName: pipeline.dbName,
    source: pipeline.source,
    searchSpaceId: pipeline.searchSpace.id,
    status: 'queued',
    requestedAt: now,
    startedAt: null,
    finishedAt: null,
    lastEventAt: null,
    stopReason: null,
    crawler: {
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      detailPagesCaptured: 0,
    },
    ingestion: {
      enabled: ingestionEnabled,
      status: ingestionEnabled ? 'queued' : null,
      startedAt: null,
      finishedAt: null,
      jobsProcessed: 0,
      jobsFailed: 0,
      jobsSkippedIncomplete: 0,
    },
    artifacts: {
      detailCapturedCount: 0,
    },
    outputs: {
      downloadableJsonEnabled,
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
}

export function markRunDispatchFailed(
  run: ControlPlaneRun,
  stopReason:
    | 'ingestion_dispatch_failed'
    | 'crawler_dispatch_failed'
    | 'startup_rollback_cancel_failed',
): ControlPlaneRun {
  const now = new Date().toISOString();

  return controlPlaneRunV2Schema.parse({
    ...run,
    status: 'failed',
    finishedAt: run.finishedAt ?? now,
    lastEventAt: run.lastEventAt ?? now,
    stopReason,
  });
}

function isDispatchFailureLockedRun(run: ControlPlaneRun): boolean {
  return (
    run.status === 'failed' &&
    run.stopReason !== null &&
    DISPATCH_FAILURE_STOP_REASONS.has(run.stopReason)
  );
}

function isTerminalStatus(status: ControlPlaneRun['status']): boolean {
  return status === 'succeeded' || status === 'completed_with_errors' || status === 'failed';
}

function resolveFinalRunStatus(run: ControlPlaneRun): ControlPlaneRun['status'] {
  const ingestionStatus = run.ingestion.status;
  const statuses = [run.crawler.status, ingestionStatus].filter(
    (value): value is ControlPlaneRun['status'] => value !== null,
  );

  if (statuses.includes('failed')) {
    return 'failed';
  }

  if (statuses.includes('stopped')) {
    return 'stopped';
  }

  if (statuses.includes('completed_with_errors')) {
    return 'completed_with_errors';
  }

  return 'succeeded';
}

export function buildRunEventIndexRecord(
  event: V2RuntimeBrokerEvent,
  projectionStatus: 'applied' | 'orphaned' = 'applied',
): ControlPlaneRunEventIndex {
  const baseRecord = {
    eventId: event.eventId,
    runId: event.runId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    occurredAt: event.occurredAt,
    correlationId: event.correlationId,
    producer: event.producer,
    payload: event.payload,
    projectionStatus,
    ingestedAt: new Date().toISOString(),
  };

  switch (event.eventType) {
    case 'crawler.detail.captured':
      return controlPlaneRunEventIndexV2Schema.parse({
        ...baseRecord,
        crawlRunId: event.payload.crawlRunId,
        searchSpaceId: event.payload.searchSpaceId,
        source: event.payload.source,
        sourceId: event.payload.sourceId,
        dedupeKey: event.payload.dedupeKey,
      });
    case 'crawler.run.finished':
      return controlPlaneRunEventIndexV2Schema.parse({
        ...baseRecord,
        crawlRunId: event.payload.crawlRunId,
        searchSpaceId: event.payload.searchSpaceId,
        source: event.payload.source,
      });
    case 'ingestion.item.started':
    case 'ingestion.item.succeeded':
    case 'ingestion.item.failed':
    case 'ingestion.item.rejected':
      return controlPlaneRunEventIndexV2Schema.parse({
        ...baseRecord,
        crawlRunId: event.payload.crawlRunId,
        source: event.payload.source,
        sourceId: event.payload.sourceId,
        dedupeKey: event.payload.dedupeKey,
      });
    default:
      return controlPlaneRunEventIndexV2Schema.parse(baseRecord);
  }
}

export function applyRuntimeEventToRun(
  run: ControlPlaneRun,
  event: V2RuntimeBrokerEvent,
): ControlPlaneRun {
  const lockedByDispatchFailure = isDispatchFailureLockedRun(run);
  const next = structuredClone(run) as ControlPlaneRun;
  next.lastEventAt = event.occurredAt;

  switch (event.eventType) {
    case 'crawler.run.started': {
      next.crawler.startedAt ??= event.occurredAt;
      next.startedAt ??= event.occurredAt;
      if (isTerminalStatus(next.crawler.status)) {
        break;
      }

      next.crawler.status = 'running';
      if (!lockedByDispatchFailure) {
        next.status = 'running';
      }
      break;
    }
    case 'crawler.detail.captured': {
      next.crawler.detailPagesCaptured += 1;
      next.artifacts.detailCapturedCount += 1;
      break;
    }
    case 'crawler.run.finished': {
      next.crawler.status = event.payload.status;
      next.crawler.finishedAt = event.occurredAt;
      if (!lockedByDispatchFailure) {
        next.stopReason = event.payload.stopReason ?? next.stopReason;
      }
      if (!lockedByDispatchFailure && next.mode === 'crawl_only') {
        next.status = event.payload.status;
        next.finishedAt = event.occurredAt;
      }
      break;
    }
    case 'ingestion.run.started': {
      next.ingestion.startedAt ??= event.occurredAt;
      next.startedAt ??= event.occurredAt;
      if (next.ingestion.status !== null && isTerminalStatus(next.ingestion.status)) {
        break;
      }

      next.ingestion.status = 'running';
      if (!lockedByDispatchFailure) {
        next.status = 'running';
      }
      break;
    }
    case 'ingestion.item.started': {
      break;
    }
    case 'ingestion.item.succeeded': {
      next.ingestion.jobsProcessed += 1;
      if (next.outputs.downloadableJsonEnabled) {
        next.outputs.downloadableJsonCount += 1;
      }
      break;
    }
    case 'ingestion.item.failed': {
      next.ingestion.jobsFailed += 1;
      break;
    }
    case 'ingestion.item.rejected': {
      next.ingestion.jobsSkippedIncomplete += 1;
      break;
    }
    case 'ingestion.run.finished': {
      next.ingestion.status = event.payload.status;
      next.ingestion.finishedAt = event.occurredAt;
      next.ingestion.jobsProcessed =
        event.payload.counters.jobsProcessed ?? next.ingestion.jobsProcessed;
      next.ingestion.jobsFailed = event.payload.counters.jobsFailed ?? next.ingestion.jobsFailed;
      next.ingestion.jobsSkippedIncomplete =
        event.payload.counters.jobsRejected ?? next.ingestion.jobsSkippedIncomplete;
      if (!lockedByDispatchFailure) {
        next.status = resolveFinalRunStatus(next);
        next.finishedAt = event.occurredAt;
      }
      break;
    }
    default: {
      const exhaustiveCheck: never = event;
      return exhaustiveCheck;
    }
  }

  return controlPlaneRunV2Schema.parse(next);
}
