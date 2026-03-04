import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/metrics/kpi-card';
import { ErrorState } from '@/components/state/error-state';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { formatDateTime, formatNumber, formatPercent } from '@/server/lib/formatting';
import { getPipelineRunDetail } from '@/server/services/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function PipelineRunDetailPage({
  params,
}: {
  params: Promise<{ crawlRunId: string }>;
}) {
  const { crawlRunId } = await params;

  try {
    const pipeline = await getPipelineRunDetail(crawlRunId);
    if (!pipeline) {
      notFound();
    }

    return (
      <AppShell>
        <PageHeader
          eyebrow="Pipeline run detail"
          title={`Pipeline ${pipeline.crawlRunId.slice(0, 8)}`}
          description="Crawler-to-ingestion linkage, derived conversion, and mismatch diagnostics."
          environmentLabel="PIPELINE VIEW"
          databaseName={pipeline.crawlerRun.databaseName ?? 'unknown-db'}
          generatedAt={
            pipeline.ingestionRun?.completedAt ??
            pipeline.crawlerRun.finishedAt ??
            pipeline.crawlerRun.startedAt
          }
          latestCrawlerStatus={pipeline.crawlerRun.status}
          latestIngestionStatus={pipeline.ingestionRun?.status ?? null}
          backHref="/"
          backLabel="Back to overview"
          showControlPlaneLink={false}
          summaryItems={[
            { label: 'Crawler', value: pipeline.crawlerRun.status.replaceAll('_', ' ') },
            {
              label: 'Ingestion',
              value: pipeline.ingestionRun?.status?.replaceAll('_', ' ') ?? 'missing',
            },
            { label: 'New jobs', value: formatNumber(pipeline.crawlerRun.newJobsCount) },
            {
              label: 'E2E processed',
              value:
                pipeline.endToEndProcessedRate !== null
                  ? formatPercent(pipeline.endToEndProcessedRate)
                  : 'N/A',
            },
          ]}
        />

        <section className="kpi-grid">
          <KpiCard
            label="INGESTION TOTAL"
            value={formatNumber(pipeline.ingestionRun?.jobsTotal ?? 0)}
          />
          <KpiCard
            label="PROCESSED"
            value={formatNumber(pipeline.ingestionRun?.jobsProcessed ?? 0)}
          />
          <KpiCard
            label="SKIPPED"
            value={formatNumber(pipeline.ingestionRun?.jobsSkippedIncomplete ?? 0)}
          />
          <KpiCard label="FAILED" value={formatNumber(pipeline.ingestionRun?.jobsFailed ?? 0)} />
        </section>

        <section className="panel detail-grid">
          <div>
            <SectionHeading eyebrow="Crawler" title="Run snapshot" />
            <ul className="detail-list">
              <li>RUN ID: {pipeline.crawlerRun.id}</li>
              <li>STARTED: {formatDateTime(pipeline.crawlerRun.startedAt)}</li>
              <li>FINISHED: {formatDateTime(pipeline.crawlerRun.finishedAt)}</li>
            </ul>
          </div>
          <div>
            <SectionHeading eyebrow="Ingestion" title="Linked run snapshot" />
            <ul className="detail-list">
              <li>RUN ID: {pipeline.ingestionRun?.id ?? 'N/A'}</li>
              <li>STARTED: {formatDateTime(pipeline.ingestionRun?.startedAt ?? null)}</li>
              <li>COMPLETED: {formatDateTime(pipeline.ingestionRun?.completedAt ?? null)}</li>
            </ul>
          </div>
          <div>
            <SectionHeading eyebrow="Mismatch" title="Derived diagnostics" />
            {pipeline.hasMismatch ? (
              <ul className="detail-list">
                {pipeline.mismatchReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="empty-copy">No mismatch detected for this linked pipeline run.</p>
            )}
          </div>
        </section>
      </AppShell>
    );
  } catch (error) {
    return (
      <AppShell>
        <ErrorState
          title="Pipeline detail could not be loaded"
          message={error instanceof Error ? error.message : 'Unknown pipeline detail error.'}
        />
      </AppShell>
    );
  }
}
