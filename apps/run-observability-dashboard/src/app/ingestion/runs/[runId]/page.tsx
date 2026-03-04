import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/metrics/kpi-card';
import { ErrorState } from '@/components/state/error-state';
import { NonSuccessJobsTable } from '@/components/tables/non-success-jobs-table';
import { SectionHeading } from '@/components/control-plane/section-heading';
import {
  formatCurrency,
  formatDurationSeconds,
  formatNumber,
  formatPercent,
} from '@/server/lib/formatting';
import { getIngestionRunDetail } from '@/server/services/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function IngestionRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  try {
    const run = await getIngestionRunDetail(runId);
    if (!run) {
      notFound();
    }

    return (
      <AppShell>
        <PageHeader
          eyebrow="Ingestion run detail"
          title={`Ingestion run ${run.id.slice(0, 8)}`}
          description="Structured extraction quality, LLM usage, and skipped/failed job audit trails."
          environmentLabel="DETAIL VIEW"
          databaseName={run.crawlRunId ?? 'unlinked'}
          generatedAt={run.completedAt ?? run.startedAt}
          latestIngestionStatus={run.status}
          backHref="/"
          backLabel="Back to overview"
          showControlPlaneLink={false}
          summaryItems={[
            { label: 'Status', value: run.status.replaceAll('_', ' ') },
            { label: 'Processed', value: formatNumber(run.jobsProcessed) },
            { label: 'Success rate', value: formatPercent(run.jobsSuccessRate) },
            { label: 'Total tokens', value: formatNumber(run.totalTokens) },
          ]}
        />

        <section className="kpi-grid">
          <KpiCard label="JOBS TOTAL" value={formatNumber(run.jobsTotal)} />
          <KpiCard label="SKIPPED" value={formatNumber(run.jobsSkippedIncomplete)} />
          <KpiCard label="FAILED" value={formatNumber(run.jobsFailed)} />
          <KpiCard label="EST. COST" value={formatCurrency(run.totalEstimatedCostUsd)} />
          <KpiCard
            label="AVG PROCESS TIME"
            value={
              run.avgTimeToProcessSeconds
                ? formatDurationSeconds(run.avgTimeToProcessSeconds)
                : 'N/A'
            }
          />
          <KpiCard
            label="P95 PROCESS TIME"
            value={
              run.p95TimeToProcessSeconds
                ? formatDurationSeconds(run.p95TimeToProcessSeconds)
                : 'N/A'
            }
          />
        </section>

        <section className="panel detail-grid">
          <div>
            <SectionHeading eyebrow="Prompting" title="Model and parser" />
            <ul className="detail-list">
              <li>PARSER VERSION: {run.parserVersion ?? 'N/A'}</li>
              <li>EXTRACTOR MODEL: {run.extractorModel ?? 'N/A'}</li>
              <li>CLEANER PROMPT: {run.cleanerPromptName ?? 'N/A'}</li>
              <li>EXTRACTOR PROMPT: {run.extractorPromptName ?? 'N/A'}</li>
            </ul>
          </div>
          <div>
            <SectionHeading eyebrow="Cleaner LLM" title="Stage metrics" />
            <ul className="detail-list">
              <li>TOTAL TOKENS: {formatNumber(run.llmCleanerStats.totalTokens ?? 0)}</li>
              <li>INPUT TOKENS: {formatNumber(run.llmCleanerStats.totalInputTokens ?? 0)}</li>
              <li>OUTPUT TOKENS: {formatNumber(run.llmCleanerStats.totalOutputTokens ?? 0)}</li>
              <li>EST. COST: {formatCurrency(run.llmCleanerStats.totalEstimatedCostUsd ?? 0)}</li>
            </ul>
          </div>
          <div>
            <SectionHeading eyebrow="Extractor LLM" title="Stage metrics" />
            <ul className="detail-list">
              <li>TOTAL TOKENS: {formatNumber(run.llmExtractorStats.totalTokens ?? 0)}</li>
              <li>INPUT TOKENS: {formatNumber(run.llmExtractorStats.totalInputTokens ?? 0)}</li>
              <li>OUTPUT TOKENS: {formatNumber(run.llmExtractorStats.totalOutputTokens ?? 0)}</li>
              <li>EST. COST: {formatCurrency(run.llmExtractorStats.totalEstimatedCostUsd ?? 0)}</li>
            </ul>
          </div>
        </section>

        <NonSuccessJobsTable title="Skipped incomplete jobs" rows={run.skippedIncompleteJobs} />
        <NonSuccessJobsTable title="Failed jobs" rows={run.failedJobs} />
      </AppShell>
    );
  } catch (error) {
    return (
      <AppShell>
        <ErrorState
          title="Ingestion detail could not be loaded"
          message={error instanceof Error ? error.message : 'Unknown ingestion detail error.'}
        />
      </AppShell>
    );
  }
}
