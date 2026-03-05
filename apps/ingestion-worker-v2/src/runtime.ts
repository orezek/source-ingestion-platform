import { randomUUID } from 'node:crypto';
import type { Topic } from '@google-cloud/pubsub';
import type { Bucket, Storage } from '@google-cloud/storage';
import {
  buildIngestionLifecycleEvent,
  crawlerDetailCapturedEventSchema,
  crawlerRunFinishedEventSchema,
  ingestionRunFinishedEventV2Schema,
  ingestionRunStartedEventV2Schema,
  ingestionRunSummaryProjectionV2Schema,
  ingestionStartRunRequestV2Schema,
  ingestionTriggerRequestProjectionV2Schema,
  startRunAcceptedResponseV2Schema,
  startRunRejectedResponseV2Schema,
  type V2IngestionRunSummaryProjection,
  type V2IngestionTriggerRequestProjection,
} from '@repo/control-plane-contracts';
import type { FastifyBaseLogger } from 'fastify';
import type { Collection, MongoClient } from 'mongodb';
import { z } from 'zod';
import type { EnvSchema } from './env.js';
import { IncompleteDetailPageError } from './full-model/html-detail-loader.js';
import { FullModelParser } from './full-model/parser.js';
import type { SourceListingRecord, UnifiedJobAd } from './full-model/schema.js';

type IngestionStartRunRequestV2 = z.infer<typeof ingestionStartRunRequestV2Schema>;
type CrawlerDetailCapturedEvent = z.infer<typeof crawlerDetailCapturedEventSchema>;
type CrawlerRunFinishedEvent = z.infer<typeof crawlerRunFinishedEventSchema>;

type ItemInput = {
  source: string;
  crawlRunId: string;
  searchSpaceId: string;
  sourceId: string;
  dedupeKey: string;
  detailHtmlPath: string;
  datasetFileName?: string;
  datasetRecordIndex?: number;
  listingRecord: SourceListingRecord;
};

type RunOutputRef = {
  sourceId: string;
  dedupeKey: string;
  mongoTargetRef: string;
  downloadableJsonPath: string;
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
  requestedAt: string;
  startedAt: string;
  finishedAt: string | null;
  cancelRequested: boolean;
  waitForCrawlerFinished: boolean;
  crawlerFinished: boolean;
  queueDepth: number;
  activeItems: number;
  counters: RunCounters;
  metrics: RunMetricsAccumulator;
  outputs: RunOutputRef[];
  seenDedupeKeys: Set<string>;
  lastHeartbeatAt: string;
};

type QueueItem = {
  runId: string;
  item: ItemInput;
};

type RuntimeDeps = {
  env: EnvSchema;
  logger: FastifyBaseLogger;
  eventsTopic: Topic;
  storage: Storage;
  outputsBucket: Bucket;
  mongoClient: MongoClient;
};

type PersistedNormalizedJobAdDoc = UnifiedJobAd;

type StartRunResponse = z.infer<typeof startRunAcceptedResponseV2Schema>;

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

function buildRunTriggerId(run: RunState): string {
  return `run:${run.request.pipelineSnapshot.id}:${run.request.pipelineSnapshot.searchSpaceId}:${run.runId}`;
}

function buildItemTriggerId(item: ItemInput): string {
  return `item:${item.source}:${item.searchSpaceId}:${item.crawlRunId}:${item.sourceId}`;
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
    await this.deps.mongoClient.db(this.deps.env.MONGODB_DB_NAME).command({ ping: 1 });

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
    const run: RunState = {
      request: parsedRequest,
      runId: parsedRequest.runId,
      idempotencyKey: parsedRequest.idempotencyKey,
      status: 'running',
      requestedAt: parsedRequest.requestedAt,
      startedAt,
      finishedAt: null,
      cancelRequested: false,
      waitForCrawlerFinished: parsedRequest.inputRef.records.length === 0,
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
      seenDedupeKeys: new Set<string>(),
      lastHeartbeatAt: startedAt,
    };

    this.runs.set(run.runId, run);
    await this.ensureIndexesForRun(run);
    await this.upsertRunTrigger(run);
    await this.publishRunStarted(run);

    for (const record of parsedRequest.inputRef.records) {
      const item: ItemInput = {
        source: record.source,
        crawlRunId: parsedRequest.inputRef.crawlRunId,
        searchSpaceId: parsedRequest.inputRef.searchSpaceId,
        sourceId: record.sourceId,
        dedupeKey: record.dedupeKey,
        detailHtmlPath: record.detailHtmlPath,
        datasetFileName: record.datasetFileName,
        datasetRecordIndex: record.datasetRecordIndex,
        listingRecord: record.listingRecord,
      };

      await this.queueItem(run, item);
    }

    await this.tryFinalizeRun(run);

    return startRunAcceptedResponseV2Schema.parse({
      contractVersion: 'v2',
      ok: true,
      runId: run.runId,
      workerType: 'ingestion',
      accepted: true,
      deduplicated: false,
      state: 'accepted',
      message: 'Run accepted for ingestion execution.',
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
      requestedAt: run.requestedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      cancelRequested: run.cancelRequested,
      waitForCrawlerFinished: run.waitForCrawlerFinished,
      crawlerFinished: run.crawlerFinished,
      queueDepth: run.queueDepth,
      activeItems: run.activeItems,
      counters: run.counters,
      lastHeartbeatAt: run.lastHeartbeatAt,
      outputsCount: run.outputs.length,
    };
  }

  public async cancelRun(runId: string): Promise<Record<string, unknown>> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new NotFoundError(`Run "${runId}" does not exist on this worker.`);
    }

    run.cancelRequested = true;
    run.lastHeartbeatAt = nowIso();
    await this.tryFinalizeRun(run, 'cancelled_by_operator');

    return {
      runId: run.runId,
      cancelRequested: true,
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

  public async handlePubSubMessage(rawMessage: string): Promise<void> {
    const parsedJson: unknown = JSON.parse(rawMessage);
    const eventType =
      typeof parsedJson === 'object' &&
      parsedJson !== null &&
      'eventType' in parsedJson &&
      typeof parsedJson.eventType === 'string'
        ? parsedJson.eventType
        : null;

    if (eventType === 'crawler.detail.captured') {
      const parsedEvent = crawlerDetailCapturedEventSchema.safeParse(parsedJson);
      if (!parsedEvent.success) {
        this.deps.logger.warn(
          { issues: parsedEvent.error.issues },
          'Skipping malformed crawler.detail.captured event.',
        );
        return;
      }

      await this.handleCrawlerDetailCapturedEvent(parsedEvent.data);
      return;
    }

    if (eventType === 'crawler.run.finished') {
      const parsedEvent = crawlerRunFinishedEventSchema.safeParse(parsedJson);
      if (!parsedEvent.success) {
        this.deps.logger.warn(
          { issues: parsedEvent.error.issues },
          'Skipping malformed crawler.run.finished event.',
        );
        return;
      }

      await this.handleCrawlerRunFinishedEvent(parsedEvent.data);
      return;
    }
  }

  private async handleCrawlerDetailCapturedEvent(event: CrawlerDetailCapturedEvent): Promise<void> {
    const run = this.runs.get(event.runId);
    if (!run || run.status !== 'running') {
      return;
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

    await this.queueItem(run, item);
  }

  private async handleCrawlerRunFinishedEvent(event: CrawlerRunFinishedEvent): Promise<void> {
    const run = this.runs.get(event.runId);
    if (!run || run.status !== 'running') {
      return;
    }

    run.crawlerFinished = true;
    run.lastHeartbeatAt = nowIso();
    await this.tryFinalizeRun(run);
  }

  private async queueItem(run: RunState, item: ItemInput): Promise<void> {
    if (run.seenDedupeKeys.has(item.dedupeKey)) {
      return;
    }

    run.seenDedupeKeys.add(item.dedupeKey);
    run.counters.received += 1;
    run.lastHeartbeatAt = nowIso();

    await this.upsertItemTriggerPending(run, item);
    run.queueDepth += 1;
    this.itemQueue.push({ runId: run.runId, item });
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.activeWorkers < this.deps.env.MAX_CONCURRENT_RUNS && this.itemQueue.length > 0) {
      const workItem = this.itemQueue.shift();
      if (!workItem) {
        return;
      }

      const run = this.runs.get(workItem.runId);
      if (!run || run.status !== 'running') {
        continue;
      }

      run.queueDepth = Math.max(0, run.queueDepth - 1);
      run.activeItems += 1;
      this.activeWorkers += 1;

      void this.processQueueItem(run, workItem.item)
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error, runId: run.runId }, 'Queue item processing failed.');
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

  private async processQueueItem(run: RunState, item: ItemInput): Promise<void> {
    const triggerId = buildItemTriggerId(item);
    if (run.cancelRequested) {
      run.counters.rejected += 1;
      await this.markItemTriggerFailed(run, triggerId, 'Run cancelled before item processing.');
      await this.publishIngestionItemEvent('ingestion.item.rejected', run, item, {
        reason: 'run_cancelled',
      });
      return;
    }

    await this.markItemTriggerRunning(run, triggerId);
    await this.publishIngestionItemEvent('ingestion.item.started', run, item);

    try {
      const unifiedDoc = await this.fullModelParser.parse({
        runId: run.runId,
        crawlRunId: item.crawlRunId,
        searchSpaceId: item.searchSpaceId,
        detailHtmlPath: item.detailHtmlPath,
        datasetFileName: item.datasetFileName ?? 'dataset.json',
        datasetRecordIndex: item.datasetRecordIndex ?? 0,
        listingRecord: item.listingRecord,
      });
      const normalizedDoc: PersistedNormalizedJobAdDoc = unifiedDoc;

      await this.getNormalizedCollectionForRun(run).replaceOne(
        { id: normalizedDoc.id },
        normalizedDoc,
        { upsert: true },
      );

      const downloadablePath = this.buildDownloadablePath(run, item);
      await this.deps.outputsBucket
        .file(downloadablePath)
        .save(`${JSON.stringify(normalizedDoc, null, 2)}\n`, {
          contentType: 'application/json',
        });

      this.recordRunMetrics(run, normalizedDoc);
      run.counters.processed += 1;
      run.outputs.push({
        sourceId: item.sourceId,
        dedupeKey: item.dedupeKey,
        mongoTargetRef: `${run.request.persistenceTargets.dbName}.${run.request.persistenceTargets.normalizedJobAdsCollection}`,
        downloadableJsonPath: `gs://${this.deps.env.OUTPUTS_BUCKET}/${downloadablePath}`,
        createdAt: nowIso(),
      });

      await this.markItemTriggerSucceeded(run, triggerId, run.runId, {
        totalTokensUsed: normalizedDoc.ingestion.llmTotalTokens,
        totalEstimatedCostUsd: normalizedDoc.ingestion.llmTotalCostUsd,
      });
      await this.publishIngestionItemEvent('ingestion.item.succeeded', run, item, {
        sinkResults: [
          {
            sinkType: 'mongodb',
            targetRef: `${run.request.persistenceTargets.dbName}.${run.request.persistenceTargets.normalizedJobAdsCollection}`,
            writeMode: 'upsert',
          },
          {
            sinkType: 'downloadable_json',
            targetRef: `gs://${this.deps.env.OUTPUTS_BUCKET}/${downloadablePath}`,
            writeMode: 'overwrite',
          },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof IncompleteDetailPageError) {
        run.counters.rejected += 1;
        await this.markItemTriggerFailed(run, triggerId, message);
        await this.publishIngestionItemEvent('ingestion.item.rejected', run, item, {
          reason: 'incomplete_detail_page',
        });
      } else {
        run.counters.failed += 1;
        await this.markItemTriggerFailed(run, triggerId, message);
        await this.publishIngestionItemEvent('ingestion.item.failed', run, item, {
          error: {
            name: error instanceof Error ? error.name : 'IngestionItemError',
            message,
          },
        });
      }
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

  private async upsertRunTrigger(run: RunState): Promise<void> {
    const id = buildRunTriggerId(run);
    const now = nowIso();
    const seed = ingestionTriggerRequestProjectionV2Schema.parse({
      id,
      triggerType: 'run',
      source: run.request.pipelineSnapshot.id,
      crawlRunId: run.runId,
      searchSpaceId: run.request.pipelineSnapshot.searchSpaceId,
      mongoDbName: run.request.persistenceTargets.dbName,
      status: 'running',
      requestedAt: run.requestedAt,
      startedAt: run.startedAt,
      updatedAt: now,
      attemptCount: 1,
    });
    const seedOnInsert = {
      id: seed.id,
      triggerType: seed.triggerType,
      source: seed.source,
      crawlRunId: seed.crawlRunId,
      searchSpaceId: seed.searchSpaceId,
      mongoDbName: seed.mongoDbName,
      requestedAt: seed.requestedAt,
    };

    await this.getTriggerCollectionForRun(run).updateOne(
      { id },
      {
        $setOnInsert: seedOnInsert,
        $set: {
          status: 'running',
          startedAt: run.startedAt,
          updatedAt: now,
          attemptCount: 1,
        },
      },
      { upsert: true },
    );
  }

  private async upsertItemTriggerPending(run: RunState, item: ItemInput): Promise<void> {
    const requestedAt = nowIso();
    const id = buildItemTriggerId(item);
    const seed = ingestionTriggerRequestProjectionV2Schema.parse({
      id,
      triggerType: 'item',
      source: item.source,
      crawlRunId: item.crawlRunId,
      searchSpaceId: item.searchSpaceId,
      mongoDbName: run.request.persistenceTargets.dbName,
      sourceId: item.sourceId,
      detailHtmlPath: item.detailHtmlPath,
      datasetFileName: item.datasetFileName,
      datasetRecordIndex: item.datasetRecordIndex,
      status: 'pending',
      requestedAt,
      updatedAt: requestedAt,
      attemptCount: 0,
    });

    await this.getTriggerCollectionForRun(run).updateOne(
      { id },
      {
        $setOnInsert: seed,
      },
      { upsert: true },
    );
  }

  private async markItemTriggerRunning(run: RunState, id: string): Promise<void> {
    const startedAt = nowIso();
    await this.getTriggerCollectionForRun(run).updateOne(
      { id },
      {
        $set: {
          status: 'running',
          startedAt,
          updatedAt: startedAt,
        },
        $inc: {
          attemptCount: 1,
        },
      },
    );
  }

  private async markItemTriggerSucceeded(
    run: RunState,
    id: string,
    ingestionRunId: string,
    itemMetrics: {
      totalTokensUsed: number;
      totalEstimatedCostUsd: number;
    },
  ): Promise<void> {
    const completedAt = nowIso();
    await this.getTriggerCollectionForRun(run).updateOne(
      { id },
      {
        $set: {
          status: 'succeeded',
          completedAt,
          updatedAt: completedAt,
          ingestionRunId,
          result: {
            jobsProcessed: 1,
            jobsSkippedIncomplete: 0,
            jobsFailed: 0,
            totalTokensUsed: itemMetrics.totalTokensUsed,
            totalEstimatedCostUsd: itemMetrics.totalEstimatedCostUsd,
            mongoWritesStructured: 1,
            mongoWritesRunSummary: 0,
          },
        },
      },
    );
  }

  private async markItemTriggerFailed(
    run: RunState,
    id: string,
    errorMessage: string,
  ): Promise<void> {
    const completedAt = nowIso();
    await this.getTriggerCollectionForRun(run).updateOne(
      { id },
      {
        $set: {
          status: 'failed',
          completedAt,
          updatedAt: completedAt,
          errorMessage,
        },
      },
    );
  }

  private async tryFinalizeRun(run: RunState, stopReason?: string): Promise<void> {
    if (run.status !== 'running') {
      return;
    }

    if (run.cancelRequested && run.queueDepth === 0 && run.activeItems === 0) {
      await this.finalizeRun(run, 'stopped', stopReason ?? 'cancelled_by_operator');
      return;
    }

    const canFinalize =
      (!run.waitForCrawlerFinished || run.crawlerFinished) && run.queueDepth === 0;
    if (!canFinalize || run.activeItems > 0) {
      return;
    }

    const hasErrors = run.counters.failed > 0 || run.counters.rejected > 0;
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

    const runDurationSeconds =
      Math.max(new Date(finishedAt).getTime() - new Date(run.startedAt).getTime(), 0) / 1_000;
    const jobsTotal = run.counters.received;
    const jobsNonSuccess = run.counters.failed + run.counters.rejected;
    const jobsSuccessRate = jobsTotal > 0 ? run.counters.processed / jobsTotal : 1;
    const jobsNonSuccessRate = jobsTotal > 0 ? jobsNonSuccess / jobsTotal : 0;
    const jobsFailedRate = jobsTotal > 0 ? run.counters.failed / jobsTotal : 0;
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
      jobsProcessed: run.counters.processed,
      jobsSkippedIncomplete: run.counters.rejected,
      jobsFailed: run.counters.failed,
      jobsNonSuccess,
      jobsSuccessRate,
      jobsNonSuccessRate,
      jobsSkippedIncompleteRate: jobsTotal > 0 ? run.counters.rejected / jobsTotal : 0,
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

    const runTriggerId = buildRunTriggerId(run);
    await this.getTriggerCollectionForRun(run).updateOne(
      { id: runTriggerId },
      {
        $set: {
          status: status === 'stopped' ? 'failed' : status,
          completedAt: finishedAt,
          updatedAt: finishedAt,
          ingestionRunId: run.runId,
          result: {
            jobsProcessed: run.counters.processed,
            jobsSkippedIncomplete: run.counters.rejected,
            jobsFailed: run.counters.failed,
            totalTokensUsed: llmTotalStats.totalTokens,
            totalEstimatedCostUsd: llmTotalStats.totalCostUsd,
            mongoWritesStructured: run.counters.processed,
            mongoWritesRunSummary: 1,
          },
          ...(stopReason ? { errorMessage: stopReason } : {}),
        },
      },
      { upsert: true },
    );

    await this.publishRunFinished(run, status, stopReason);
  }

  private buildDownloadablePath(run: RunState, item: ItemInput): string {
    const prefix = this.deps.env.OUTPUTS_PREFIX.replace(/^\/+|\/+$/g, '');
    const fileName = `${item.sourceId}-${randomUUID()}.json`;
    return prefix.length > 0 ? `${prefix}/${run.runId}/${fileName}` : `${run.runId}/${fileName}`;
  }

  private async publishRunStarted(run: RunState): Promise<void> {
    const event = ingestionRunStartedEventV2Schema.parse({
      eventId: `evt-${randomUUID()}`,
      eventVersion: 'v2',
      eventType: 'ingestion.run.started',
      occurredAt: nowIso(),
      runId: run.runId,
      correlationId: run.request.correlationId,
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
      correlationId: run.request.correlationId,
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
    },
  ): Promise<void> {
    const event = buildIngestionLifecycleEvent({
      eventType,
      runId: run.runId,
      crawlRunId: item.crawlRunId,
      source: item.source,
      sourceId: item.sourceId,
      dedupeKey: item.dedupeKey,
      documentId: item.dedupeKey,
      sinkResults: options?.sinkResults,
      error: options?.error,
      reason: options?.reason,
      producer: this.deps.env.SERVICE_NAME,
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

  private getTriggerCollectionForRun(
    run: RunState,
  ): Collection<V2IngestionTriggerRequestProjection> {
    const targets = run.request.persistenceTargets;
    return this.deps.mongoClient
      .db(targets.dbName)
      .collection<V2IngestionTriggerRequestProjection>(targets.ingestionTriggerRequestsCollection);
  }

  private getRunSummaryCollectionForRun(
    run: RunState,
  ): Collection<V2IngestionRunSummaryProjection> {
    const targets = run.request.persistenceTargets;
    return this.deps.mongoClient
      .db(targets.dbName)
      .collection<V2IngestionRunSummaryProjection>(targets.ingestionRunSummariesCollection);
  }

  private getNormalizedCollectionForRun(run: RunState): Collection<PersistedNormalizedJobAdDoc> {
    const targets = run.request.persistenceTargets;
    return this.deps.mongoClient
      .db(targets.dbName)
      .collection<PersistedNormalizedJobAdDoc>(targets.normalizedJobAdsCollection);
  }

  private async ensureIndexesForRun(run: RunState): Promise<void> {
    await this.getTriggerCollectionForRun(run).createIndex(
      { id: 1 },
      { unique: true, name: 'id_unique' },
    );
    await this.getTriggerCollectionForRun(run).createIndex(
      { status: 1, updatedAt: -1 },
      { name: 'status_updatedAt' },
    );
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
