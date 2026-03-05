import type {
  CrawlerRunSummaryDoc,
  CrawlerRunSummaryView,
  FailedJobView,
  IngestionRunSummaryDoc,
  IngestionRunSummaryView,
  LlmStageStats,
  NonSuccessJobView,
  PipelineRunSummaryView,
  RunStatus,
} from '@/server/types';

type SkippedIncompleteJobDoc = NonNullable<IngestionRunSummaryDoc['skippedIncompleteJobs']>[number];
type FailedJobDoc = NonNullable<IngestionRunSummaryDoc['failedJobs']>[number];

function deriveStatus(value: string | undefined): RunStatus {
  if (
    value === 'queued' ||
    value === 'pending' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'completed_with_errors' ||
    value === 'failed' ||
    value === 'stopped'
  ) {
    return value;
  }

  return 'running';
}

function deriveDurationSeconds(startedAt: string, finishedAt?: string | null): number | null {
  if (!finishedAt) {
    return null;
  }

  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }

  return Math.max(0, (end - start) / 1000);
}

function normalizeLlmStats(stats: LlmStageStats | undefined): LlmStageStats {
  return {
    promptName: stats?.promptName ?? null ?? undefined,
    totalTokens: stats?.totalTokens ?? 0,
    totalInputTokens: stats?.totalInputTokens ?? 0,
    totalOutputTokens: stats?.totalOutputTokens ?? 0,
    totalEstimatedCostUsd: stats?.totalEstimatedCostUsd ?? 0,
    avgCallDurationSeconds: stats?.avgCallDurationSeconds ?? 0,
  };
}

function mapSkippedJob(job: SkippedIncompleteJobDoc): NonSuccessJobView {
  return {
    sourceId: job.sourceId,
    title: job.listing?.jobTitle ?? null,
    company: job.listing?.companyName ?? null,
    url: job.listing?.adUrl ?? null,
    location: job.listing?.location ?? null,
    reason: job.reason,
  };
}

function mapFailedJob(job: FailedJobDoc): FailedJobView {
  return {
    sourceId: job.sourceId,
    title: job.listing?.jobTitle ?? null,
    company: job.listing?.companyName ?? null,
    url: job.listing?.adUrl ?? null,
    errorName: job.errorName ?? null,
    errorMessage: job.errorMessage ?? 'Unknown ingestion error',
  };
}

export function mapCrawlerRunSummary(doc: CrawlerRunSummaryDoc): CrawlerRunSummaryView {
  return {
    id: doc.crawlRunId,
    source: doc.source,
    status: deriveStatus(doc.status),
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt ?? null,
    durationSeconds: deriveDurationSeconds(doc.startedAt, doc.finishedAt ?? null),
    stopReason: doc.stopReason ?? doc.runSummary?.outcome?.stopReason ?? null,
    databaseName: doc.runSummary?.crawlState?.mongoDbName ?? null,
    newJobsCount: doc.newJobsCount ?? doc.runSummary?.counters?.reconcileNewJobsCount ?? 0,
    existingJobsCount:
      doc.existingJobsCount ?? doc.runSummary?.counters?.reconcileExistingJobsCount ?? 0,
    inactiveMarkedCount:
      doc.inactiveMarkedCount ?? doc.runSummary?.counters?.inactiveMarkedCount ?? 0,
    datasetRecordsStored:
      doc.datasetRecordsStored ?? doc.runSummary?.counters?.datasetRecordsStored ?? 0,
    failedRequests: doc.failedRequests ?? doc.runSummary?.outcome?.failedRequests ?? 0,
    listPagesVisited: doc.runSummary?.counters?.listPagesVisited ?? 0,
    detailPagesVisited: doc.runSummary?.counters?.detailPagesVisited ?? 0,
    htmlSnapshotsSaved: doc.runSummary?.counters?.htmlSnapshotsSaved ?? 0,
    parsedListingResultsCountTotal:
      doc.runSummary?.listPageResults?.parsedListingResultsCountTotal ?? 0,
    failedRequestUrls: doc.runSummary?.failedRequestUrls ?? [],
    detailRenderTypeCounts: doc.runSummary?.detailRendering?.renderTypeCounts ?? {},
    detailRenderSignalCounts: doc.runSummary?.detailRendering?.renderSignalCounts ?? {},
    averageDetailRenderWaitMs: doc.runSummary?.detailRendering?.averageDetailRenderWaitMs ?? 0,
    maxDetailRenderWaitMs: doc.runSummary?.detailRendering?.maxDetailRenderWaitMs ?? 0,
    totalDetailHtmlBytes: doc.runSummary?.detailRendering?.totalDetailHtmlBytes ?? 0,
    input: {
      maxItems: doc.runSummary?.input?.maxItems ?? null,
      maxConcurrency: doc.runSummary?.input?.maxConcurrency ?? null,
      maxRequestsPerMinute: doc.runSummary?.input?.maxRequestsPerMinute ?? null,
      startUrls: doc.runSummary?.input?.startUrls ?? [],
    },
    outcome: {
      partialListScanGuardTriggered:
        doc.runSummary?.outcome?.partialListScanGuardTriggered ?? false,
      maxItemsEnqueueGuardTriggered:
        doc.runSummary?.outcome?.maxItemsEnqueueGuardTriggered ?? false,
      maxItemsAbortTriggered: doc.runSummary?.outcome?.maxItemsAbortTriggered ?? false,
      inactiveMarkingSkipped: doc.runSummary?.outcome?.inactiveMarkingSkipped ?? false,
      inactiveMarkingSkipReason: doc.runSummary?.outcome?.inactiveMarkingSkipReason ?? null,
      failedListRequests: doc.runSummary?.outcome?.failedListRequests ?? 0,
      failedDetailRequests: doc.runSummary?.outcome?.failedDetailRequests ?? 0,
    },
    ingestionTrigger: {
      enabled: doc.runSummary?.ingestionTrigger?.enabled ?? false,
      attempted: doc.runSummary?.ingestionTrigger?.attempted ?? false,
      ok: doc.runSummary?.ingestionTrigger?.ok ?? null,
      accepted: doc.runSummary?.ingestionTrigger?.accepted ?? null,
      deduplicated: doc.runSummary?.ingestionTrigger?.deduplicated ?? null,
      responseStatus: doc.runSummary?.ingestionTrigger?.responseStatus ?? null,
      skippedReason: doc.runSummary?.ingestionTrigger?.skippedReason ?? null,
    },
  };
}

export function mapIngestionRunSummary(doc: IngestionRunSummaryDoc): IngestionRunSummaryView {
  const runId = doc.runId ?? doc.id ?? 'unknown-run';
  const status = deriveStatus(
    doc.status ?? (doc.jobsFailed > 0 ? 'completed_with_errors' : 'succeeded'),
  );
  const llmCleanerStats = normalizeLlmStats(doc.llmCleanerStats);
  const llmExtractorStats = normalizeLlmStats(doc.llmExtractorStats);
  const llmTotalStats = normalizeLlmStats(
    doc.llmTotalStats ?? {
      totalTokens: doc.totalTokens,
      totalEstimatedCostUsd: doc.totalEstimatedCostUsd,
    },
  );

  return {
    id: runId,
    crawlRunId: doc.crawlRunId ?? null,
    status,
    startedAt: doc.startedAt,
    completedAt: doc.completedAt ?? null,
    durationSeconds: deriveDurationSeconds(doc.startedAt, doc.completedAt ?? null),
    parserVersion: doc.parserVersion ?? null,
    extractorModel: doc.extractorModel ?? null,
    cleanerPromptName: doc.langsmithCleanerPromptName ?? llmCleanerStats.promptName ?? null,
    extractorPromptName: doc.langsmithExtractorPromptName ?? llmExtractorStats.promptName ?? null,
    jobsTotal: doc.jobsTotal,
    jobsProcessed: doc.jobsProcessed,
    jobsSkippedIncomplete: doc.jobsSkippedIncomplete,
    jobsFailed: doc.jobsFailed,
    jobsSuccessRate:
      doc.jobsSuccessRate ?? (doc.jobsTotal > 0 ? doc.jobsProcessed / doc.jobsTotal : 0),
    jobsNonSuccessRate:
      doc.jobsNonSuccessRate ??
      (doc.jobsTotal > 0 ? (doc.jobsSkippedIncomplete + doc.jobsFailed) / doc.jobsTotal : 0),
    totalTokens: doc.totalTokens ?? llmTotalStats.totalTokens ?? 0,
    totalEstimatedCostUsd: doc.totalEstimatedCostUsd ?? llmTotalStats.totalEstimatedCostUsd ?? 0,
    avgTimeToProcessSeconds: doc.avgTimeToProcssSeconds ?? null,
    p50TimeToProcessSeconds: doc.p50TimeToProcssSeconds ?? null,
    p95TimeToProcessSeconds: doc.p95TimeToProcssSeconds ?? null,
    llmCleanerStats,
    llmExtractorStats,
    llmTotalStats,
    skippedIncompleteJobs: (doc.skippedIncompleteJobs ?? []).map(mapSkippedJob),
    failedJobs: (doc.failedJobs ?? []).map(mapFailedJob),
  };
}

export function mapPipelineRunSummary(
  crawlerRun: CrawlerRunSummaryView,
  ingestionRun: IngestionRunSummaryView | null,
): PipelineRunSummaryView {
  const mismatchReasons: string[] = [];

  if (!ingestionRun && crawlerRun.newJobsCount > 0) {
    mismatchReasons.push('Crawler discovered new jobs but no linked ingestion run was found.');
  }

  if (ingestionRun && crawlerRun.newJobsCount > ingestionRun.jobsTotal) {
    mismatchReasons.push(
      'Crawler discovered more new jobs than the ingestion run reports as total.',
    );
  }

  if (
    ingestionRun &&
    ingestionRun.jobsProcessed < crawlerRun.newJobsCount &&
    ingestionRun.jobsTotal > 0
  ) {
    mismatchReasons.push(
      'Ingestion processed fewer jobs than crawler new jobs; skips or failures likely occurred.',
    );
  }

  return {
    crawlRunId: crawlerRun.id,
    crawlerRun,
    ingestionRun,
    endToEndProcessedRate:
      ingestionRun && crawlerRun.newJobsCount > 0
        ? ingestionRun.jobsProcessed / crawlerRun.newJobsCount
        : null,
    hasMismatch: mismatchReasons.length > 0,
    mismatchReasons,
  };
}
