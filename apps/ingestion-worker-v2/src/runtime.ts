import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Topic } from '@google-cloud/pubsub';
import type { Storage } from '@google-cloud/storage';
import {
  buildIngestionLifecycleEventV2,
  crawlerDetailCapturedEventSchema as legacyCrawlerDetailCapturedEventSchema,
  crawlerDetailCapturedEventV2Schema,
  crawlerRunFinishedEventSchema as legacyCrawlerRunFinishedEventSchema,
  crawlerRunFinishedEventV2Schema,
  ingestionCancelRunRequestV2Schema,
  ingestionRunFinishedEventV2Schema,
  ingestionRunStartedEventV2Schema,
  ingestionRunSummaryProjectionV2Schema,
  ingestionStartRunRequestV2Schema,
  startRunAcceptedResponseV2Schema,
  startRunRejectedResponseV2Schema,
  type V2IngestionRunSummaryProjection,
} from '@repo/control-plane-contracts';
import type { FastifyBaseLogger } from 'fastify';
import type { Collection, MongoClient } from 'mongodb';
import { z } from 'zod';
import type { EnvSchema } from './env.js';
import { IncompleteDetailPageError } from './full-model/html-detail-loader.js';
import { FullModelParser } from './full-model/parser.js';
import type { SourceListingRecord, UnifiedJobAd } from './full-model/schema.js';

type IngestionStartRunRequestV2 = z.infer<typeof ingestionStartRunRequestV2Schema>;
type IngestionCancelRunRequestV2 = z.infer<typeof ingestionCancelRunRequestV2Schema>;
type LegacyCrawlerDetailCapturedEvent = z.infer<typeof legacyCrawlerDetailCapturedEventSchema>;
type CrawlerDetailCapturedEventV2 = z.infer<typeof crawlerDetailCapturedEventV2Schema>;
type LegacyCrawlerRunFinishedEvent = z.infer<typeof legacyCrawlerRunFinishedEventSchema>;
type CrawlerRunFinishedEventV2 = z.infer<typeof crawlerRunFinishedEventV2Schema>;

type ItemInput = {
  source: string;
  crawlRunId: string;
  searchSpaceId: string;
  sourceId: string;
  dedupeKey: string;
  detailHtmlPath: string;
  listingRecord: SourceListingRecord;
};

type RunOutputRef = {
  sourceId: string;
  dedupeKey: string;
  mongoTargetRef?: string;
  downloadableJsonPath?: string;
  createdAt: string;
};

type RunCounters = {
  received: number;
  processed: number;
  failed: number;
  rejected: number;
};

type LlmStatsAccumulator = {
  calls: number;
  callDurations: number[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
};

type RunMetricsAccumulator = {
  parserVersion: string | null;
  extractorModel: string | null;
  timeToProcssSeconds: number[];
  llmCleaner: LlmStatsAccumulator;
  llmExtractor: LlmStatsAccumulator;
  llmTotal: LlmStatsAccumulator;
};

type RunState = {
  request: IngestionStartRunRequestV2;
  runId: string;
  idempotencyKey: string;
  status: 'running' | 'succeeded' | 'completed_with_errors' | 'failed' | 'stopped';
  startedAt: string;
  finishedAt: string | null;
  cancelRequested: boolean;
  cancelReason: IngestionCancelRunRequestV2['reason'] | null;
  crawlerFinished: boolean;
  queueDepth: number;
  activeItems: number;
  counters: RunCounters;
  metrics: RunMetricsAccumulator;
  outputs: RunOutputRef[];
  processedJobIds: string[];
  failedJobIds: string[];
  skippedIncompleteJobIds: string[];
  nonSuccessJobIds: string[];
  receivedDedupeKeys: Set<string>;
  seenDedupeKeys: Set<string>;
  inFlightDedupeKeys: Set<string>;
  pendingRetryDedupeKeys: Set<string>;
  lastHeartbeatAt: string;
  noDetailTimeoutHandle: ReturnType<typeof setTimeout> | null;
};

type QueueItem = {
  runId: string;
  item: ItemInput;
  resolve: (result: QueueProcessingResult) => void;
};

type QueueProcessingResult = {
  disposition: 'ack' | 'nack';
  reason:
    | 'processed_successfully'
    | 'duplicate_dedupe_key'
    | 'duplicate_inflight_dedupe_key'
    | 'no_matching_run'
    | 'cancelled_startup_rollback'
    | 'incomplete_detail_page'
    | 'permanent_processing_error'
    | 'transient_processing_error';
};

type PubSubMessageHandlingResult = {
  disposition: 'ack' | 'nack';
  reason:
    | QueueProcessingResult['reason']
    | 'invalid_json'
    | 'invalid_detail_event'
    | 'invalid_run_finished_event'
    | 'ignored_event_type'
    | 'no_matching_run';
};

type RuntimeDeps = {
  env: EnvSchema;
  logger: FastifyBaseLogger;
  eventsTopic: Topic;
  storage: Storage;
  mongoClient: MongoClient;
};

type PersistedNormalizedJobAdDoc = UnifiedJobAd;

type StartRunResponse = z.infer<typeof startRunAcceptedResponseV2Schema>;

const INGESTION_RUN_SUMMARIES_COLLECTION = 'ingestion_run_summaries';
const NORMALIZED_JOB_ADS_COLLECTION = 'normalized_job_ads';
const NO_DETAIL_EVENTS_TIMEOUT_MS = 60_000;

export class ConflictError extends Error {
  public readonly statusCode = 409;
}

export class NotFoundError extends Error {
  public readonly statusCode = 404;
}

function nowIso(): string {
  return new Date().toISOString();
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(sorted.length * ratio) - 1;
  const safeIndex = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[safeIndex] ?? 0;
}

function createLlmStatsAccumulator(): LlmStatsAccumulator {
  return {
    calls: 0,
    callDurations: [],
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputCostUsd: 0,
    outputCostUsd: 0,
    totalCostUsd: 0,
  };
}

function createRunMetricsAccumulator(): RunMetricsAccumulator {
  return {
    parserVersion: null,
    extractorModel: null,
    timeToProcssSeconds: [],
    llmCleaner: createLlmStatsAccumulator(),
    llmExtractor: createLlmStatsAccumulator(),
    llmTotal: createLlmStatsAccumulator(),
  };
}

function buildJobId(item: Pick<ItemInput, 'source' | 'sourceId'>): string {
  return `${item.source}:${item.sourceId}`;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function isTransientProcessingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  const transientNameMatch =
    name.includes('timeout') ||
    name.includes('network') ||
    name.includes('unavailable') ||
    name.includes('abort') ||
    name.includes('ratelimit') ||
    name.includes('rate_limit');

  if (transientNameMatch) {
    return true;
  }

  const transientMessagePatterns = [
    'deadline exceeded',
    'timed out',
    'timeout',
    'temporarily unavailable',
    'temporary failure',
    'connection reset',
    'connection refused',
    'econnreset',
    'econnrefused',
    'etimedout',
    'network',
    'rate limit',
    'resource exhausted',
    'service unavailable',
    'server selection timed out',
    'connection closed',
  ];

  return transientMessagePatterns.some((pattern) => message.includes(pattern));
}

export class IngestionWorkerRuntime {
  private readonly runs = new Map<string, RunState>();
  private readonly itemQueue: QueueItem[] = [];
  private activeWorkers = 0;
  private pubSubConsumerReady = false;
  private persistenceReady = false;
  private readonly fullModelParser: FullModelParser;

  public constructor(private readonly deps: RuntimeDeps) {
    this.fullModelParser = new FullModelParser({
      logger: deps.logger,
      parserBackend: deps.env.INGESTION_PARSER_BACKEND,
      parserVersion: deps.env.PARSER_VERSION,
      logTextTransformContent: deps.env.LOG_TEXT_TRANSFORM_CONTENT,
      textTransformPreviewChars: deps.env.LOG_TEXT_TRANSFORM_PREVIEW_CHARS,
      minRelevantTextChars: deps.env.DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS,
      llmExtractorPromptName: deps.env.LLM_EXTRACTOR_PROMPT_NAME,
      llmCleanerPromptName: deps.env.LLM_CLEANER_PROMPT_NAME,
      geminiApiKey: deps.env.GEMINI_API_KEY,
      langsmithApiKey: deps.env.LANGSMITH_API_KEY,
      geminiModel: deps.env.GEMINI_MODEL,
      geminiTemperature: deps.env.GEMINI_TEMPERATURE,
      geminiThinkingLevel: deps.env.GEMINI_THINKING_LEVEL,
      geminiInputPriceUsdPerMillionTokens: deps.env.GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS,
      geminiOutputPriceUsdPerMillionTokens: deps.env.GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS,
    });
  }

  public async initialize(): Promise<void> {
    await this.deps.mongoClient.db().command({ ping: 1 });

    this.persistenceReady = true;
  }

  public setPubSubConsumerReady(value: boolean): void {
    this.pubSubConsumerReady = value;
  }

  public isReady(): boolean {
    if (!this.persistenceReady) {
      return false;
    }

    if (!this.deps.env.ENABLE_PUBSUB_CONSUMER) {
      return true;
    }

    return this.pubSubConsumerReady;
  }

  public async startRun(raw: unknown): Promise<StartRunResponse> {
    const parsedRequest = ingestionStartRunRequestV2Schema.parse(raw);
    const existing = this.runs.get(parsedRequest.runId);
    if (existing) {
      if (existing.idempotencyKey !== parsedRequest.idempotencyKey) {
        const rejected = startRunRejectedResponseV2Schema.parse({
          contractVersion: 'v2',
          ok: false,
          accepted: false,
          deduplicated: false,
          state: 'rejected',
          workerType: 'ingestion',
          runId: parsedRequest.runId,
          error: {
            code: 'RUN_ID_CONFLICT',
            message:
              'Run already exists with a different idempotency key. Use a new runId or matching key.',
          },
        });
        throw new ConflictError(rejected.error.message);
      }

      return startRunAcceptedResponseV2Schema.parse({
        contractVersion: 'v2',
        ok: true,
        runId: existing.runId,
        workerType: 'ingestion',
        accepted: true,
        deduplicated: true,
        state: existing.status === 'running' ? 'running' : 'deduplicated',
        message: 'Run request deduplicated.',
      });
    }

    const startedAt = nowIso();
    const noDetailTimeoutMs =
      (parsedRequest.timeouts?.idleTimeoutSeconds ?? NO_DETAIL_EVENTS_TIMEOUT_MS / 1_000) * 1_000;

    const run: RunState = {
      request: parsedRequest,
      runId: parsedRequest.runId,
      idempotencyKey: parsedRequest.idempotencyKey,
      status: 'running',
      startedAt,
      finishedAt: null,
      cancelRequested: false,
      cancelReason: null,
      crawlerFinished: false,
      queueDepth: 0,
      activeItems: 0,
      counters: {
        received: 0,
        processed: 0,
        failed: 0,
        rejected: 0,
      },
      metrics: createRunMetricsAccumulator(),
      outputs: [],
      processedJobIds: [],
      failedJobIds: [],
      skippedIncompleteJobIds: [],
      nonSuccessJobIds: [],
      receivedDedupeKeys: new Set<string>(),
      seenDedupeKeys: new Set<string>(),
      inFlightDedupeKeys: new Set<string>(),
      pendingRetryDedupeKeys: new Set<string>(),
      lastHeartbeatAt: startedAt,
      noDetailTimeoutHandle: setTimeout(() => {
        void this.expireRunWithoutDetailItems(parsedRequest.runId);
      }, noDetailTimeoutMs),
    };

    this.runs.set(run.runId, run);
    try {
      await this.ensureIndexesForRun(run);
      await this.publishRunStarted(run);
    } catch (error) {
      if (run.noDetailTimeoutHandle) {
        clearTimeout(run.noDetailTimeoutHandle);
      }
      this.runs.delete(run.runId);
      throw error;
    }

    return startRunAcceptedResponseV2Schema.parse({
      contractVersion: 'v2',
      ok: true,
      runId: run.runId,
      workerType: 'ingestion',
      accepted: true,
      deduplicated: false,
      state: 'accepted',
      message: 'Run accepted for event-driven ingestion execution.',
    });
  }

  public getRun(runId: string): Record<string, unknown> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new NotFoundError(`Run "${runId}" does not exist on this worker.`);
    }

    return {
      runId: run.runId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      cancelRequested: run.cancelRequested,
      crawlerFinished: run.crawlerFinished,
      queueDepth: run.queueDepth,
      activeItems: run.activeItems,
      counters: run.counters,
      lastHeartbeatAt: run.lastHeartbeatAt,
      outputsCount: run.outputs.length,
    };
  }

  public async cancelRun(
    runId: string,
    request: IngestionCancelRunRequestV2,
  ): Promise<Record<string, unknown>> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new NotFoundError(`Run "${runId}" does not exist on this worker.`);
    }

    run.cancelRequested = true;
    run.cancelReason = request.reason;
    run.lastHeartbeatAt = nowIso();
    await this.tryFinalizeRun(
      run,
      request.reason === 'startup_rollback' ? 'startup_rollback' : 'cancelled_by_operator',
    );

    return {
      runId: run.runId,
      cancelRequested: true,
      cancelReason: run.cancelReason,
      status: run.status,
      queueDepth: run.queueDepth,
      activeItems: run.activeItems,
    };
  }

  public getRunOutputs(runId: string): Record<string, unknown> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new NotFoundError(`Run "${runId}" does not exist on this worker.`);
    }

    return {
      runId: run.runId,
      outputs: run.outputs,
      count: run.outputs.length,
    };
  }

  public async handlePubSubMessage(rawMessage: string): Promise<PubSubMessageHandlingResult> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawMessage);
    } catch {
      this.deps.logger.warn('Skipping invalid Pub/Sub message JSON payload.');
      return {
        disposition: 'ack',
        reason: 'invalid_json',
      };
    }

    const eventType =
      typeof parsedJson === 'object' &&
      parsedJson !== null &&
      'eventType' in parsedJson &&
      typeof parsedJson.eventType === 'string'
        ? parsedJson.eventType
        : null;

    if (eventType === 'crawler.detail.captured') {
      const parsedEventV2 = crawlerDetailCapturedEventV2Schema.safeParse(parsedJson);
      if (parsedEventV2.success) {
        return this.handleCrawlerDetailCapturedEvent(parsedEventV2.data);
      }

      const parsedEventV1 = legacyCrawlerDetailCapturedEventSchema.safeParse(parsedJson);
      if (!parsedEventV1.success) {
        this.deps.logger.warn(
          {
            issuesV2: parsedEventV2.error.issues,
            issuesV1: parsedEventV1.error.issues,
          },
          'Skipping malformed crawler.detail.captured event.',
        );
        return {
          disposition: 'ack',
          reason: 'invalid_detail_event',
        };
      }

      return this.handleCrawlerDetailCapturedEvent(parsedEventV1.data);
    }

    if (eventType === 'crawler.run.finished') {
      const parsedEventV2 = crawlerRunFinishedEventV2Schema.safeParse(parsedJson);
      if (parsedEventV2.success) {
        return this.handleCrawlerRunFinishedEvent(parsedEventV2.data);
      }

      const parsedEventV1 = legacyCrawlerRunFinishedEventSchema.safeParse(parsedJson);
      if (parsedEventV1.success) {
        return this.handleCrawlerRunFinishedEvent(parsedEventV1.data);
      }

      this.deps.logger.warn(
        {
          issuesV1: parsedEventV1.error.issues,
          issuesV2: parsedEventV2.error.issues,
        },
        'Skipping malformed crawler.run.finished event.',
      );
      return {
        disposition: 'ack',
        reason: 'invalid_run_finished_event',
      };
    }

    return {
      disposition: 'ack',
      reason: 'ignored_event_type',
    };
  }

  private async handleCrawlerDetailCapturedEvent(
    event: LegacyCrawlerDetailCapturedEvent | CrawlerDetailCapturedEventV2,
  ): Promise<PubSubMessageHandlingResult> {
    const run = this.resolveRunForCrawlerEvent(event.runId, event.payload.crawlRunId);
    if (!run) {
      this.deps.logger.warn(
        {
          eventRunId: event.runId,
          crawlRunId: event.payload.crawlRunId,
          sourceId: event.payload.sourceId,
          dedupeKey: event.payload.dedupeKey,
        },
        'Skipping crawler.detail.captured event because no active ingestion run matched.',
      );
      return {
        disposition: 'ack',
        reason: 'no_matching_run',
      };
    }

    const item: ItemInput = {
      source: event.payload.source,
      crawlRunId: event.payload.crawlRunId,
      searchSpaceId: event.payload.searchSpaceId,
      sourceId: event.payload.sourceId,
      dedupeKey: event.payload.dedupeKey,
      detailHtmlPath: event.payload.artifact.storagePath,
      listingRecord: event.payload.listingRecord,
    };

    return this.queueItem(run, item);
  }

  private async handleCrawlerRunFinishedEvent(
    event: LegacyCrawlerRunFinishedEvent | CrawlerRunFinishedEventV2,
  ): Promise<PubSubMessageHandlingResult> {
    const run = this.resolveRunForCrawlerEvent(
      event.runId,
      'crawlRunId' in event.payload ? event.payload.crawlRunId : undefined,
    );
    if (!run) {
      this.deps.logger.warn(
        {
          eventRunId: event.runId,
          crawlRunId: 'crawlRunId' in event.payload ? event.payload.crawlRunId : undefined,
        },
        'Skipping crawler.run.finished event because no active ingestion run matched.',
      );
      return {
        disposition: 'ack',
        reason: 'no_matching_run',
      };
    }

    this.deps.logger.info(
      {
        runId: run.runId,
        crawlRunId: run.request.inputRef.crawlRunId,
        crawlerStatus: event.payload.status,
        queueDepth: run.queueDepth,
        activeItems: run.activeItems,
      },
      'Received crawler.run.finished event.',
    );

    run.crawlerFinished = true;
    run.lastHeartbeatAt = nowIso();
    await this.tryFinalizeRun(run);
    return {
      disposition: 'ack',
      reason: 'processed_successfully',
    };
  }

  private resolveRunForCrawlerEvent(eventRunId: string, crawlRunId?: string): RunState | undefined {
    const directRun = this.runs.get(eventRunId);
    if (directRun?.status === 'running') {
      return directRun;
    }

    const candidateCrawlRunIds = new Set<string>([eventRunId]);
    if (crawlRunId) {
      candidateCrawlRunIds.add(crawlRunId);
    }

    const matchedRuns = [...this.runs.values()].filter(
      (run) =>
        run.status === 'running' && candidateCrawlRunIds.has(run.request.inputRef.crawlRunId),
    );

    if (matchedRuns.length === 1) {
      return matchedRuns[0];
    }

    if (matchedRuns.length > 1) {
      this.deps.logger.warn(
        {
          eventRunId,
          crawlRunId,
          matchedRunIds: matchedRuns.map((run) => run.runId),
        },
        'Skipping crawler event because multiple running ingestion runs match crawlRunId.',
      );
    }

    return undefined;
  }

  private async queueItem(run: RunState, item: ItemInput): Promise<QueueProcessingResult> {
    if (run.seenDedupeKeys.has(item.dedupeKey)) {
      return {
        disposition: 'ack',
        reason: 'duplicate_dedupe_key',
      };
    }

    if (run.inFlightDedupeKeys.has(item.dedupeKey)) {
      return {
        disposition: 'ack',
        reason: 'duplicate_inflight_dedupe_key',
      };
    }

    run.pendingRetryDedupeKeys.delete(item.dedupeKey);
    run.inFlightDedupeKeys.add(item.dedupeKey);
    if (!run.receivedDedupeKeys.has(item.dedupeKey)) {
      run.receivedDedupeKeys.add(item.dedupeKey);
      run.counters.received += 1;
    }
    if (run.noDetailTimeoutHandle) {
      clearTimeout(run.noDetailTimeoutHandle);
      run.noDetailTimeoutHandle = null;
    }
    run.lastHeartbeatAt = nowIso();
    run.queueDepth += 1;
    return new Promise((resolve) => {
      this.itemQueue.push({ runId: run.runId, item, resolve });
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    while (this.activeWorkers < this.deps.env.MAX_CONCURRENT_RUNS && this.itemQueue.length > 0) {
      const workItem = this.itemQueue.shift();
      if (!workItem) {
        return;
      }

      const run = this.runs.get(workItem.runId);
      if (!run || run.status !== 'running') {
        workItem.resolve({
          disposition: 'ack',
          reason: 'no_matching_run',
        });
        continue;
      }

      run.queueDepth = Math.max(0, run.queueDepth - 1);
      run.activeItems += 1;
      this.activeWorkers += 1;

      void this.processQueueItem(run, workItem.item)
        .then((result) => {
          workItem.resolve(result);
        })
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error, runId: run.runId }, 'Queue item processing failed.');
          run.inFlightDedupeKeys.delete(workItem.item.dedupeKey);
          run.pendingRetryDedupeKeys.add(workItem.item.dedupeKey);
          workItem.resolve({
            disposition: 'nack',
            reason: 'transient_processing_error',
          });
        })
        .finally(async () => {
          this.activeWorkers = Math.max(0, this.activeWorkers - 1);
          run.activeItems = Math.max(0, run.activeItems - 1);
          run.lastHeartbeatAt = nowIso();
          await this.tryFinalizeRun(run);
          this.drainQueue();
        });
    }
  }

  private async processQueueItem(run: RunState, item: ItemInput): Promise<QueueProcessingResult> {
    const jobId = buildJobId(item);
    if (run.cancelRequested && run.cancelReason === 'startup_rollback') {
      run.counters.rejected += 1;
      pushUnique(run.nonSuccessJobIds, jobId);
      await this.publishIngestionItemEvent('ingestion.item.rejected', run, item, {
        reason: 'startup_rollback',
      });
      run.inFlightDedupeKeys.delete(item.dedupeKey);
      run.pendingRetryDedupeKeys.delete(item.dedupeKey);
      run.seenDedupeKeys.add(item.dedupeKey);
      return {
        disposition: 'ack',
        reason: 'cancelled_startup_rollback',
      };
    }

    try {
      await this.publishIngestionItemEvent('ingestion.item.started', run, item);

      const downloadableJsonSink = run.request.outputSinks.find(
        (sink) => sink.type === 'downloadable_json',
      );

      const unifiedDoc = await this.fullModelParser.parse({
        runId: run.runId,
        crawlRunId: item.crawlRunId,
        searchSpaceId: item.searchSpaceId,
        detailHtmlPath: item.detailHtmlPath,
        listingRecord: item.listingRecord,
      });
      const normalizedDoc: PersistedNormalizedJobAdDoc = unifiedDoc;

      await this.getNormalizedCollectionForRun(run).replaceOne(
        { id: normalizedDoc.id },
        normalizedDoc,
        { upsert: true },
      );

      let downloadableJsonPath: string | undefined;
      if (downloadableJsonSink) {
        try {
          downloadableJsonPath = await this.persistDownloadableJson(
            run,
            item,
            normalizedDoc,
            downloadableJsonSink.delivery,
          );
        } catch (downloadError) {
          this.deps.logger.error(
            {
              err: downloadError,
              runId: run.runId,
              sourceId: item.sourceId,
              dedupeKey: item.dedupeKey,
            },
            'Downloadable JSON upload failed. Continuing after successful Mongo persistence.',
          );
        }
      }

      this.recordRunMetrics(run, normalizedDoc);
      run.counters.processed += 1;
      pushUnique(run.processedJobIds, normalizedDoc.id);
      const mongoTargetRef = `${run.request.persistenceTargets.dbName}.${NORMALIZED_JOB_ADS_COLLECTION}`;
      run.outputs.push({
        sourceId: item.sourceId,
        dedupeKey: item.dedupeKey,
        mongoTargetRef,
        ...(downloadableJsonPath ? { downloadableJsonPath } : {}),
        createdAt: nowIso(),
      });

      await this.publishIngestionItemEvent('ingestion.item.succeeded', run, item, {
        documentId: normalizedDoc.id,
      });
      run.inFlightDedupeKeys.delete(item.dedupeKey);
      run.pendingRetryDedupeKeys.delete(item.dedupeKey);
      run.seenDedupeKeys.add(item.dedupeKey);
      return {
        disposition: 'ack',
        reason: 'processed_successfully',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof IncompleteDetailPageError) {
        run.counters.rejected += 1;
        pushUnique(run.skippedIncompleteJobIds, jobId);
        pushUnique(run.nonSuccessJobIds, jobId);
        await this.publishIngestionItemEvent('ingestion.item.rejected', run, item, {
          reason: 'incomplete_detail_page',
        });
        run.inFlightDedupeKeys.delete(item.dedupeKey);
        run.pendingRetryDedupeKeys.delete(item.dedupeKey);
        run.seenDedupeKeys.add(item.dedupeKey);
        return {
          disposition: 'ack',
          reason: 'incomplete_detail_page',
        };
      }

      if (isTransientProcessingError(error)) {
        run.inFlightDedupeKeys.delete(item.dedupeKey);
        run.pendingRetryDedupeKeys.add(item.dedupeKey);
        this.deps.logger.warn(
          {
            err: error,
            runId: run.runId,
            sourceId: item.sourceId,
            dedupeKey: item.dedupeKey,
          },
          'Transient ingestion item failure detected. Requesting Pub/Sub redelivery.',
        );
        return {
          disposition: 'nack',
          reason: 'transient_processing_error',
        };
      }

      run.counters.failed += 1;
      pushUnique(run.failedJobIds, jobId);
      pushUnique(run.nonSuccessJobIds, jobId);
      await this.publishIngestionItemEvent('ingestion.item.failed', run, item, {
        error: {
          name: error instanceof Error ? error.name : 'IngestionItemError',
          message,
        },
      });
      run.inFlightDedupeKeys.delete(item.dedupeKey);
      run.pendingRetryDedupeKeys.delete(item.dedupeKey);
      run.seenDedupeKeys.add(item.dedupeKey);
      return {
        disposition: 'ack',
        reason: 'permanent_processing_error',
      };
    }
  }

  private recordLlmStats(
    aggregate: LlmStatsAccumulator,
    input: {
      callDurationSeconds: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      inputCostUsd: number;
      outputCostUsd: number;
      totalCostUsd: number;
    },
  ): void {
    aggregate.calls += 1;
    aggregate.callDurations.push(input.callDurationSeconds);
    aggregate.inputTokens += input.inputTokens;
    aggregate.outputTokens += input.outputTokens;
    aggregate.totalTokens += input.totalTokens;
    aggregate.inputCostUsd += input.inputCostUsd;
    aggregate.outputCostUsd += input.outputCostUsd;
    aggregate.totalCostUsd += input.totalCostUsd;
  }

  private recordRunMetrics(run: RunState, doc: UnifiedJobAd): void {
    run.metrics.parserVersion = run.metrics.parserVersion ?? doc.ingestion.parserVersion;
    run.metrics.extractorModel = run.metrics.extractorModel ?? doc.ingestion.extractorModel;
    run.metrics.timeToProcssSeconds.push(doc.ingestion.timeToProcssSeconds);

    this.recordLlmStats(run.metrics.llmCleaner, {
      callDurationSeconds: doc.ingestion.llmCleanerCallDurationSeconds,
      inputTokens: doc.ingestion.llmCleanerInputTokens,
      outputTokens: doc.ingestion.llmCleanerOutputTokens,
      totalTokens: doc.ingestion.llmCleanerTotalTokens,
      inputCostUsd: doc.ingestion.llmCleanerInputCostUsd,
      outputCostUsd: doc.ingestion.llmCleanerOutputCostUsd,
      totalCostUsd: doc.ingestion.llmCleanerTotalCostUsd,
    });
    this.recordLlmStats(run.metrics.llmExtractor, {
      callDurationSeconds: doc.ingestion.llmExtractorCallDurationSeconds,
      inputTokens: doc.ingestion.llmExtractorInputTokens,
      outputTokens: doc.ingestion.llmExtractorOutputTokens,
      totalTokens: doc.ingestion.llmExtractorTotalTokens,
      inputCostUsd: doc.ingestion.llmExtractorInputCostUsd,
      outputCostUsd: doc.ingestion.llmExtractorOutputCostUsd,
      totalCostUsd: doc.ingestion.llmExtractorTotalCostUsd,
    });
    this.recordLlmStats(run.metrics.llmTotal, {
      callDurationSeconds: doc.ingestion.llmTotalCallDurationSeconds,
      inputTokens: doc.ingestion.llmTotalInputTokens,
      outputTokens: doc.ingestion.llmTotalOutputTokens,
      totalTokens: doc.ingestion.llmTotalTokens,
      inputCostUsd: doc.ingestion.llmTotalInputCostUsd,
      outputCostUsd: doc.ingestion.llmTotalOutputCostUsd,
      totalCostUsd: doc.ingestion.llmTotalCostUsd,
    });
  }

  private buildLlmStatsProjection(aggregate: LlmStatsAccumulator): {
    calls: number;
    avgCallDurationSeconds: number;
    p50CallDurationSeconds: number;
    p95CallDurationSeconds: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputCostUsd: number;
    outputCostUsd: number;
    totalCostUsd: number;
  } {
    return {
      calls: aggregate.calls,
      avgCallDurationSeconds: average(aggregate.callDurations),
      p50CallDurationSeconds: percentile(aggregate.callDurations, 0.5),
      p95CallDurationSeconds: percentile(aggregate.callDurations, 0.95),
      inputTokens: aggregate.inputTokens,
      outputTokens: aggregate.outputTokens,
      totalTokens: aggregate.totalTokens,
      inputCostUsd: aggregate.inputCostUsd,
      outputCostUsd: aggregate.outputCostUsd,
      totalCostUsd: aggregate.totalCostUsd,
    };
  }

  private async tryFinalizeRun(run: RunState, stopReason?: string): Promise<void> {
    if (run.status !== 'running') {
      return;
    }

    const noPendingRetries = run.pendingRetryDedupeKeys.size === 0;
    const noInFlightItems = run.inFlightDedupeKeys.size === 0;

    if (run.cancelRequested) {
      if (run.cancelReason === 'startup_rollback') {
        if (run.queueDepth === 0 && run.activeItems === 0) {
          await this.finalizeRun(run, 'stopped', stopReason ?? 'startup_rollback');
        }
        return;
      }

      if (run.cancelReason === 'operator_request') {
        const canFinalizeCancelled =
          run.crawlerFinished &&
          run.queueDepth === 0 &&
          run.activeItems === 0 &&
          noPendingRetries &&
          noInFlightItems;
        if (canFinalizeCancelled) {
          await this.finalizeRun(run, 'stopped', stopReason ?? 'cancelled_by_operator');
        }
        return;
      }
    }

    const canFinalize =
      run.crawlerFinished && run.queueDepth === 0 && noPendingRetries && noInFlightItems;
    if (!canFinalize || run.activeItems > 0) {
      return;
    }

    const hasErrors = run.nonSuccessJobIds.length > 0;
    await this.finalizeRun(
      run,
      hasErrors ? 'completed_with_errors' : 'succeeded',
      hasErrors ? 'one_or_more_item_failures_recorded' : undefined,
    );
  }

  private async finalizeRun(
    run: RunState,
    status: RunState['status'],
    stopReason?: string,
  ): Promise<void> {
    if (run.finishedAt) {
      return;
    }

    const finishedAt = nowIso();
    run.status = status;
    run.finishedAt = finishedAt;
    run.lastHeartbeatAt = finishedAt;
    if (run.noDetailTimeoutHandle) {
      clearTimeout(run.noDetailTimeoutHandle);
      run.noDetailTimeoutHandle = null;
    }

    const runDurationSeconds =
      Math.max(new Date(finishedAt).getTime() - new Date(run.startedAt).getTime(), 0) / 1_000;
    const jobsTotal = run.counters.received;
    const jobsProcessed = run.processedJobIds.length;
    const jobsSkippedIncomplete = run.skippedIncompleteJobIds.length;
    const jobsFailed = run.failedJobIds.length;
    const jobsNonSuccess = run.nonSuccessJobIds.length;
    const jobsSuccessRate = jobsTotal > 0 ? jobsProcessed / jobsTotal : 1;
    const jobsNonSuccessRate = jobsTotal > 0 ? jobsNonSuccess / jobsTotal : 0;
    const jobsFailedRate = jobsTotal > 0 ? jobsFailed / jobsTotal : 0;
    const llmCleanerStats = this.buildLlmStatsProjection(run.metrics.llmCleaner);
    const llmExtractorStats = this.buildLlmStatsProjection(run.metrics.llmExtractor);
    const llmTotalStats = this.buildLlmStatsProjection(run.metrics.llmTotal);

    const summary = ingestionRunSummaryProjectionV2Schema.parse({
      runId: run.runId,
      crawlRunId: run.request.inputRef.crawlRunId,
      status,
      startedAt: run.startedAt,
      completedAt: finishedAt,
      runDurationSeconds,
      parserVersion: run.metrics.parserVersion ?? this.deps.env.PARSER_VERSION,
      extractorModel: run.metrics.extractorModel ?? this.deps.env.GEMINI_MODEL,
      llmExtractorPromptName: this.deps.env.LLM_EXTRACTOR_PROMPT_NAME,
      llmCleanerPromptName: this.deps.env.LLM_CLEANER_PROMPT_NAME,
      concurrency: run.request.runtimeSnapshot.ingestionConcurrency,
      jobsTotal,
      jobsProcessed,
      processedJobIds: run.processedJobIds,
      jobsSkippedIncomplete,
      skippedIncompleteJobIds: run.skippedIncompleteJobIds,
      jobsFailed,
      failedJobIds: run.failedJobIds,
      jobsNonSuccess,
      nonSuccessJobIds: run.nonSuccessJobIds,
      jobsSuccessRate,
      jobsNonSuccessRate,
      jobsSkippedIncompleteRate: jobsTotal > 0 ? jobsSkippedIncomplete / jobsTotal : 0,
      jobsFailedRate,
      llmCleanerStats,
      llmExtractorStats,
      llmTotalStats,
      totalInputTokens: llmTotalStats.inputTokens,
      totalOutputTokens: llmTotalStats.outputTokens,
      totalTokens: llmTotalStats.totalTokens,
      totalEstimatedCostUsd: llmTotalStats.totalCostUsd,
      avgTimeToProcssSeconds: average(run.metrics.timeToProcssSeconds),
      p50TimeToProcssSeconds: percentile(run.metrics.timeToProcssSeconds, 0.5),
      p95TimeToProcssSeconds: percentile(run.metrics.timeToProcssSeconds, 0.95),
      avgLlmCleanerCallDurationSeconds: llmCleanerStats.avgCallDurationSeconds,
      avgLlmExtractorCallDurationSeconds: llmExtractorStats.avgCallDurationSeconds,
      avgLlmTotalCallDurationSeconds: llmTotalStats.avgCallDurationSeconds,
      p50LlmTotalCallDurationSeconds: llmTotalStats.p50CallDurationSeconds,
      p95LlmTotalCallDurationSeconds: llmTotalStats.p95CallDurationSeconds,
    });

    await this.getRunSummaryCollectionForRun(run).updateOne(
      { runId: run.runId },
      {
        $set: summary,
      },
      { upsert: true },
    );

    this.deps.logger.info(
      {
        runId: run.runId,
        crawlRunId: run.request.inputRef.crawlRunId,
        status,
        jobsTotal,
        jobsProcessed,
        jobsFailed,
        jobsSkippedIncomplete,
        jobsNonSuccess,
        dbName: run.request.persistenceTargets.dbName,
      },
      'Finalized ingestion run summary.',
    );

    await this.publishRunFinished(run, status, stopReason);
  }

  private buildDownloadablePath(prefix: string, item: ItemInput): string {
    const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
    const fileName = `${item.sourceId}-${randomUUID()}.json`;
    return normalizedPrefix.length > 0 ? `${normalizedPrefix}/${fileName}` : fileName;
  }

  private async persistDownloadableJson(
    run: RunState,
    item: ItemInput,
    normalizedDoc: PersistedNormalizedJobAdDoc,
    delivery: IngestionStartRunRequestV2['outputSinks'][number]['delivery'],
  ): Promise<string> {
    const downloadablePath = this.buildDownloadablePath(delivery.prefix, item);
    const jsonBody = `${JSON.stringify(normalizedDoc, null, 2)}\n`;

    if (delivery.storageType === 'gcs') {
      await this.deps.storage.bucket(delivery.bucket).file(downloadablePath).save(jsonBody, {
        contentType: 'application/json',
      });
      return `gs://${delivery.bucket}/${downloadablePath}`;
    }

    const targetPath = path.join(delivery.basePath, downloadablePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, jsonBody, 'utf8');
    return targetPath;
  }

  private async expireRunWithoutDetailItems(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') {
      return;
    }

    if (run.counters.received > 0 || run.crawlerFinished) {
      return;
    }

    run.cancelRequested = true;
    run.cancelReason = 'startup_rollback';
    run.lastHeartbeatAt = nowIso();
    await this.tryFinalizeRun(run, 'no_detail_events_timeout');
  }

  private async publishRunStarted(run: RunState): Promise<void> {
    const event = ingestionRunStartedEventV2Schema.parse({
      eventId: `evt-${randomUUID()}`,
      eventVersion: 'v2',
      eventType: 'ingestion.run.started',
      occurredAt: nowIso(),
      runId: run.runId,
      correlationId: run.runId,
      producer: this.deps.env.SERVICE_NAME,
      payload: {
        runId: run.runId,
        workerType: 'ingestion',
        status: 'running',
        counters: {},
      },
    });

    await this.publishEvent(event);
  }

  private async publishRunFinished(
    run: RunState,
    status: RunState['status'],
    stopReason?: string,
  ): Promise<void> {
    const event = ingestionRunFinishedEventV2Schema.parse({
      eventId: `evt-${randomUUID()}`,
      eventVersion: 'v2',
      eventType: 'ingestion.run.finished',
      occurredAt: nowIso(),
      runId: run.runId,
      correlationId: run.runId,
      producer: this.deps.env.SERVICE_NAME,
      payload: {
        runId: run.runId,
        workerType: 'ingestion',
        status,
        counters: {
          jobsReceived: run.counters.received,
          jobsProcessed: run.counters.processed,
          jobsFailed: run.counters.failed,
          jobsRejected: run.counters.rejected,
          ...(stopReason ? { stopReasonCount: 1 } : {}),
        },
      },
    });

    await this.publishEvent(event);
  }

  private async publishIngestionItemEvent(
    eventType:
      | 'ingestion.item.started'
      | 'ingestion.item.succeeded'
      | 'ingestion.item.failed'
      | 'ingestion.item.rejected',
    run: RunState,
    item: ItemInput,
    options?: {
      documentId?: string;
      error?: {
        name: string;
        message: string;
      };
      reason?: string;
    },
  ): Promise<void> {
    const baseEventInput = {
      runId: run.runId,
      crawlRunId: item.crawlRunId,
      source: item.source,
      sourceId: item.sourceId,
      dedupeKey: item.dedupeKey,
      producer: this.deps.env.SERVICE_NAME,
    };

    const event =
      eventType === 'ingestion.item.started'
        ? buildIngestionLifecycleEventV2({
            eventType,
            ...baseEventInput,
          })
        : eventType === 'ingestion.item.succeeded'
          ? buildIngestionLifecycleEventV2({
              eventType,
              ...baseEventInput,
              documentId: options?.documentId ?? item.dedupeKey,
            })
          : eventType === 'ingestion.item.failed'
            ? buildIngestionLifecycleEventV2({
                eventType,
                ...baseEventInput,
                error: options?.error ?? {
                  name: 'IngestionItemError',
                  message: 'Unknown ingestion item failure.',
                },
              })
            : buildIngestionLifecycleEventV2({
                eventType,
                ...baseEventInput,
                reason: options?.reason ?? 'rejected',
              });

    await this.publishEvent(event);
  }

  private async publishEvent(event: unknown): Promise<void> {
    try {
      await this.deps.eventsTopic.publishMessage({
        data: Buffer.from(JSON.stringify(event)),
      });
    } catch (error) {
      this.deps.logger.error(
        { err: error, eventType: (event as { eventType?: string }).eventType },
        'Failed to publish event to Pub/Sub.',
      );
    }
  }

  private getRunSummaryCollectionForRun(
    run: RunState,
  ): Collection<V2IngestionRunSummaryProjection> {
    const targets = run.request.persistenceTargets;
    return this.deps.mongoClient
      .db(targets.dbName)
      .collection<V2IngestionRunSummaryProjection>(INGESTION_RUN_SUMMARIES_COLLECTION);
  }

  private getNormalizedCollectionForRun(run: RunState): Collection<PersistedNormalizedJobAdDoc> {
    const targets = run.request.persistenceTargets;
    return this.deps.mongoClient
      .db(targets.dbName)
      .collection<PersistedNormalizedJobAdDoc>(NORMALIZED_JOB_ADS_COLLECTION);
  }

  private async ensureIndexesForRun(run: RunState): Promise<void> {
    await this.getRunSummaryCollectionForRun(run).createIndex(
      { runId: 1 },
      { unique: true, name: 'runId_unique' },
    );
    await this.getNormalizedCollectionForRun(run).createIndex(
      { id: 1 },
      { unique: true, name: 'id_unique' },
    );
  }
}
