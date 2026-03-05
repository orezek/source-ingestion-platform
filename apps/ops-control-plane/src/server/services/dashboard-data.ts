import { env } from '@/server/env';
import { createDashboardRepository } from '@/server/repositories/dashboard-repository';
import {
  mapCrawlerRunSummary,
  mapIngestionRunSummary,
  mapPipelineRunSummary,
} from '@/server/mappers/run-summary-mappers';
import type {
  AnomalyView,
  OverviewCharts,
  OverviewDashboardView,
  OverviewKpis,
  PipelineRunSummaryView,
  TimeRange,
} from '@/server/types';

function buildOverviewKpis(
  crawlerRuns: OverviewDashboardView['crawlerRuns'],
  ingestionRuns: OverviewDashboardView['ingestionRuns'],
  pipelineRuns: PipelineRunSummaryView[],
): OverviewKpis {
  const latestCrawler = crawlerRuns[0] ?? null;
  const latestIngestion = ingestionRuns[0] ?? null;
  const latestSuccessfulPipeline = pipelineRuns.find(
    (pipelineRun) =>
      pipelineRun.crawlerRun.status === 'succeeded' &&
      pipelineRun.ingestionRun?.status === 'succeeded',
  );

  return {
    crawlerRunsCount: crawlerRuns.length,
    ingestionRunsCount: ingestionRuns.length,
    latestCrawlerNewJobs: latestCrawler?.newJobsCount ?? 0,
    latestIngestionJobsTotal: latestIngestion?.jobsTotal ?? 0,
    latestIngestionSuccessRate: latestIngestion?.jobsSuccessRate ?? 0,
    latestIngestionSkippedCount: latestIngestion?.jobsSkippedIncomplete ?? 0,
    latestIngestionFailedCount: latestIngestion?.jobsFailed ?? 0,
    latestTotalTokens: latestIngestion?.totalTokens ?? 0,
    latestEstimatedCostUsd: latestIngestion?.totalEstimatedCostUsd ?? 0,
    lastSuccessfulPipelineAt: latestSuccessfulPipeline?.ingestionRun?.completedAt ?? null,
  };
}

function buildOverviewCharts(
  crawlerRuns: OverviewDashboardView['crawlerRuns'],
  ingestionRuns: OverviewDashboardView['ingestionRuns'],
): OverviewCharts {
  return {
    crawlerStatusTrend: crawlerRuns
      .slice(0, 12)
      .reverse()
      .map((run) => ({
        label: run.id.slice(0, 8),
        succeeded: run.status === 'succeeded' ? 1 : 0,
        completedWithErrors: run.status === 'completed_with_errors' ? 1 : 0,
        failed: run.status === 'failed' ? 1 : 0,
      })),
    ingestionSuccessTrend: ingestionRuns
      .slice(0, 12)
      .reverse()
      .map((run) => ({
        label: run.id.slice(0, 8),
        successRate: Number((run.jobsSuccessRate * 100).toFixed(2)),
      })),
    ingestionOutcomeTrend: ingestionRuns
      .slice(0, 12)
      .reverse()
      .map((run) => ({
        label: run.id.slice(0, 8),
        processed: run.jobsProcessed,
        skipped: run.jobsSkippedIncomplete,
        failed: run.jobsFailed,
      })),
    crawlerOutcomeTrend: crawlerRuns
      .slice(0, 12)
      .reverse()
      .map((run) => ({
        label: run.id.slice(0, 8),
        newJobs: run.newJobsCount,
        existingJobs: run.existingJobsCount,
        inactiveMarked: run.inactiveMarkedCount,
      })),
    costAndTokensTrend: ingestionRuns
      .slice(0, 12)
      .reverse()
      .map((run) => ({
        label: run.id.slice(0, 8),
        costUsd: Number(run.totalEstimatedCostUsd.toFixed(4)),
        totalTokens: run.totalTokens,
      })),
  };
}

function buildAnomalies(
  crawlerRuns: OverviewDashboardView['crawlerRuns'],
  ingestionRuns: OverviewDashboardView['ingestionRuns'],
  pipelineRuns: PipelineRunSummaryView[],
): AnomalyView[] {
  const anomalies: AnomalyView[] = [];

  for (const run of crawlerRuns.slice(0, 5)) {
    if (run.status === 'failed' || run.status === 'completed_with_errors') {
      anomalies.push({
        level: run.status === 'failed' ? 'error' : 'warning',
        title: `Crawler run ${run.id.slice(0, 8)} needs review`,
        description: `Status=${run.status}, failedRequests=${run.failedRequests}, stopReason=${run.stopReason ?? 'n/a'}.`,
        href: `/crawler/runs/${run.id}`,
      });
    }
  }

  for (const run of ingestionRuns.slice(0, 5)) {
    if (run.jobsSuccessRate < 0.9 || run.jobsSkippedIncomplete > 0 || run.jobsFailed > 0) {
      anomalies.push({
        level: run.jobsFailed > 0 ? 'error' : 'warning',
        title: `Ingestion run ${run.id.slice(0, 8)} has non-success jobs`,
        description: `Processed=${run.jobsProcessed}, skipped=${run.jobsSkippedIncomplete}, failed=${run.jobsFailed}.`,
        href: `/ingestion/runs/${run.id}`,
      });
    }
  }

  for (const run of pipelineRuns.slice(0, 5)) {
    if (run.hasMismatch) {
      anomalies.push({
        level: 'info',
        title: `Pipeline run ${run.crawlRunId.slice(0, 8)} has a handoff mismatch`,
        description: run.mismatchReasons[0] ?? 'Pipeline linkage anomaly detected.',
        href: `/pipeline/${run.crawlRunId}`,
      });
    }
  }

  return anomalies.slice(0, 8);
}

export async function getOverviewDashboardData(
  timeRange: TimeRange,
): Promise<OverviewDashboardView> {
  const repository = createDashboardRepository();
  const [crawlerDocs, ingestionDocs] = await Promise.all([
    repository.listCrawlerRuns(timeRange),
    repository.listIngestionRuns(timeRange),
  ]);

  const crawlerRuns = crawlerDocs.map(mapCrawlerRunSummary);
  const ingestionRuns = ingestionDocs.map(mapIngestionRunSummary);

  const ingestionByCrawlRunId = new Map(
    ingestionRuns.filter((run) => run.crawlRunId).map((run) => [run.crawlRunId as string, run]),
  );

  const pipelineRuns = crawlerRuns
    .filter((run) => run.newJobsCount > 0 || ingestionByCrawlRunId.has(run.id))
    .map((run) => mapPipelineRunSummary(run, ingestionByCrawlRunId.get(run.id) ?? null));

  return {
    environmentLabel: env.DASHBOARD_DATA_MODE === 'mongo' ? 'LIVE MONGO' : 'FIXTURE MODE',
    databaseName: env.MONGODB_DB_NAME,
    generatedAt: new Date().toISOString(),
    timeRange,
    statuses: {
      latestCrawlerStatus: crawlerRuns[0]?.status ?? null,
      latestIngestionStatus: ingestionRuns[0]?.status ?? null,
    },
    kpis: buildOverviewKpis(crawlerRuns, ingestionRuns, pipelineRuns),
    charts: buildOverviewCharts(crawlerRuns, ingestionRuns),
    crawlerRuns,
    ingestionRuns,
    pipelineRuns,
    anomalies: buildAnomalies(crawlerRuns, ingestionRuns, pipelineRuns),
  };
}

export async function getCrawlerRunDetail(crawlRunId: string) {
  const repository = createDashboardRepository();
  const crawlerDoc = await repository.getCrawlerRun(crawlRunId);
  if (!crawlerDoc) {
    return null;
  }

  return mapCrawlerRunSummary(crawlerDoc);
}

export async function getIngestionRunDetail(runId: string) {
  const repository = createDashboardRepository();
  const ingestionDoc = await repository.getIngestionRun(runId);
  if (!ingestionDoc) {
    return null;
  }

  return mapIngestionRunSummary(ingestionDoc);
}

export async function getPipelineRunDetail(crawlRunId: string) {
  const repository = createDashboardRepository();
  const [crawlerDoc, ingestionDoc] = await Promise.all([
    repository.getCrawlerRun(crawlRunId),
    repository.getIngestionRunByCrawlRunId(crawlRunId),
  ]);

  if (!crawlerDoc) {
    return null;
  }

  return mapPipelineRunSummary(
    mapCrawlerRunSummary(crawlerDoc),
    ingestionDoc ? mapIngestionRunSummary(ingestionDoc) : null,
  );
}
