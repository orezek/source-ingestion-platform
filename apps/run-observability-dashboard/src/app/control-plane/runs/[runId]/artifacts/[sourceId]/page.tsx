import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/state/error-state';
import { FilePreviewPanel } from '@/components/control-plane/file-preview-panel';
import { LiveRefresh } from '@/components/control-plane/live-refresh';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { formatCompactBytes, formatDateTime } from '@/server/lib/formatting';
import { env } from '@/server/env';
import { getControlPlaneRunArtifactPreview } from '@/server/control-plane/artifacts';
import { getControlPlaneRunDetail } from '@/server/control-plane/service';

export const dynamic = 'force-dynamic';

function shouldAutoRefresh(status: string): boolean {
  return status === 'queued' || status === 'running';
}

export default async function ControlPlaneArtifactPage({
  params,
}: {
  params: Promise<{ runId: string; sourceId: string }>;
}) {
  const { runId, sourceId } = await params;

  try {
    const [detail, artifact] = await Promise.all([
      getControlPlaneRunDetail(runId),
      getControlPlaneRunArtifactPreview({ runId, sourceId }),
    ]);

    if (!detail) {
      notFound();
    }

    return (
      <AppShell>
        <LiveRefresh enabled={shouldAutoRefresh(detail.runView.computedStatus)} />
        <PageHeader
          eyebrow="Artifact browser"
          title={artifact.capture.jobTitle}
          description="Browse one captured HTML artifact."
          environmentLabel={`CONTROL ${env.CONTROL_PLANE_EXECUTION_MODE.toUpperCase()}`}
          databaseName={detail.mongoDatabaseName ?? 'local-only'}
          generatedAt={artifact.capture.occurredAt}
          latestCrawlerStatus={detail.runView.crawlerRuntime?.status ?? null}
          latestIngestionStatus={detail.runView.ingestionRuntime?.status ?? null}
          actions={[]}
          showControlPlaneLink={false}
          summaryItems={[
            { label: 'Source id', value: artifact.capture.sourceId },
            { label: 'Captured', value: formatDateTime(artifact.capture.occurredAt) },
            { label: 'Size', value: formatCompactBytes(artifact.capture.artifactSizeBytes) },
            { label: 'Storage', value: artifact.capture.artifactStorageType },
          ]}
        />

        <section className="panel detail-grid detail-grid--meta">
          <div className="detail-card">
            <SectionHeading
              eyebrow="Artifact"
              title="Capture metadata"
              description="The artifact browser is tied to the brokered capture record for this run."
            />
            <ul className="detail-list">
              <li>RUN ID: {runId}</li>
              <li>SOURCE ID: {artifact.capture.sourceId}</li>
              <li>CAPTURED: {formatDateTime(artifact.capture.occurredAt)}</li>
              <li>STORAGE: {artifact.capture.artifactStorageType}</li>
              <li>SIZE: {formatCompactBytes(artifact.capture.artifactSizeBytes)}</li>
              <li>CHECKSUM: {artifact.capture.checksum}</li>
            </ul>
          </div>
          <div className="detail-card">
            <SectionHeading
              eyebrow="Listing"
              title="Source reference"
              description="Use the run detail page for the full execution context."
            />
            <ul className="detail-list">
              <li>TITLE: {artifact.capture.jobTitle}</li>
              <li>SOURCE: {artifact.capture.source}</li>
              <li className="data-table__cell--wrap">AD URL: {artifact.capture.adUrl}</li>
              <li className="data-table__cell--wrap">PATH: {artifact.capture.artifactPath}</li>
              <li className="data-table__cell--wrap">DEDUPE KEY: {artifact.capture.dedupeKey}</li>
            </ul>
          </div>
          <div className="detail-card">
            <SectionHeading
              eyebrow="Actions"
              title="Operator shortcuts"
              description="Preview in the dashboard or download the raw HTML file directly."
            />
            <div className="artifact-actions">
              <Link
                href={`/control-plane/runs/${runId}`}
                className="action-button action-button--compact"
              >
                Back to run detail
              </Link>
              <Link
                href={`/api/control-plane/runs/${runId}/artifacts/${sourceId}?download=1`}
                className="action-button action-button--compact"
                download={artifact.capture.htmlDetailPageKey}
              >
                Download HTML
              </Link>
            </div>
          </div>
        </section>

        <FilePreviewPanel
          eyebrow="HTML source"
          title="Artifact preview"
          preview={artifact.preview}
          emptyCopy="The HTML artifact could not be read for this run."
        />
      </AppShell>
    );
  } catch (error) {
    if (error instanceof Error && /Unknown run|does not include artifact/i.test(error.message)) {
      notFound();
    }

    return (
      <AppShell>
        <ErrorState
          title="Artifact browser could not be loaded"
          message={error instanceof Error ? error.message : 'Unknown artifact access error.'}
        />
      </AppShell>
    );
  }
}
