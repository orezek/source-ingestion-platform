import { createHash, randomUUID } from 'node:crypto';
import type { Topic } from '@google-cloud/pubsub';
import {
  ensureArtifactRunReady,
  writeDatasetMetadata,
  writeHtmlArtifact,
} from '@repo/control-plane-adapters';
import {
  buildCrawlerDetailCapturedEventV2,
  buildCrawlerRunFinishedEventV2,
  crawlerRunStartedEventV2Schema,
  crawlerStartRunRequestV2Schema,
  crawlRunSummaryProjectionV2Schema,
  startRunAcceptedResponseV2Schema,
  v2ArtifactSinkSchema,
  v2CrawlerSearchSpaceSnapshotSchema,
  v2SourceListingRecordSchema,
} from '@repo/control-plane-contracts';
import {
  PlaywrightCrawler,
  createPlaywrightRouter,
  type PlaywrightCrawlingContext,
  type PlaywrightCrawler as PlaywrightCrawlerType,
} from 'crawlee';
import type { FastifyBaseLogger } from 'fastify';
import type { Collection, MongoClient } from 'mongodb';
import { z } from 'zod';
import { waitForDetailRenderReadiness } from './detail-rendering.js';
import type { EnvSchema } from './env.js';
import { extractListingFromCard, type CrawlListingRecord } from './listing-card-parser.js';
import { NormalizedJobsRepository, type NormalizedJobDoc } from './normalized-jobs-repository.js';

type CrawlerStartRunRequestV2 = z.infer<typeof crawlerStartRunRequestV2Schema>;
type StartRunResponse = z.infer<typeof startRunAcceptedResponseV2Schema>;
type V2ArtifactSink = z.infer<typeof v2ArtifactSinkSchema>;
type V2CrawlerSearchSpaceSnapshot = z.infer<typeof v2CrawlerSearchSpaceSnapshotSchema>;
type SourceListingRecordSnapshot = z.infer<typeof v2SourceListingRecordSchema>;

type PubSubTopicLike = Pick<Topic, 'publishMessage'>;

type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'completed_with_errors'
  | 'failed'
  | 'stopped';
type FinishedRunStatus = Exclude<RunStatus, 'queued' | 'running'>;

type RuntimeDeps = {
  env: EnvSchema;
  logger: FastifyBaseLogger;
  eventsTopic: PubSubTopicLike;
  mongoClient: MongoClient;
};

type RunSummaryShape = {
  crawlState: {
    mongoDbName: string;
    normalizedJobsCollection: string;
    crawlRunSummariesCollection: string;
  };
  input: {
    searchSpaceId: string;
    startUrls: string[];
    maxItems: number;
    maxConcurrency: number | null;
    maxRequestsPerMinute: number | null;
  };
  outcome: {
    stopReason: string;
    listPhaseCompleted: boolean;
    detailPhaseStarted: boolean;
    detailPhaseCompleted: boolean;
    listPhaseTruncated: boolean;
    inactiveMarkingSkipped: boolean;
    inactiveMarkingSkipReason: string | null;
    failedListRequests: number;
    failedDetailRequests: number;
    failedRequests: number;
  };
  counters: {
    listPagesVisited: number;
    detailPagesVisited: number;
    htmlSnapshotsSaved: number;
    datasetRecordsStored: number;
    reconcileNewJobsCount: number;
    reconcileExistingJobsCount: number;
    inactiveMarkedCount: number;
    existingSeenUpdatedCount: number;
  };
  failedRequestUrls: string[];
  listPageResults: {
    totalSeenListings: number;
    seedCount: number;
  };
};

type RunState = {
  request: CrawlerStartRunRequestV2;
  runId: string;
  idempotencyKey: string;
  status: RunStatus;
  cancelRequested: boolean;
  cancelReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string;
  queuedAt: string;
  executingPhase: 'queued' | 'list' | 'detail' | 'finalizing' | 'done';
  currentCrawler: PlaywrightCrawlerType | null;
  listPagesVisited: number;
  detailPagesVisited: number;
  failedRequests: number;
  failedListRequests: number;
  failedDetailRequests: number;
  failedRequestUrls: string[];
  htmlSnapshotsSaved: number;
  datasetRecordsStored: number;
  reconcileNewJobsCount: number;
  reconcileExistingJobsCount: number;
  inactiveMarkedCount: number;
  existingSeenUpdatedCount: number;
  inactiveMarkingSkipped: boolean;
  inactiveMarkingSkipReason: string | null;
  listPhaseCompleted: boolean;
  detailPhaseStarted: boolean;
  detailPhaseCompleted: boolean;
  listPhaseTruncated: boolean;
  listPhaseStopLogged: boolean;
  summaryPath: string | null;
  onSettled: Promise<void>;
  resolveSettled: () => void;
  watchdogTimer: NodeJS.Timeout | null;
};

type ListPhaseResult = {
  collectedListingsBySourceId: Map<string, CrawlListingRecord>;
  listPhaseTrustworthy: boolean;
  listPhaseSkipReason: string | undefined;
};

const CRAWL_RUN_SUMMARIES_COLLECTION = 'crawl_run_summaries';
const NORMALIZED_JOB_ADS_COLLECTION = 'normalized_job_ads';
const JOB_CARD_SELECTOR = 'article.SearchResultCard, article[data-jobad-id]';
const NEXT_PAGE_SELECTOR = '.Pagination__button--next, [data-test="pagination-next"]';
const MASS_INACTIVATION_GUARD_MIN_ACTIVE_COUNT = 100;
const MASS_INACTIVATION_GUARD_MIN_SEEN_RATIO = 0.5;

export class ConflictError extends Error {
  public readonly statusCode = 409;
}

export class NotFoundError extends Error {
  public readonly statusCode = 404;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((resolver) => {
    resolve = () => {
      resolver();
    };
  });

  return {
    promise,
    resolve: () => {
      resolve?.();
    },
  };
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildListingRecordSnapshot(input: {
  source: string;
  sourceId: string;
  adUrl: string;
  jobTitle: string;
  companyName: string;
  location: string;
  salary: string | null;
  publishedInfoText: string;
  scrapedAt: string;
}): SourceListingRecordSnapshot {
  return {
    sourceId: input.sourceId,
    adUrl: input.adUrl,
    jobTitle: input.jobTitle,
    companyName: normalizeNullableText(input.companyName),
    location: normalizeNullableText(input.location),
    salary: input.salary,
    publishedInfoText: normalizeNullableText(input.publishedInfoText),
    scrapedAt: input.scrapedAt,
    source: input.source,
    htmlDetailPageKey: `job-html-${input.sourceId}.html`,
  };
}

function toLegacyArtifactSink(sink: V2ArtifactSink) {
  if (sink.type === 'local_filesystem') {
    return {
      type: 'local_filesystem' as const,
      config: {
        basePath: sink.basePath,
      },
    };
  }

  return {
    type: 'gcs' as const,
    config: {
      bucket: sink.bucket,
      prefix: sink.prefix,
    },
  };
}

export class CrawlerWorkerRuntime {
  private readonly runs = new Map<string, RunState>();
  private readonly queuedRunIds: string[] = [];
  private readonly normalizedJobsRepos = new Map<string, NormalizedJobsRepository>();
  private readonly crawlRunSummariesCollections = new Map<string, Collection>();
  private activeRuns = 0;
  private persistenceReady = false;

  public constructor(private readonly deps: RuntimeDeps) {}

  public async initialize(): Promise<void> {
    await this.deps.mongoClient.db().command({ ping: 1 });
    this.persistenceReady = true;
  }

  public isReady(): boolean {
    return this.persistenceReady;
  }

  public async startRun(raw: unknown): Promise<StartRunResponse> {
    const parsed = crawlerStartRunRequestV2Schema.parse(raw);
    const existing = this.runs.get(parsed.runId);
    if (existing) {
      if (existing.idempotencyKey !== parsed.idempotencyKey) {
        throw new ConflictError(
          'Run already exists with a different idempotency key. Use a new runId or matching key.',
        );
      }

      return startRunAcceptedResponseV2Schema.parse({
        contractVersion: 'v2',
        ok: true,
        runId: existing.runId,
        workerType: 'crawler',
        accepted: true,
        deduplicated: true,
        state: existing.status === 'queued' ? 'queued' : 'deduplicated',
        message: 'Run request deduplicated.',
      });
    }

    const canStartImmediately =
      this.activeRuns < this.deps.env.MAX_CONCURRENT_RUNS && this.queuedRunIds.length === 0;
    const deferred = createDeferred();
    const run: RunState = {
      request: parsed,
      runId: parsed.runId,
      idempotencyKey: parsed.idempotencyKey,
      status: 'queued',
      cancelRequested: false,
      cancelReason: null,
      startedAt: null,
      finishedAt: null,
      lastHeartbeatAt: nowIso(),
      queuedAt: nowIso(),
      executingPhase: 'queued',
      currentCrawler: null,
      listPagesVisited: 0,
      detailPagesVisited: 0,
      failedRequests: 0,
      failedListRequests: 0,
      failedDetailRequests: 0,
      failedRequestUrls: [],
      htmlSnapshotsSaved: 0,
      datasetRecordsStored: 0,
      reconcileNewJobsCount: 0,
      reconcileExistingJobsCount: 0,
      inactiveMarkedCount: 0,
      existingSeenUpdatedCount: 0,
      inactiveMarkingSkipped: false,
      inactiveMarkingSkipReason: null,
      listPhaseCompleted: false,
      detailPhaseStarted: false,
      detailPhaseCompleted: false,
      listPhaseTruncated: false,
      listPhaseStopLogged: false,
      summaryPath: null,
      onSettled: deferred.promise,
      resolveSettled: deferred.resolve,
      watchdogTimer: null,
    };

    this.runs.set(run.runId, run);
    this.queuedRunIds.push(run.runId);
    this.pumpQueuedRuns();

    const state = canStartImmediately ? 'accepted' : 'queued';
    return startRunAcceptedResponseV2Schema.parse({
      contractVersion: 'v2',
      ok: true,
      runId: run.runId,
      workerType: 'crawler',
      accepted: true,
      deduplicated: false,
      state,
      message:
        state === 'queued'
          ? 'Run accepted and queued for execution.'
          : 'Run accepted for execution.',
    });
  }

  public async cancelRun(runId: string): Promise<{
    ok: true;
    runId: string;
    cancelRequested: true;
    state: RunStatus;
  }> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new NotFoundError(`Run "${runId}" was not found.`);
    }

    if (run.status === 'queued') {
      run.cancelRequested = true;
      run.cancelReason = 'cancelled_by_operator';
      this.removeQueuedRun(run.runId);
      await this.ensureCollections(run.request.persistenceTargets.dbName);
      await this.finalizeRun(run, {
        status: 'stopped',
        stopReason: 'cancelled_by_operator',
        source: run.request.inputRef.source,
        datasetRecords: [],
      });
      return {
        ok: true,
        runId: run.runId,
        cancelRequested: true,
        state: run.status,
      };
    }

    run.cancelRequested = true;
    run.cancelReason = 'cancelled_by_operator';
    if (run.currentCrawler) {
      await run.currentCrawler.stop();
    }

    return {
      ok: true,
      runId: run.runId,
      cancelRequested: true,
      state: run.status,
    };
  }

  public async waitUntilSettled(runId: string, timeoutMs: number): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new NotFoundError(`Run "${runId}" was not found.`);
    }

    const timeoutPromise = new Promise<void>((_resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for run "${runId}" to settle.`));
      }, timeoutMs);

      void run.onSettled.finally(() => {
        clearTimeout(timer);
      });
    });

    await Promise.race([run.onSettled, timeoutPromise]);
  }

  private pumpQueuedRuns(): void {
    while (this.activeRuns < this.deps.env.MAX_CONCURRENT_RUNS && this.queuedRunIds.length > 0) {
      const runId = this.queuedRunIds.shift();
      if (!runId) {
        break;
      }

      const run = this.runs.get(runId);
      if (!run || run.cancelRequested) {
        continue;
      }

      this.activeRuns += 1;
      void this.executeRun(run)
        .catch((error) => {
          this.deps.logger.error(
            { err: error, runId: run.runId },
            'Unhandled crawler run execution error.',
          );
        })
        .finally(() => {
          this.activeRuns = Math.max(0, this.activeRuns - 1);
          this.pumpQueuedRuns();
        });
    }
  }

  private removeQueuedRun(runId: string): void {
    const index = this.queuedRunIds.indexOf(runId);
    if (index >= 0) {
      this.queuedRunIds.splice(index, 1);
    }
  }

  private async executeRun(run: RunState): Promise<void> {
    const { request } = run;
    const startedAt = nowIso();
    run.status = 'running';
    run.startedAt = startedAt;
    run.lastHeartbeatAt = startedAt;
    run.executingPhase = 'list';
    this.startWatchdog(run);

    let datasetRecords: Array<Record<string, unknown>> = [];
    let stopReason = 'completed';
    let finalStatus: Exclude<RunStatus, 'queued'> = 'succeeded';

    try {
      await this.ensureCollections(request.persistenceTargets.dbName);
      await this.publishRunStarted(run);

      const listPhase = await this.runListPhase(run, request.inputRef.searchSpaceSnapshot);
      const reconcileObservedAtIso = nowIso();
      const reconcileResult = await (
        await this.getNormalizedJobsRepo(request.persistenceTargets.dbName)
      ).reconcileListings({
        source: request.inputRef.source,
        searchSpaceId: request.inputRef.searchSpaceId,
        crawlRunId: run.runId,
        observedAtIso: reconcileObservedAtIso,
        listings: Array.from(listPhase.collectedListingsBySourceId.values()),
        allowInactiveMarking: request.inputRef.searchSpaceSnapshot.allowInactiveMarking,
        listPhaseTrustworthy: listPhase.listPhaseTrustworthy,
        listPhaseSkipReason: listPhase.listPhaseSkipReason,
        massInactivationGuardMinActiveCount: MASS_INACTIVATION_GUARD_MIN_ACTIVE_COUNT,
        massInactivationGuardMinSeenRatio: MASS_INACTIVATION_GUARD_MIN_SEEN_RATIO,
      });

      run.reconcileNewJobsCount = reconcileResult.newListings.length;
      run.reconcileExistingJobsCount = reconcileResult.existingCount;
      run.inactiveMarkedCount = reconcileResult.inactiveMarkedCount;
      run.existingSeenUpdatedCount = reconcileResult.existingSeenUpdatedCount;
      run.inactiveMarkingSkipped = reconcileResult.inactiveMarkingSkipped;
      run.inactiveMarkingSkipReason = reconcileResult.inactiveMarkingSkipReason;

      if (run.inactiveMarkingSkipped) {
        this.deps.logger.info(
          {
            runId: run.runId,
            reason: run.inactiveMarkingSkipReason,
            listPagesVisited: run.listPagesVisited,
            totalSeenListings: listPhase.collectedListingsBySourceId.size,
            maxItems: request.inputRef.searchSpaceSnapshot.maxItems,
          },
          'Skipping inactive marking because list-phase coverage was not trustworthy.',
        );
      }

      if (!run.cancelRequested && reconcileResult.newListings.length > 0) {
        run.detailPhaseStarted = true;
        run.executingPhase = 'detail';
        this.deps.logger.info(
          {
            runId: run.runId,
            detailCount: reconcileResult.newListings.length,
            existingJobsCount: reconcileResult.existingCount,
            listPagesVisited: run.listPagesVisited,
          },
          'Starting crawler detail phase for newly discovered listings.',
        );
        datasetRecords = await this.runDetailPhase(run, reconcileResult.newListings);
      }

      run.detailPhaseCompleted = !run.detailPhaseStarted || !run.cancelRequested;

      if (run.cancelRequested) {
        finalStatus = 'stopped';
        stopReason = run.cancelReason ?? 'cancelled_by_operator';
      } else if (run.failedRequests > 0) {
        finalStatus = 'completed_with_errors';
        stopReason =
          run.failedDetailRequests > 0 ? 'detail_request_failures' : 'list_request_failures';
      } else if (run.reconcileNewJobsCount === 0) {
        finalStatus = 'succeeded';
        stopReason = 'no_new_jobs';
      }
    } catch (error) {
      if (run.cancelRequested) {
        finalStatus = 'stopped';
        stopReason = run.cancelReason ?? 'cancelled_by_operator';
      } else {
        finalStatus = 'failed';
        stopReason = 'crawler_error';
        this.deps.logger.error({ err: error, runId: run.runId }, 'Crawler worker run failed.');
      }
    } finally {
      await this.finalizeRun(run, {
        status: finalStatus,
        stopReason,
        source: request.inputRef.source,
        datasetRecords,
      });
    }
  }

  private startWatchdog(run: RunState): void {
    const hardTimeoutSeconds = run.request.timeouts?.hardTimeoutSeconds;
    const idleTimeoutSeconds = run.request.timeouts?.idleTimeoutSeconds;
    if (!hardTimeoutSeconds && !idleTimeoutSeconds) {
      return;
    }

    const startedAtMs = Date.parse(run.startedAt ?? nowIso());
    run.watchdogTimer = setInterval(() => {
      const nowMs = Date.now();
      if (hardTimeoutSeconds && nowMs - startedAtMs > hardTimeoutSeconds * 1000) {
        void this.requestStop(run, 'hard_timeout');
        return;
      }

      if (
        idleTimeoutSeconds &&
        nowMs - Date.parse(run.lastHeartbeatAt) > idleTimeoutSeconds * 1000
      ) {
        void this.requestStop(run, 'idle_timeout');
      }
    }, 1000);
  }

  private async requestStop(run: RunState, reason: string): Promise<void> {
    if (run.cancelRequested) {
      return;
    }

    run.cancelRequested = true;
    run.cancelReason = reason;
    if (run.currentCrawler) {
      await run.currentCrawler.stop();
    }
  }

  private touchHeartbeat(run: RunState): void {
    run.lastHeartbeatAt = nowIso();
  }

  private async getNormalizedJobsRepo(dbName: string): Promise<NormalizedJobsRepository> {
    const existing = this.normalizedJobsRepos.get(dbName);
    if (existing) {
      return existing;
    }

    const repo = new NormalizedJobsRepository(
      this.deps.mongoClient.db(dbName).collection<NormalizedJobDoc>(NORMALIZED_JOB_ADS_COLLECTION),
    );
    await repo.ensureIndexes();
    this.normalizedJobsRepos.set(dbName, repo);
    return repo;
  }

  private async ensureCollections(dbName: string): Promise<void> {
    const crawlSummaries = this.deps.mongoClient
      .db(dbName)
      .collection(CRAWL_RUN_SUMMARIES_COLLECTION);
    await crawlSummaries.createIndexes([
      { key: { crawlRunId: 1 }, name: 'crawlRunId_unique', unique: true },
      { key: { status: 1, startedAt: -1 }, name: 'status_startedAt' },
    ]);
    this.crawlRunSummariesCollections.set(dbName, crawlSummaries);
    await this.getNormalizedJobsRepo(dbName);
  }

  private getCrawlRunSummariesCollection(dbName: string): Collection {
    const collection = this.crawlRunSummariesCollections.get(dbName);
    if (!collection) {
      throw new Error(`crawl_run_summaries collection for "${dbName}" is not initialized.`);
    }

    return collection;
  }

  private async publishRunStarted(run: RunState): Promise<void> {
    const event = crawlerRunStartedEventV2Schema.parse({
      eventId: `evt-${randomUUID()}`,
      eventVersion: 'v2',
      eventType: 'crawler.run.started',
      occurredAt: nowIso(),
      runId: run.runId,
      correlationId: run.runId,
      producer: this.deps.env.SERVICE_NAME,
      payload: {
        runId: run.runId,
        workerType: 'crawler',
        status: 'running',
        counters: {},
      },
    });

    await this.deps.eventsTopic.publishMessage({
      data: Buffer.from(JSON.stringify(event)),
      attributes: {
        runId: event.runId,
        eventType: event.eventType,
        producer: event.producer,
        occurredAt: event.occurredAt,
        correlationId: event.correlationId,
      },
    });
  }

  private createCrawlerRouter(run: RunState, listings: Map<string, CrawlListingRecord>) {
    const router = createPlaywrightRouter();

    router.addDefaultHandler(async (context) => {
      throw new Error(`Unsupported handler label "${context.request.label ?? 'unknown'}".`);
    });

    router.addHandler('LIST', async (context) => {
      await this.handleListPage(run, context, listings);
    });

    router.addHandler('DETAIL', async (context) => {
      throw new Error(
        `DETAIL handler should be installed only in detail-phase crawler. Received ${context.request.url}.`,
      );
    });

    return router;
  }

  private createCrawler(input: {
    run: RunState;
    maxRequestsPerCrawl: number;
    handleRequest: (context: PlaywrightCrawlingContext) => Promise<void>;
  }): PlaywrightCrawlerType {
    const runtimeSnapshot = input.run.request.runtimeSnapshot;
    return new PlaywrightCrawler({
      maxRequestsPerCrawl: input.maxRequestsPerCrawl,
      maxConcurrency: runtimeSnapshot.crawlerMaxConcurrency,
      maxRequestsPerMinute: runtimeSnapshot.crawlerMaxRequestsPerMinute,
      requestHandler: async (context) => {
        this.touchHeartbeat(input.run);
        await input.handleRequest(context);
      },
      failedRequestHandler: async ({ request }) => {
        const phase = request.label === 'DETAIL' ? 'detail' : 'list';
        input.run.failedRequests += 1;
        if (phase === 'detail') {
          input.run.failedDetailRequests += 1;
        } else {
          input.run.failedListRequests += 1;
        }
        input.run.failedRequestUrls.push(request.url);
        this.touchHeartbeat(input.run);
      },
      launchContext: {
        launchOptions: {
          headless: true,
        },
      },
    });
  }

  private async handleListPage(
    run: RunState,
    context: PlaywrightCrawlingContext,
    listings: Map<string, CrawlListingRecord>,
  ): Promise<void> {
    if (run.cancelRequested) {
      await context.crawler.stop();
      return;
    }

    const { page, request, crawler } = context;
    run.listPagesVisited += 1;
    await page.waitForLoadState('load');

    const cards = await page.locator(JOB_CARD_SELECTOR).all();
    for (const card of cards) {
      if (listings.size >= run.request.inputRef.searchSpaceSnapshot.maxItems) {
        run.listPhaseTruncated = true;
        break;
      }

      const extracted = await extractListingFromCard({
        card,
        baseUrl: page.url(),
        source: run.request.inputRef.source,
      });
      if (!extracted) {
        continue;
      }

      if (!listings.has(extracted.sourceId)) {
        listings.set(extracted.sourceId, extracted);
      }
    }

    const nextHref = await page
      .locator(NEXT_PAGE_SELECTOR)
      .first()
      .getAttribute('href')
      .catch(() => null);
    if (!nextHref || run.cancelRequested) {
      return;
    }

    if (listings.size >= run.request.inputRef.searchSpaceSnapshot.maxItems) {
      run.listPhaseTruncated = true;
      if (!run.listPhaseStopLogged) {
        run.listPhaseStopLogged = true;
        this.deps.logger.info(
          {
            runId: run.runId,
            collectedListings: listings.size,
            maxItems: run.request.inputRef.searchSpaceSnapshot.maxItems,
            currentListPage: page.url(),
            nextListPage: new URL(nextHref, page.url()).toString(),
          },
          'Stopping crawler list phase because maxItems was reached.',
        );
      }
      await crawler.stop();
      return;
    }

    await crawler.addRequests([
      {
        url: new URL(nextHref, page.url()).toString(),
        label: 'LIST',
        userData: request.userData,
      },
    ]);
  }

  private async runListPhase(
    run: RunState,
    searchSpaceSnapshot: V2CrawlerSearchSpaceSnapshot,
  ): Promise<ListPhaseResult> {
    const listings = new Map<string, CrawlListingRecord>();
    const listCrawler = this.createCrawler({
      run,
      maxRequestsPerCrawl: Math.max(searchSpaceSnapshot.maxItems * 5, 50),
      handleRequest: async (context) => {
        await this.handleListPage(run, context, listings);
      },
    });

    run.currentCrawler = listCrawler;
    await listCrawler.run(
      searchSpaceSnapshot.startUrls.map((url) => ({
        url,
        label: 'LIST',
      })),
    );
    run.currentCrawler = null;
    run.listPhaseCompleted = !run.cancelRequested;

    const listPhaseTrustworthy =
      !run.cancelRequested && run.failedListRequests === 0 && !run.listPhaseTruncated;
    const listPhaseSkipReason = run.cancelRequested
      ? (run.cancelReason ?? 'cancelled_by_operator')
      : run.failedListRequests > 0
        ? 'failed_list_requests'
        : run.listPhaseTruncated
          ? 'list_phase_truncated'
          : undefined;

    return {
      collectedListingsBySourceId: listings,
      listPhaseTrustworthy,
      listPhaseSkipReason,
    };
  }

  private async runDetailPhase(
    run: RunState,
    listings: CrawlListingRecord[],
  ): Promise<Array<Record<string, unknown>>> {
    const datasetRecords: Array<Record<string, unknown>> = [];
    const sink = toLegacyArtifactSink(run.request.artifactSink);
    await ensureArtifactRunReady({
      destination: sink,
      crawlRunId: run.runId,
      projectId: this.deps.env.GCP_PROJECT_ID,
    });

    const detailCrawler = this.createCrawler({
      run,
      maxRequestsPerCrawl: Math.max(listings.length * 5, 50),
      handleRequest: async (context) => {
        await this.handleDetailPage(run, context, datasetRecords, sink);
      },
    });

    run.currentCrawler = detailCrawler;
    await detailCrawler.run(
      listings.map((listing) => ({
        url: listing.adUrl,
        label: 'DETAIL',
        userData: {
          listing,
        },
      })),
    );
    run.currentCrawler = null;

    if (!run.cancelRequested) {
      run.datasetRecordsStored = datasetRecords.length;
      const datasetPath = await writeDatasetMetadata({
        destination: sink,
        crawlRunId: run.runId,
        datasetRecords,
        projectId: this.deps.env.GCP_PROJECT_ID,
      });
      run.summaryPath = datasetPath;
    }

    return datasetRecords;
  }

  private async handleDetailPage(
    run: RunState,
    context: PlaywrightCrawlingContext,
    datasetRecords: Array<Record<string, unknown>>,
    sink: ReturnType<typeof toLegacyArtifactSink>,
  ): Promise<void> {
    if (run.cancelRequested) {
      await context.crawler.stop();
      return;
    }

    const listing = context.request.userData.listing as CrawlListingRecord;
    run.detailPagesVisited += 1;
    await context.page.waitForLoadState('load');

    const requestedDetailUrl = context.request.url;
    const finalDetailUrl = context.page.url();
    await waitForDetailRenderReadiness({
      page: context.page,
      sourceId: listing.sourceId,
      requestedDetailUrl,
      finalDetailUrl,
      logger: {
        debug: (message, data) => this.deps.logger.debug({ ...data, runId: run.runId }, message),
        warn: (message, data) => this.deps.logger.warn({ ...data, runId: run.runId }, message),
      },
    }).catch((error) => {
      throw error;
    });

    const html = await context.page.content();
    const sizeBytes = Buffer.byteLength(html, 'utf8');
    const checksum = createHash('sha256').update(html, 'utf8').digest('hex');
    const storedArtifact = await writeHtmlArtifact({
      destination: sink,
      crawlRunId: run.runId,
      sourceId: listing.sourceId,
      html,
      checksum,
      sizeBytes,
      projectId: this.deps.env.GCP_PROJECT_ID,
    });
    run.htmlSnapshotsSaved += 1;

    const listingRecord = buildListingRecordSnapshot({
      source: listing.source,
      sourceId: listing.sourceId,
      adUrl: listing.adUrl,
      jobTitle: listing.jobTitle,
      companyName: listing.companyName,
      location: listing.location,
      salary: listing.salary,
      publishedInfoText: listing.publishedInfoText,
      scrapedAt: nowIso(),
    });

    datasetRecords.push({
      sourceId: listing.sourceId,
      adUrl: listing.adUrl,
      jobTitle: listing.jobTitle,
      companyName: normalizeNullableText(listing.companyName),
      location: normalizeNullableText(listing.location),
      salary: listing.salary,
      publishedInfoText: normalizeNullableText(listing.publishedInfoText),
      scrapedAt: listingRecord.scrapedAt,
      source: listing.source,
      htmlDetailPageKey: listingRecord.htmlDetailPageKey,
      detailHtmlByteSize: sizeBytes,
      detailHtmlSha256: checksum,
    });

    if (!run.request.inputRef.emitDetailCapturedEvents) {
      return;
    }

    const event = buildCrawlerDetailCapturedEventV2({
      runId: run.runId,
      crawlRunId: run.runId,
      searchSpaceId: run.request.inputRef.searchSpaceId,
      source: listing.source,
      sourceId: listing.sourceId,
      listingRecord,
      artifact: storedArtifact,
      producer: this.deps.env.SERVICE_NAME,
    });

    await this.deps.eventsTopic.publishMessage({
      data: Buffer.from(JSON.stringify(event)),
      attributes: {
        runId: event.runId,
        eventType: event.eventType,
        producer: event.producer,
        occurredAt: event.occurredAt,
        correlationId: event.correlationId,
      },
    });
  }

  private async finalizeRun(
    run: RunState,
    input: {
      status: FinishedRunStatus;
      stopReason: string;
      source: string;
      datasetRecords: Array<Record<string, unknown>>;
    },
  ): Promise<void> {
    run.executingPhase = 'finalizing';
    run.status = input.status;
    run.finishedAt = nowIso();

    if (run.watchdogTimer) {
      clearInterval(run.watchdogTimer);
      run.watchdogTimer = null;
    }

    const summaryDoc = crawlRunSummaryProjectionV2Schema.parse({
      crawlRunId: run.runId,
      source: input.source,
      status: run.status,
      startedAt: run.startedAt ?? run.queuedAt,
      finishedAt: run.finishedAt,
      stopReason: input.stopReason,
      newJobsCount: run.reconcileNewJobsCount,
      existingJobsCount: run.reconcileExistingJobsCount,
      inactiveMarkedCount: run.inactiveMarkedCount,
      datasetRecordsStored: run.datasetRecordsStored,
      failedRequests: run.failedRequests,
      runSummary: {
        crawlState: {
          mongoDbName: run.request.persistenceTargets.dbName,
          normalizedJobsCollection: NORMALIZED_JOB_ADS_COLLECTION,
          crawlRunSummariesCollection: CRAWL_RUN_SUMMARIES_COLLECTION,
        },
        input: {
          searchSpaceId: run.request.inputRef.searchSpaceId,
          startUrls: run.request.inputRef.searchSpaceSnapshot.startUrls,
          maxItems: run.request.inputRef.searchSpaceSnapshot.maxItems,
          maxConcurrency: run.request.runtimeSnapshot.crawlerMaxConcurrency ?? null,
          maxRequestsPerMinute: run.request.runtimeSnapshot.crawlerMaxRequestsPerMinute ?? null,
        },
        outcome: {
          stopReason: input.stopReason,
          listPhaseCompleted: run.listPhaseCompleted,
          detailPhaseStarted: run.detailPhaseStarted,
          detailPhaseCompleted: run.detailPhaseCompleted,
          listPhaseTruncated: run.listPhaseTruncated,
          inactiveMarkingSkipped: run.inactiveMarkingSkipped,
          inactiveMarkingSkipReason: run.inactiveMarkingSkipReason,
          failedListRequests: run.failedListRequests,
          failedDetailRequests: run.failedDetailRequests,
          failedRequests: run.failedRequests,
        },
        counters: {
          listPagesVisited: run.listPagesVisited,
          detailPagesVisited: run.detailPagesVisited,
          htmlSnapshotsSaved: run.htmlSnapshotsSaved,
          datasetRecordsStored: run.datasetRecordsStored,
          reconcileNewJobsCount: run.reconcileNewJobsCount,
          reconcileExistingJobsCount: run.reconcileExistingJobsCount,
          inactiveMarkedCount: run.inactiveMarkedCount,
          existingSeenUpdatedCount: run.existingSeenUpdatedCount,
        },
        failedRequestUrls: run.failedRequestUrls,
        listPageResults: {
          totalSeenListings: run.reconcileNewJobsCount + run.reconcileExistingJobsCount,
          seedCount: run.request.inputRef.searchSpaceSnapshot.startUrls.length,
        },
      } satisfies RunSummaryShape,
    });

    const crawlSummariesCollection = this.getCrawlRunSummariesCollection(
      run.request.persistenceTargets.dbName,
    );
    await crawlSummariesCollection.updateOne(
      { crawlRunId: run.runId },
      {
        $set: {
          ...summaryDoc,
          updatedAt: nowIso(),
        },
        $setOnInsert: {
          _id: run.runId,
          createdAt: nowIso(),
        },
      },
      { upsert: true },
    );

    const finishedEvent = buildCrawlerRunFinishedEventV2({
      runId: run.runId,
      crawlRunId: run.runId,
      source: input.source,
      searchSpaceId: run.request.inputRef.searchSpaceId,
      status: input.status,
      stopReason: input.stopReason,
      producer: this.deps.env.SERVICE_NAME,
    });

    await this.deps.eventsTopic.publishMessage({
      data: Buffer.from(JSON.stringify(finishedEvent)),
      attributes: {
        runId: finishedEvent.runId,
        eventType: finishedEvent.eventType,
        producer: finishedEvent.producer,
        occurredAt: finishedEvent.occurredAt,
        correlationId: finishedEvent.correlationId,
      },
    });

    run.executingPhase = 'done';
    run.resolveSettled();
    this.deps.logger.info(
      {
        runId: run.runId,
        status: run.status,
        stopReason: input.stopReason,
        newJobsCount: run.reconcileNewJobsCount,
        existingJobsCount: run.reconcileExistingJobsCount,
        inactiveMarkedCount: run.inactiveMarkedCount,
        datasetRecordsStored: run.datasetRecordsStored,
        failedRequests: run.failedRequests,
        dbName: run.request.persistenceTargets.dbName,
      },
      'Crawler run finalized.',
    );
  }
}
