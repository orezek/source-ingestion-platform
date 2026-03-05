import { KpiCard } from '@/components/metrics/kpi-card';
import { formatNumber } from '@/server/lib/formatting';

export function ControlPlaneSummaryGrid({
  searchSpaces,
  runtimeProfiles,
  structuredOutputs,
  pipelines,
  activeRuns,
}: {
  searchSpaces: number;
  runtimeProfiles: number;
  structuredOutputs: number;
  pipelines: number;
  activeRuns: number;
}) {
  return (
    <section className="kpi-grid control-plane-summary-grid">
      <KpiCard label="ACTIVE RUNS" value={formatNumber(activeRuns)} hint="Queued or running" />
      <KpiCard label="PIPELINES" value={formatNumber(pipelines)} hint="Runnable manifest sources" />
      <KpiCard
        label="SOURCE DEFINITIONS"
        value={formatNumber(searchSpaces)}
        hint="List-page crawl targets"
      />
      <KpiCard
        label="RUNTIME PROFILES"
        value={formatNumber(runtimeProfiles)}
        hint="Crawler and ingestion throughput"
      />
      <KpiCard
        label="OUTPUTS"
        value={formatNumber(structuredOutputs)}
        hint="Downloadable JSON and MongoDB"
      />
    </section>
  );
}
