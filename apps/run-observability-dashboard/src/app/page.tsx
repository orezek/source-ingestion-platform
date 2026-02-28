import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/metrics/kpi-card';
import { AlertPanel } from '@/components/state/alert-panel';
import { EmptyState } from '@/components/state/empty-state';
import { ErrorState } from '@/components/state/error-state';
import { CrawlerRunsTable } from '@/components/tables/crawler-runs-table';
import { IngestionRunsTable } from '@/components/tables/ingestion-runs-table';
import { OverviewChartsPanel } from '@/components/charts/overview-charts';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '@/server/lib/formatting';
import { parseTimeRange } from '@/server/lib/time-range';
import { getOverviewDashboardData } from '@/server/services/dashboard-data';

export const dynamic = 'force-dynamic';

type HomePageProps = {
  searchParams?: Promise<{ range?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const timeRange = parseTimeRange(resolvedSearchParams.range);

  try {
    const dashboard = await getOverviewDashboardData(timeRange);

    return (
      <AppShell>
        <PageHeader
          eyebrow="Run observability"
          title="Operational dashboard"
          description="Crawler and ingestion run summaries, linked pipeline visibility, and fast anomaly detection."
          environmentLabel={dashboard.environmentLabel}
          databaseName={dashboard.databaseName}
          generatedAt={dashboard.generatedAt}
          latestCrawlerStatus={dashboard.statuses.latestCrawlerStatus}
          latestIngestionStatus={dashboard.statuses.latestIngestionStatus}
        />

        <section className="panel filter-panel">
          <form className="filters" action="/" method="get">
            <label>
              <span>TIME RANGE</span>
              <select defaultValue={dashboard.timeRange} name="range">
                <option value="24h">24h</option>
                <option value="7d">7d</option>
                <option value="30d">30d</option>
              </select>
            </label>
            <button type="submit">Apply</button>
          </form>
        </section>

        <section className="kpi-grid">
          <KpiCard
            label="CRAWLER RUNS"
            value={formatNumber(dashboard.kpis.crawlerRunsCount)}
            hint={`${dashboard.timeRange} window`}
          />
          <KpiCard
            label="INGESTION RUNS"
            value={formatNumber(dashboard.kpis.ingestionRunsCount)}
            hint={`${dashboard.timeRange} window`}
          />
          <KpiCard
            label="LATEST NEW JOBS"
            value={formatNumber(dashboard.kpis.latestCrawlerNewJobs)}
          />
          <KpiCard
            label="LATEST JOBS TOTAL"
            value={formatNumber(dashboard.kpis.latestIngestionJobsTotal)}
          />
          <KpiCard
            label="SUCCESS RATE"
            value={formatPercent(dashboard.kpis.latestIngestionSuccessRate)}
          />
          <KpiCard
            label="SKIPPED"
            value={formatNumber(dashboard.kpis.latestIngestionSkippedCount)}
          />
          <KpiCard label="FAILED" value={formatNumber(dashboard.kpis.latestIngestionFailedCount)} />
          <KpiCard label="TOTAL TOKENS" value={formatNumber(dashboard.kpis.latestTotalTokens)} />
          <KpiCard
            label="EST. COST"
            value={formatCurrency(dashboard.kpis.latestEstimatedCostUsd)}
          />
          <KpiCard
            label="LAST SUCCESSFUL PIPELINE"
            value={formatDateTime(dashboard.kpis.lastSuccessfulPipelineAt)}
          />
        </section>

        <OverviewChartsPanel charts={dashboard.charts} />
        <AlertPanel anomalies={dashboard.anomalies} />

        <section className="panel">
          <div className="section-heading">
            <p className="eyebrow">Crawler</p>
            <h2>Recent crawler runs</h2>
          </div>
          {dashboard.crawlerRuns.length === 0 ? (
            <EmptyState
              title="No crawler runs"
              message="No crawler runs were found in the selected time range."
            />
          ) : (
            <CrawlerRunsTable runs={dashboard.crawlerRuns} />
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <p className="eyebrow">Ingestion</p>
            <h2>Recent ingestion runs</h2>
          </div>
          {dashboard.ingestionRuns.length === 0 ? (
            <EmptyState
              title="No ingestion runs"
              message="No ingestion runs were found in the selected time range."
            />
          ) : (
            <IngestionRunsTable runs={dashboard.ingestionRuns} />
          )}
        </section>
      </AppShell>
    );
  } catch (error) {
    return (
      <AppShell>
        <ErrorState
          title="Dashboard data could not be loaded"
          message={error instanceof Error ? error.message : 'Unknown dashboard error.'}
        />
      </AppShell>
    );
  }
}
