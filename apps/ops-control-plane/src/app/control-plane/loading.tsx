import { AppShell } from '@/components/layout/app-shell';
import {
  SkeletonKpiCard,
  SkeletonSectionHeading,
  SkeletonTable,
} from '@/components/state/skeleton-primitives';

const PIPELINE_CARD_IDS = ['pipeline-1', 'pipeline-2', 'pipeline-3'];
const SETUP_PANEL_IDS = ['setup-1', 'setup-2', 'setup-3'];

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

      <section className="control-band">
        <div className="control-band__header" aria-hidden="true">
          <div className="skeleton skeleton--title" />
        </div>
        <section className="panel">
          <SkeletonSectionHeading />
          <section className="kpi-grid">
            <SkeletonKpiCard />
            <SkeletonKpiCard />
            <SkeletonKpiCard />
            <SkeletonKpiCard />
          </section>
        </section>
        <section className="panel">
          <SkeletonSectionHeading />
          <SkeletonTable
            columns={['RUN ID', 'PIPELINE', 'STATUS', 'STARTED', 'DETAILS']}
            rows={5}
          />
        </section>
      </section>

      <section className="control-band">
        <div className="control-band__header" aria-hidden="true">
          <div className="skeleton skeleton--title" />
        </div>
        <section className="panel">
          <SkeletonSectionHeading />
          <div className="pipeline-grid" aria-hidden="true">
            {PIPELINE_CARD_IDS.map((itemId) => (
              <article key={itemId} className="pipeline-card">
                <div className="skeleton skeleton--line skeleton--line-short" />
                <div className="skeleton skeleton--line" />
                <div className="skeleton skeleton--line" />
                <div className="skeleton skeleton--line" />
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="control-band">
        <div className="control-band__header" aria-hidden="true">
          <div className="skeleton skeleton--title" />
        </div>
        <section className="control-grid control-grid--triple">
          {SETUP_PANEL_IDS.map((panelId) => (
            <section key={panelId} className="panel">
              <SkeletonSectionHeading />
              <div className="resource-compact-grid" aria-hidden="true">
                <article className="resource-compact-card">
                  <div className="skeleton skeleton--line skeleton--line-short" />
                  <div className="skeleton skeleton--line" />
                  <div className="skeleton skeleton--line" />
                </article>
                <article className="resource-compact-card">
                  <div className="skeleton skeleton--line skeleton--line-short" />
                  <div className="skeleton skeleton--line" />
                  <div className="skeleton skeleton--line" />
                </article>
              </div>
            </section>
          ))}
        </section>
      </section>
    </AppShell>
  );
}
