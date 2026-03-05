import { AppShell } from '@/components/layout/app-shell';
import {
  SkeletonChartPanel,
  SkeletonKpiCard,
  SkeletonSectionHeading,
  SkeletonTable,
} from '@/components/state/skeleton-primitives';

const KPI_CARD_IDS = [
  'kpi-1',
  'kpi-2',
  'kpi-3',
  'kpi-4',
  'kpi-5',
  'kpi-6',
  'kpi-7',
  'kpi-8',
  'kpi-9',
  'kpi-10',
];

const HEADER_SUMMARY_IDS = ['summary-1', 'summary-2', 'summary-3', 'summary-4'];

export default function Loading() {
  return (
    <AppShell>
      <section className="page-header" aria-hidden="true">
        <div className="page-header__top">
          <div>
            <div className="skeleton skeleton--eyebrow" />
            <div className="skeleton skeleton--title" />
            <div className="skeleton skeleton--line skeleton--line-wide" />
          </div>
          <div className="page-header__rail">
            <div className="skeleton skeleton--meta-block" />
            <div className="skeleton skeleton--meta-block" />
          </div>
        </div>
        <div className="page-header__summary">
          {HEADER_SUMMARY_IDS.map((itemId) => (
            <div key={itemId} className="page-header__summary-item">
              <div className="skeleton skeleton--label" />
              <div className="skeleton skeleton--metric" />
              <div className="skeleton skeleton--line skeleton--line-short" />
            </div>
          ))}
        </div>
      </section>

      <section className="panel filter-panel" aria-hidden="true">
        <div className="filters">
          <label>
            <span>TIME RANGE</span>
            <div className="skeleton skeleton--input" />
          </label>
          <div className="skeleton skeleton--button" />
        </div>
      </section>

      <section className="kpi-grid">
        {KPI_CARD_IDS.map((cardId) => (
          <SkeletonKpiCard key={cardId} />
        ))}
      </section>

      <section className="chart-grid chart-grid--overview">
        <SkeletonChartPanel />
        <SkeletonChartPanel />
        <SkeletonChartPanel />
        <SkeletonChartPanel />
        <div className="chart-grid__item--full">
          <SkeletonChartPanel />
        </div>
      </section>

      <section className="panel">
        <SkeletonSectionHeading />
        <SkeletonTable columns={['RUN ID', 'STATUS', 'NEW JOBS', 'STARTED', 'DETAILS']} rows={6} />
      </section>

      <section className="panel">
        <SkeletonSectionHeading />
        <SkeletonTable columns={['RUN ID', 'STATUS', 'PROCESSED', 'STARTED', 'DETAILS']} rows={6} />
      </section>
    </AppShell>
  );
}
