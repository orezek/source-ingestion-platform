import Link from 'next/link';
import type { ControlPlaneOverview } from '@/server/control-plane/service';
import { StatusBadge } from '@/components/state/status-badge';
import { EmptyTray } from '@/components/state/empty-tray';
import { DisclosurePanel } from '@/components/control-plane/disclosure-panel';
import { StartRunForm } from '@/components/control-plane/start-run-form';
import { startRunAction } from '@/app/control-plane/actions';

type ControlPlaneCommandDeckProps = {
  runs: ControlPlaneOverview['runs'];
  pipelines: ControlPlaneOverview['pipelines'];
  executionMode: string;
  brokerBackend: string;
  brokerDir: string;
  dataDir: string;
  databaseName?: string | null;
  brokerTopic?: string;
};

export function ControlPlaneCommandDeck({
  runs,
  pipelines,
  executionMode,
  brokerBackend,
  brokerDir,
  dataDir,
  databaseName,
  brokerTopic,
}: ControlPlaneCommandDeckProps) {
  const pipelineNames = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline.name]));
  const activePipelineRuns: Record<string, { runId: string; status: 'queued' | 'running' }> = {};
  const activeRuns = runs.filter(
    (runView) => runView.computedStatus === 'queued' || runView.computedStatus === 'running',
  );

  for (const runView of runs) {
    if (
      (runView.computedStatus === 'queued' || runView.computedStatus === 'running') &&
      !activePipelineRuns[runView.run.pipelineId]
    ) {
      activePipelineRuns[runView.run.pipelineId] = {
        runId: runView.run.runId,
        status: runView.computedStatus,
      };
    }
  }

  return (
    <section className="panel control-plane-toolbar">
      <div className="control-plane-toolbar__layout">
        <section className="control-plane-toolbar__launch control-plane-launch-card">
          <div className="control-plane-launch-card__intro">
            <p className="eyebrow">Start run</p>
            <h3>Launch pipeline</h3>
            <p className="control-plane-toolbar__copy">One active run per pipeline.</p>
          </div>
          <StartRunForm
            action={startRunAction}
            pipelines={pipelines.map((pipeline) => ({
              id: pipeline.id,
              name: pipeline.name,
            }))}
            activePipelineRuns={activePipelineRuns}
          />
        </section>
        <div className="control-plane-toolbar__sidebar">
          <div className="control-plane-toolbar__support-grid">
            <article className="control-plane-system-card">
              <div className="control-plane-system-card__header">
                <div>
                  <p className="eyebrow">Active runs</p>
                  <h3>Current execution</h3>
                </div>
              </div>
              {activeRuns.length > 0 ? (
                <div className="active-run-list" data-testid="active-run-list">
                  <ul className="detail-list">
                    {activeRuns.map((runView) => (
                      <li key={runView.run.runId}>
                        <Link href={`/control-plane/runs/${runView.run.runId}`}>
                          {pipelineNames.get(runView.run.pipelineId) ?? runView.run.pipelineId}
                        </Link>
                        <span> • {runView.run.runId.slice(0, 18)}</span>
                        <StatusBadge status={runView.computedStatus} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EmptyTray
                  className="empty-tray--compact"
                  label="Execution"
                  title="No active runs"
                  message="Launch a pipeline when you need one."
                />
              )}
            </article>

            <DisclosurePanel
              title="Environment"
              description="Mode, database, broker, and local state."
            >
              <div className="control-plane-environment-card">
                <div className="system-detail-list">
                  <div className="system-detail-list__row">
                    <span className="system-detail-list__term">Mode</span>
                    <span className="system-detail-list__value">{executionMode}</span>
                  </div>
                  {databaseName ? (
                    <div className="system-detail-list__row">
                      <span className="system-detail-list__term">Database</span>
                      <span className="system-detail-list__value">{databaseName}</span>
                    </div>
                  ) : null}
                  <div className="system-detail-list__row">
                    <span className="system-detail-list__term">Broker</span>
                    <span className="system-detail-list__value">{brokerBackend}</span>
                  </div>
                  {brokerTopic ? (
                    <div className="system-detail-list__row">
                      <span className="system-detail-list__term">Topic</span>
                      <span className="system-detail-list__value">{brokerTopic}</span>
                    </div>
                  ) : null}
                  <div className="system-detail-list__row">
                    <span className="system-detail-list__term">Archive</span>
                    <span className="system-detail-list__value">{brokerDir}</span>
                  </div>
                  <div className="system-detail-list__row">
                    <span className="system-detail-list__term">State</span>
                    <span className="system-detail-list__value">{dataDir}</span>
                  </div>
                </div>
              </div>
            </DisclosurePanel>
          </div>
        </div>
      </div>
    </section>
  );
}
