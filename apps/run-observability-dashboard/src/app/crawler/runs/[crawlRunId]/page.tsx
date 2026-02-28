import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/metrics/kpi-card';
import { ErrorState } from '@/components/state/error-state';
import {
  formatCompactBytes,
  formatDateTime,
  formatDurationSeconds,
  formatNumber,
} from '@/server/lib/formatting';
import { getCrawlerRunDetail } from '@/server/services/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function CrawlerRunDetailPage({
  params,
}: {
  params: Promise<{ crawlRunId: string }>;
}) {
  const { crawlRunId } = await params;

  try {
    const run = await getCrawlerRunDetail(crawlRunId);
    if (!run) {
      notFound();
    }

    return (
      <AppShell>
        <PageHeader
          eyebrow="Crawler run detail"
          title={`Crawler run ${run.id.slice(0, 8)}`}
          description="List crawl, reconciliation, render diagnostics, and handoff telemetry."
          environmentLabel="DETAIL VIEW"
          databaseName={run.databaseName ?? 'unknown-db'}
          generatedAt={run.finishedAt ?? run.startedAt}
          latestCrawlerStatus={run.status}
        />

        <section className="kpi-grid">
          <KpiCard label="STATUS" value={run.status} />
          <KpiCard label="STARTED" value={formatDateTime(run.startedAt)} />
          <KpiCard label="DURATION" value={formatDurationSeconds(run.durationSeconds)} />
          <KpiCard label="NEW JOBS" value={formatNumber(run.newJobsCount)} />
          <KpiCard label="EXISTING JOBS" value={formatNumber(run.existingJobsCount)} />
          <KpiCard label="INACTIVE MARKED" value={formatNumber(run.inactiveMarkedCount)} />
          <KpiCard label="FAILED REQUESTS" value={formatNumber(run.failedRequests)} />
          <KpiCard label="HTML BYTES" value={formatCompactBytes(run.totalDetailHtmlBytes)} />
        </section>

        <section className="panel detail-grid">
          <div>
            <p className="eyebrow">Input</p>
            <h2>Run configuration</h2>
            <ul className="detail-list">
              <li>MAX ITEMS: {run.input.maxItems ?? 'N/A'}</li>
              <li>MAX CONCURRENCY: {run.input.maxConcurrency ?? 'N/A'}</li>
              <li>MAX REQUESTS/MINUTE: {run.input.maxRequestsPerMinute ?? 'N/A'}</li>
              <li>STOP REASON: {run.stopReason ?? 'N/A'}</li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">Counters</p>
            <h2>Traversal and rendering</h2>
            <ul className="detail-list">
              <li>LIST PAGES VISITED: {formatNumber(run.listPagesVisited)}</li>
              <li>DETAIL PAGES VISITED: {formatNumber(run.detailPagesVisited)}</li>
              <li>HTML SNAPSHOTS SAVED: {formatNumber(run.htmlSnapshotsSaved)}</li>
              <li>PARSED LIST COUNT TOTAL: {formatNumber(run.parsedListingResultsCountTotal)}</li>
              <li>AVG RENDER WAIT: {formatNumber(run.averageDetailRenderWaitMs)} ms</li>
              <li>MAX RENDER WAIT: {formatNumber(run.maxDetailRenderWaitMs)} ms</li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">Trigger</p>
            <h2>Ingestion handoff</h2>
            <ul className="detail-list">
              <li>ENABLED: {String(run.ingestionTrigger.enabled)}</li>
              <li>ATTEMPTED: {String(run.ingestionTrigger.attempted)}</li>
              <li>OK: {String(run.ingestionTrigger.ok)}</li>
              <li>ACCEPTED: {String(run.ingestionTrigger.accepted)}</li>
              <li>DEDUPLICATED: {String(run.ingestionTrigger.deduplicated)}</li>
            </ul>
          </div>
        </section>

        <section className="panel">
          <div className="section-heading">
            <p className="eyebrow">Diagnostics</p>
            <h2>Failed request URLs</h2>
          </div>
          {run.failedRequestUrls.length === 0 ? (
            <p className="empty-copy">No failed request URLs recorded for this run.</p>
          ) : (
            <ul className="url-list">
              {run.failedRequestUrls.map((url) => (
                <li key={url}>{url}</li>
              ))}
            </ul>
          )}
        </section>
      </AppShell>
    );
  } catch (error) {
    return (
      <AppShell>
        <ErrorState
          title="Crawler detail could not be loaded"
          message={error instanceof Error ? error.message : 'Unknown crawler detail error.'}
        />
      </AppShell>
    );
  }
}
