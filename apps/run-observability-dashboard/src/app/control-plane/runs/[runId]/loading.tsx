import { AppShell } from '@/components/layout/app-shell';
import {
  SkeletonKpiCard,
  SkeletonSectionHeading,
  SkeletonTable,
} from '@/components/state/skeleton-primitives';

const META_CARD_IDS = ['meta-1', 'meta-2', 'meta-3'];

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
          <div className="page-header__summary-item">
            <div className="skeleton skeleton--label" />
            <div className="skeleton skeleton--metric" />
          </div>
          <div className="page-header__summary-item">
            <div className="skeleton skeleton--label" />
            <div className="skeleton skeleton--metric" />
          </div>
          <div className="page-header__summary-item">
            <div className="skeleton skeleton--label" />
            <div className="skeleton skeleton--metric" />
          </div>
          <div className="page-header__summary-item">
            <div className="skeleton skeleton--label" />
            <div className="skeleton skeleton--metric" />
          </div>
        </div>
      </section>

      <section className="kpi-grid">
        <SkeletonKpiCard />
        <SkeletonKpiCard />
        <SkeletonKpiCard />
        <SkeletonKpiCard />
      </section>

      <section className="panel detail-grid detail-grid--meta">
        {META_CARD_IDS.map((cardId) => (
          <article key={cardId} className="detail-card" aria-hidden="true">
            <div className="skeleton skeleton--label" />
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--line-short" />
          </article>
        ))}
      </section>

      <section className="chart-grid">
        <section className="panel" aria-hidden="true">
          <SkeletonSectionHeading />
          <div className="skeleton skeleton--chart" />
        </section>
        <section className="panel">
          <SkeletonSectionHeading />
          <SkeletonTable
            bounded
            columns={['SOURCE ID', 'TITLE', 'STORAGE', 'SIZE', 'ACTIONS']}
            rows={6}
          />
        </section>
      </section>

      <section className="panel">
        <SkeletonSectionHeading />
        <SkeletonTable
          bounded
          columns={['DESTINATION', 'SOURCE ID', 'DOCUMENT ID', 'STORAGE', 'ACTIONS']}
          rows={6}
        />
      </section>
    </AppShell>
  );
}
