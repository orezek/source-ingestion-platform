import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { BrokerEvent } from '@repo/control-plane-contracts';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/metrics/kpi-card';
import { StatusBadge } from '@/components/state/status-badge';
import { ErrorState } from '@/components/state/error-state';
import { FilePreviewPanel } from '@/components/control-plane/file-preview-panel';
import { JsonViewerPanel } from '@/components/control-plane/json-viewer-panel';
import { DisclosurePanel } from '@/components/control-plane/disclosure-panel';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { formatCompactBytes, formatDateTime, formatNumber } from '@/server/lib/formatting';
import { env } from '@/server/env';
import { getControlPlaneRunDetail } from '@/server/control-plane/service';

export const dynamic = 'force-dynamic';

function describeBrokerEvent(event: BrokerEvent): string {
  switch (event.eventType) {
    case 'crawler.run.requested':
      return `${event.payload.runManifest.searchSpaceSnapshot.startUrls.length} start URLs`;
    case 'crawler.detail.captured':
      return `${event.payload.sourceId} • ${event.payload.listingRecord.jobTitle}`;
    case 'crawler.run.finished':
      return `status=${event.payload.status} • new=${event.payload.newJobsCount} • failed=${event.payload.failedRequests}`;
    case 'ingestion.item.started':
    case 'ingestion.item.succeeded':
    case 'ingestion.item.failed':
    case 'ingestion.item.rejected':
      return `${event.payload.sourceId} • ${event.payload.reason ?? event.payload.documentId ?? 'no extra details'}`;
  }
}

function parseJsonPreview(contents: string | null | undefined): unknown | null {
  if (!contents) {
    return null;
  }

  try {
    return JSON.parse(contents) as unknown;
  } catch {
    return null;
  }
}

export default async function ControlPlaneRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  try {
    const detail = await getControlPlaneRunDetail(runId);
    if (!detail) {
      notFound();
    }
    const generatedAt =
      detail.runView.run.finishedAt ??
      detail.runView.run.startedAt ??
      detail.runView.run.requestedAt;

    return (
      <AppShell>
        <PageHeader
          eyebrow="Run detail"
          title={detail.pipeline?.name ?? `Run ${detail.runView.run.runId.slice(0, 18)}`}
          description="Inspect the run, then open artifacts and outputs only when needed."
          environmentLabel={`CONTROL ${env.CONTROL_PLANE_EXECUTION_MODE.toUpperCase()}`}
          databaseName={detail.mongoDatabaseName ?? 'local-only'}
          generatedAt={generatedAt}
          latestCrawlerStatus={detail.runView.crawlerRuntime?.status ?? null}
          latestIngestionStatus={detail.runView.ingestionRuntime?.status ?? null}
          backHref="/control-plane"
          backLabel="Back to control plane"
          showControlPlaneLink={false}
          summaryItems={[
            { label: 'Run id', value: detail.runView.run.runId.slice(0, 18) },
            {
              label: 'Status',
              value: detail.runView.computedStatus.replaceAll('_', ' '),
            },
            {
              label: 'Mode',
              value: detail.runView.manifest?.mode ?? 'N/A',
            },
            {
              label: 'Pipeline',
              value: detail.pipeline?.name ?? detail.runView.run.pipelineId,
            },
          ]}
        />

        <section className="kpi-grid" data-testid="control-plane-run-detail">
          <KpiCard
            label="BROKER EVENTS"
            value={formatNumber(detail.brokerEvents.length)}
            hint="Persisted event files for this run"
          />
          <KpiCard
            label="HTML ARTIFACTS"
            value={formatNumber(detail.artifactCaptures.length)}
            hint="Captured detail pages"
          />
          <KpiCard
            label="JSON OUTPUTS"
            value={formatNumber(detail.structuredOutputCaptures.length)}
            hint="Downloadable normalized results"
          />
          <KpiCard
            label="OUTPUT SINKS"
            value={formatNumber(
              detail.runView.manifest?.structuredOutputDestinationSnapshots.length ?? 0,
            )}
            hint="Configured structured destinations"
          />
        </section>

        <section className="panel detail-grid">
          <div>
            <SectionHeading eyebrow="Lifecycle" title="Run timing" />
            <ul className="detail-list">
              <li>RUN ID: {detail.runView.run.runId}</li>
              <li>REQUESTED: {formatDateTime(detail.runView.run.requestedAt)}</li>
              <li>STARTED: {formatDateTime(detail.runView.run.startedAt ?? null)}</li>
              <li>FINISHED: {formatDateTime(detail.runView.run.finishedAt ?? null)}</li>
              <li>STOP REASON: {detail.runView.run.stopReason ?? 'N/A'}</li>
              <li>CREATED BY: {detail.runView.manifest?.createdBy ?? 'N/A'}</li>
            </ul>
          </div>
          <div>
            <SectionHeading eyebrow="Pipeline" title="Immutable snapshot" />
            <ul className="detail-list">
              <li>PIPELINE: {detail.pipeline?.name ?? detail.runView.run.pipelineId}</li>
              <li>PIPELINE VERSION: {detail.runView.run.pipelineVersion}</li>
              <li>SEARCH SPACE: {detail.runView.manifest?.searchSpaceSnapshot.id ?? 'N/A'}</li>
              <li>
                RUNTIME PROFILE: {detail.runView.manifest?.runtimeProfileSnapshot.id ?? 'N/A'}
              </li>
              <li>
                ARTIFACT STORAGE: {detail.runView.manifest?.artifactStorageSnapshot.type ?? 'N/A'}
              </li>
              <li>SOURCE TYPE: {detail.runView.manifest?.sourceType ?? 'N/A'}</li>
            </ul>
          </div>
          <div>
            <SectionHeading eyebrow="Workers" title="Runtime state" />
            <div className="runtime-stack">
              {detail.runView.crawlerRuntime ? (
                <div className="runtime-card">
                  <StatusBadge label="CRAWLER" status={detail.runView.crawlerRuntime.status} />
                  <ul className="detail-list">
                    <li>PID: {detail.runView.crawlerRuntime.pid ?? 'N/A'}</li>
                    <li>
                      HEARTBEAT:{' '}
                      {formatDateTime(detail.runView.crawlerRuntime.lastHeartbeatAt ?? null)}
                    </li>
                    <li>LOG: {detail.runView.crawlerRuntime.logPath ?? 'N/A'}</li>
                    <li>ERROR: {detail.runView.crawlerRuntime.errorMessage ?? 'N/A'}</li>
                  </ul>
                </div>
              ) : (
                <p className="empty-copy">Crawler runtime has not been written yet.</p>
              )}
              {detail.runView.ingestionRuntime ? (
                <div className="runtime-card">
                  <StatusBadge label="INGESTION" status={detail.runView.ingestionRuntime.status} />
                  <ul className="detail-list">
                    <li>PID: {detail.runView.ingestionRuntime.pid ?? 'N/A'}</li>
                    <li>
                      HEARTBEAT:{' '}
                      {formatDateTime(detail.runView.ingestionRuntime.lastHeartbeatAt ?? null)}
                    </li>
                    <li>LOG: {detail.runView.ingestionRuntime.logPath ?? 'N/A'}</li>
                    <li>ERROR: {detail.runView.ingestionRuntime.errorMessage ?? 'N/A'}</li>
                  </ul>
                </div>
              ) : (
                <p className="empty-copy">
                  Ingestion is disabled or has not written runtime state yet.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="chart-grid">
          <JsonViewerPanel
            eyebrow="Manifest"
            title="Run manifest"
            value={detail.runView.manifest}
            emptyCopy="This run does not have a persisted manifest yet."
            description="The immutable runtime snapshot for this execution."
            rootLabel="runManifest"
          />
          <JsonViewerPanel
            eyebrow="Apify input"
            title="Generated INPUT.json"
            value={
              detail.generatedInput.exists ? parseJsonPreview(detail.generatedInput.contents) : null
            }
            emptyCopy="The generated INPUT.json file has not been written yet."
            description="Generated from the manifest for crawler-compatible execution."
            rootLabel="INPUT"
          />
        </section>

        <section className="chart-grid">
          <JsonViewerPanel
            eyebrow="Control plane"
            title="Stored run summary"
            value={detail.runView.run.summary}
            emptyCopy="No stored run summary is available."
            description="Persistent control-plane record for this run."
            rootLabel="summary"
          />
          <section className="panel">
            <SectionHeading
              eyebrow="Artifacts"
              title="Captured outputs"
              description="Browse and download captured HTML directly from the control plane."
            />
            {detail.artifactCaptures.length === 0 ? (
              <p className="empty-copy">No captured HTML artifacts are recorded for this run.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SOURCE ID</th>
                      <th>TITLE</th>
                      <th>STORAGE</th>
                      <th>SIZE</th>
                      <th>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.artifactCaptures.map((artifact) => (
                      <tr key={artifact.eventId}>
                        <td>{artifact.sourceId}</td>
                        <td className="data-table__cell--wrap">{artifact.jobTitle}</td>
                        <td>{artifact.artifactStorageType}</td>
                        <td>{formatCompactBytes(artifact.artifactSizeBytes)}</td>
                        <td>
                          <div className="table-action-group">
                            <Link
                              href={`/control-plane/runs/${detail.runView.run.runId}/artifacts/${artifact.sourceId}`}
                              className="action-button action-button--compact"
                              data-testid={`artifact-browse-${artifact.sourceId}`}
                            >
                              Browse
                            </Link>
                            <Link
                              href={`/api/control-plane/runs/${detail.runView.run.runId}/artifacts/${artifact.sourceId}?download=1`}
                              className="action-button action-button--compact"
                              data-testid={`artifact-download-${artifact.sourceId}`}
                              download={artifact.htmlDetailPageKey}
                            >
                              Download
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>

        <section className="panel">
          <SectionHeading
            eyebrow="Outputs"
            title="Downloadable JSON results"
            description="Browse and download normalized JSON outputs directly from the control plane."
          />
          {detail.structuredOutputCaptures.length === 0 ? (
            <p className="empty-copy">
              No downloadable structured outputs are recorded for this run.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>DESTINATION</th>
                    <th>SOURCE ID</th>
                    <th>DOCUMENT ID</th>
                    <th>STORAGE</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.structuredOutputCaptures.map((output) => (
                    <tr key={`${output.destinationId}-${output.sourceId}`}>
                      <td>{output.destinationName}</td>
                      <td>{output.sourceId}</td>
                      <td className="data-table__cell--wrap">{output.documentId ?? 'N/A'}</td>
                      <td>{output.outputStorageType}</td>
                      <td>
                        <div className="table-action-group">
                          <Link
                            href={`/control-plane/runs/${detail.runView.run.runId}/outputs/${output.destinationId}/${output.sourceId}`}
                            className="action-button action-button--compact"
                            data-testid={`output-browse-${output.destinationId}-${output.sourceId}`}
                          >
                            Browse
                          </Link>
                          <Link
                            href={`/api/control-plane/runs/${detail.runView.run.runId}/outputs/${output.destinationId}/${output.sourceId}?download=1`}
                            className="action-button action-button--compact"
                            data-testid={`output-download-${output.destinationId}-${output.sourceId}`}
                            download={output.fileName}
                          >
                            Download
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <DisclosurePanel
            title="Worker logs"
            description="Expand only when the run needs low-level inspection."
          >
            <section className="chart-grid chart-grid--compact">
              <FilePreviewPanel
                eyebrow="Crawler worker"
                title="Crawler log preview"
                preview={detail.crawlerLog}
                emptyCopy="No crawler log has been written for this run yet."
              />
              <FilePreviewPanel
                eyebrow="Ingestion worker"
                title="Ingestion log preview"
                preview={detail.ingestionLog}
                emptyCopy="No ingestion log has been written for this run yet."
              />
            </section>
          </DisclosurePanel>
          <DisclosurePanel
            title="Event history"
            description="Expand the broker timeline only when you need the execution trace."
          >
            {detail.brokerEvents.length === 0 ? (
              <p className="empty-copy">No broker events have been persisted for this run yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>WHEN</th>
                      <th>TYPE</th>
                      <th>PRODUCER</th>
                      <th>CORRELATION</th>
                      <th>DETAIL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.brokerEvents.map((event) => (
                      <tr key={event.eventId}>
                        <td>{formatDateTime(event.occurredAt)}</td>
                        <td>{event.eventType}</td>
                        <td>{event.producer}</td>
                        <td className="data-table__cell--wrap">{event.correlationId}</td>
                        <td className="data-table__cell--wrap">{describeBrokerEvent(event)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DisclosurePanel>
        </section>
      </AppShell>
    );
  } catch (error) {
    return (
      <AppShell>
        <ErrorState
          title="Control-plane run detail could not be loaded"
          message={error instanceof Error ? error.message : 'Unknown control-plane detail error.'}
        />
      </AppShell>
    );
  }
}
