export type RunStatus = 'pending' | 'running' | 'succeeded' | 'completed_with_errors' | 'failed';

export type TimeRange = '24h' | '7d' | '30d';

export type CrawlerRunSummaryDoc = {
  _id?: string;
  crawlRunId: string;
  source: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  stopReason?: string;
  newJobsCount?: number;
  existingJobsCount?: number;
  inactiveMarkedCount?: number;
  datasetRecordsStored?: number;
  failedRequests?: number;
  runSummary?: {
    input?: {
      maxItems?: number;
      maxConcurrency?: number;
      maxRequestsPerMinute?: number;
      startUrls?: string[];
    };
    outcome?: {
      stopReason?: string;
      failedRequests?: number;
      failedListRequests?: number;
      failedDetailRequests?: number;
      partialListScanGuardTriggered?: boolean;
      maxItemsEnqueueGuardTriggered?: boolean;
      maxItemsAbortTriggered?: boolean;
      inactiveMarkingSkipped?: boolean;
      inactiveMarkingSkipReason?: string | null;
    };
    counters?: {
      listPagesVisited?: number;
      paginationNextPagesEnqueued?: number;
      totalJobCardsSeen?: number;
      cardsSkippedMissingHrefOrId?: number;
      listListingsCollectedUnique?: number;
      listListingsDuplicateSourceIds?: number;
      reconcileNewJobsCount?: number;
      reconcileExistingJobsCount?: number;
      activeJobsCountBeforeReconcile?: number;
      inactiveMarkedCount?: number;
      detailsEnqueuedUnique?: number;
      detailPagesVisited?: number;
      htmlSnapshotsSaved?: number;
      datasetRecordsStored?: number;
      detailsValidationSucceeded?: number;
      detailsValidationFailed?: number;
      detailRedirects?: number;
      dynamicRenderedPagesCount?: number;
    };
    listPageResults?: {
      parsedListingResultsCountTotal?: number;
    };
    detailRendering?: {
      renderTypeCounts?: Record<string, number>;
      renderSignalCounts?: Record<string, number>;
      averageDetailRenderWaitMs?: number;
      maxDetailRenderWaitMs?: number;
      averageDetailHtmlByteSize?: number;
      totalDetailHtmlBytes?: number;
    };
    failedRequestUrls?: string[];
    ingestionTrigger?: {
      enabled?: boolean;
      attempted?: boolean;
      ok?: boolean;
      accepted?: boolean;
      deduplicated?: boolean;
      skippedReason?: string | null;
      responseStatus?: number;
    };
    crawlState?: {
      mongoDbName?: string;
      isProdCrawlStateDb?: boolean;
      mongoCollection?: string;
    };
  };
};

export type IngestionRunSummaryDoc = {
  _id?: string | { $oid: string };
  id?: string;
  runId?: string;
  crawlRunId?: string | null;
  startedAt: string;
  completedAt?: string;
  parserVersion?: string;
  extractorModel?: string;
  langsmithCleanerPromptName?: string;
  langsmithExtractorPromptName?: string;
  status?: RunStatus;
  jobsTotal: number;
  jobsProcessed: number;
  jobsSkippedIncomplete: number;
  jobsFailed: number;
  jobsSuccessRate?: number;
  jobsNonSuccessRate?: number;
  totalTokens?: number;
  totalEstimatedCostUsd?: number;
  avgTimeToProcssSeconds?: number;
  p50TimeToProcssSeconds?: number;
  p95TimeToProcssSeconds?: number;
  llmCleanerStats?: LlmStageStats;
  llmExtractorStats?: LlmStageStats;
  llmTotalStats?: LlmStageStats;
  skippedIncompleteJobs?: Array<{
    sourceId: string;
    reason: string;
    listing?: {
      jobTitle?: string;
      companyName?: string;
      adUrl?: string;
      location?: string;
    };
  }>;
  failedJobs?: Array<{
    sourceId: string;
    errorName?: string;
    errorMessage?: string;
    listing?: {
      jobTitle?: string;
      companyName?: string;
      adUrl?: string;
    };
  }>;
};

export type LlmStageStats = {
  promptName?: string;
  totalTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalEstimatedCostUsd?: number;
  avgCallDurationSeconds?: number;
};

export type CrawlerRunSummaryView = {
  id: string;
  source: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number | null;
  stopReason: string | null;
  databaseName: string | null;
  newJobsCount: number;
  existingJobsCount: number;
  inactiveMarkedCount: number;
  datasetRecordsStored: number;
  failedRequests: number;
  listPagesVisited: number;
  detailPagesVisited: number;
  htmlSnapshotsSaved: number;
  parsedListingResultsCountTotal: number;
  failedRequestUrls: string[];
  detailRenderTypeCounts: Record<string, number>;
  detailRenderSignalCounts: Record<string, number>;
  averageDetailRenderWaitMs: number;
  maxDetailRenderWaitMs: number;
  totalDetailHtmlBytes: number;
  input: {
    maxItems: number | null;
    maxConcurrency: number | null;
    maxRequestsPerMinute: number | null;
    startUrls: string[];
  };
  outcome: {
    partialListScanGuardTriggered: boolean;
    maxItemsEnqueueGuardTriggered: boolean;
    maxItemsAbortTriggered: boolean;
    inactiveMarkingSkipped: boolean;
    inactiveMarkingSkipReason: string | null;
    failedListRequests: number;
    failedDetailRequests: number;
  };
  ingestionTrigger: {
    enabled: boolean;
    attempted: boolean;
    ok: boolean | null;
    accepted: boolean | null;
    deduplicated: boolean | null;
    responseStatus: number | null;
    skippedReason: string | null;
  };
};

export type IngestionRunSummaryView = {
  id: string;
  crawlRunId: string | null;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  parserVersion: string | null;
  extractorModel: string | null;
  cleanerPromptName: string | null;
  extractorPromptName: string | null;
  jobsTotal: number;
  jobsProcessed: number;
  jobsSkippedIncomplete: number;
  jobsFailed: number;
  jobsSuccessRate: number;
  jobsNonSuccessRate: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  avgTimeToProcessSeconds: number | null;
  p50TimeToProcessSeconds: number | null;
  p95TimeToProcessSeconds: number | null;
  llmCleanerStats: LlmStageStats;
  llmExtractorStats: LlmStageStats;
  llmTotalStats: LlmStageStats;
  skippedIncompleteJobs: NonSuccessJobView[];
  failedJobs: FailedJobView[];
};

export type NonSuccessJobView = {
  sourceId: string;
  title: string | null;
  company: string | null;
  url: string | null;
  location: string | null;
  reason: string;
};

export type FailedJobView = {
  sourceId: string;
  title: string | null;
  company: string | null;
  url: string | null;
  errorName: string | null;
  errorMessage: string;
};

export type PipelineRunSummaryView = {
  crawlRunId: string;
  crawlerRun: CrawlerRunSummaryView;
  ingestionRun: IngestionRunSummaryView | null;
  endToEndProcessedRate: number | null;
  hasMismatch: boolean;
  mismatchReasons: string[];
};

export type OverviewKpis = {
  crawlerRunsCount: number;
  ingestionRunsCount: number;
  latestCrawlerNewJobs: number;
  latestIngestionJobsTotal: number;
  latestIngestionSuccessRate: number;
  latestIngestionSkippedCount: number;
  latestIngestionFailedCount: number;
  latestTotalTokens: number;
  latestEstimatedCostUsd: number;
  lastSuccessfulPipelineAt: string | null;
};

export type OverviewCharts = {
  crawlerStatusTrend: Array<Record<string, string | number>>;
  ingestionSuccessTrend: Array<Record<string, string | number>>;
  ingestionOutcomeTrend: Array<Record<string, string | number>>;
  crawlerOutcomeTrend: Array<Record<string, string | number>>;
  costAndTokensTrend: Array<Record<string, string | number>>;
};

export type AnomalyView = {
  level: 'warning' | 'error' | 'info';
  title: string;
  description: string;
  href: string;
};

export type OverviewDashboardView = {
  environmentLabel: string;
  databaseName: string;
  generatedAt: string;
  timeRange: TimeRange;
  statuses: {
    latestCrawlerStatus: RunStatus | null;
    latestIngestionStatus: RunStatus | null;
  };
  kpis: OverviewKpis;
  charts: OverviewCharts;
  crawlerRuns: CrawlerRunSummaryView[];
  ingestionRuns: IngestionRunSummaryView[];
  pipelineRuns: PipelineRunSummaryView[];
  anomalies: AnomalyView[];
};
