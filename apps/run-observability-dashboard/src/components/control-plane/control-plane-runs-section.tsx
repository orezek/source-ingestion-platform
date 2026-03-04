import Link from 'next/link';
import type { ControlPlaneOverview } from '@/server/control-plane/service';
import { StatusBadge } from '@/components/state/status-badge';
import { EmptyTray } from '@/components/state/empty-tray';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { formatDateTime } from '@/server/lib/formatting';

type ControlPlaneRunsSectionProps = {
  runs: ControlPlaneOverview['runs'];
  pipelines: ControlPlaneOverview['pipelines'];
};

export function ControlPlaneRunsSection({ runs, pipelines }: ControlPlaneRunsSectionProps) {
  const pipelineNames = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline.name]));

  return (
    <section className="panel">
      <SectionHeading
        eyebrow="History"
        title="Recent control-plane runs"
        description="Immutable execution records across pipelines."
        detail={`${runs.length} total`}
      />
      {runs.length === 0 ? (
        <EmptyTray
          label="History"
          title="No control-plane runs"
          message="No control-plane runs have been started yet."
        />
      ) : (
        <div className="table-wrap" data-testid="control-plane-runs">
          <table className="data-table control-plane-runs-table">
            <thead>
              <tr>
                <th>RUN</th>
                <th>PIPELINE</th>
                <th>STATUS</th>
                <th>WORKERS</th>
                <th>REQUESTED</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((entry) => (
                <tr key={entry.run.runId}>
                  <td>{entry.run.runId.slice(0, 18)}</td>
                  <td className="data-table__cell--wrap">
                    {pipelineNames.get(entry.run.pipelineId) ?? entry.run.pipelineId}
                  </td>
                  <td>
                    <StatusBadge status={entry.computedStatus} />
                  </td>
                  <td className="data-table__cell--wrap">
                    <div className="table-status-stack">
                      {entry.crawlerRuntime ? (
                        <StatusBadge label="CRAWLER" status={entry.crawlerRuntime.status} />
                      ) : (
                        <span className="empty-copy">No crawler runtime</span>
                      )}
                      {entry.ingestionRuntime ? (
                        <StatusBadge label="INGESTION" status={entry.ingestionRuntime.status} />
                      ) : (
                        <span className="empty-copy">Crawl only</span>
                      )}
                    </div>
                  </td>
                  <td>{formatDateTime(entry.run.requestedAt)}</td>
                  <td>
                    <Link
                      href={`/control-plane/runs/${entry.run.runId}`}
                      className="action-button action-button--compact"
                      data-testid={`run-detail-${entry.run.runId}`}
                    >
                      Detail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
