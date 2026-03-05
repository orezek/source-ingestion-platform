import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/state/error-state';
import { JsonViewerPanel } from '@/components/control-plane/json-viewer-panel';
import { LiveRefresh } from '@/components/control-plane/live-refresh';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { formatDateTime } from '@/server/lib/formatting';
import { env } from '@/server/env';
import { getControlPlaneRunStructuredOutputPreview } from '@/server/control-plane/outputs';
import { getControlPlaneRunDetail } from '@/server/control-plane/service';

export const dynamic = 'force-dynamic';

function shouldAutoRefresh(status: string): boolean {
  return status === 'queued' || status === 'running';
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

export default async function ControlPlaneStructuredOutputPage({
  params,
}: {
  params: Promise<{ runId: string; destinationId: string; sourceId: string }>;
}) {
  const { runId, destinationId, sourceId } = await params;

  try {
    const [detail, output] = await Promise.all([
      getControlPlaneRunDetail(runId),
      getControlPlaneRunStructuredOutputPreview({ runId, destinationId, sourceId }),
    ]);

    if (!detail) {
      notFound();
    }

    return (
      <AppShell>
        <LiveRefresh enabled={shouldAutoRefresh(detail.runView.computedStatus)} />
        <PageHeader
          eyebrow="Structured output browser"
          title={output.capture.fileName}
          description="Browse a normalized JSON result for one run item."
          environmentLabel={`CONTROL ${env.CONTROL_PLANE_EXECUTION_MODE.toUpperCase()}`}
          databaseName={detail.mongoDatabaseName ?? 'local-only'}
          generatedAt={output.capture.occurredAt}
          latestCrawlerStatus={detail.runView.crawlerRuntime?.status ?? null}
          latestIngestionStatus={detail.runView.ingestionRuntime?.status ?? null}
          actions={[]}
          showControlPlaneLink={false}
        />

        <section className="panel technical-meta-panel">
          <div className="technical-meta-grid">
            <article className="technical-meta-item">
              <p className="technical-meta-item__label">Destination</p>
              <p className="technical-meta-item__value">{output.capture.destinationName}</p>
            </article>
            <article className="technical-meta-item">
              <p className="technical-meta-item__label">Source id</p>
              <p className="technical-meta-item__value">{output.capture.sourceId}</p>
            </article>
            <article className="technical-meta-item">
              <p className="technical-meta-item__label">Generated</p>
              <p className="technical-meta-item__value">
                {formatDateTime(output.capture.occurredAt)}
              </p>
            </article>
            <article className="technical-meta-item">
              <p className="technical-meta-item__label">Storage</p>
              <p className="technical-meta-item__value">{output.capture.outputStorageType}</p>
            </article>
          </div>
        </section>

        <section className="panel detail-grid detail-grid--meta">
          <div className="detail-card">
            <SectionHeading
              eyebrow="Output"
              title="Delivery metadata"
              description="The downloadable JSON output is resolved from the immutable run manifest and ingestion success events."
            />
            <ul className="detail-list">
              <li>RUN ID: {runId}</li>
              <li>DESTINATION: {output.capture.destinationName}</li>
              <li>SOURCE ID: {output.capture.sourceId}</li>
              <li>GENERATED: {formatDateTime(output.capture.occurredAt)}</li>
              <li>STORAGE: {output.capture.outputStorageType}</li>
              <li>DOCUMENT ID: {output.capture.documentId ?? 'N/A'}</li>
            </ul>
          </div>
          <div className="detail-card">
            <SectionHeading
              eyebrow="Trace"
              title="Ingestion reference"
              description="Use the run detail page for the full pipeline and broker timeline."
            />
            <ul className="detail-list">
              <li>PRODUCER: {output.capture.producer}</li>
              <li>DESTINATION ID: {output.capture.destinationId}</li>
              <li className="data-table__cell--wrap">PATH: {output.capture.outputPath}</li>
              <li className="data-table__cell--wrap">DEDUPE KEY: {output.capture.dedupeKey}</li>
            </ul>
          </div>
          <div className="detail-card">
            <SectionHeading
              eyebrow="Actions"
              title="Operator shortcuts"
              description="Preview in the dashboard or download the raw JSON document directly."
            />
            <div className="artifact-actions">
              <Link
                href={`/control-plane/runs/${runId}`}
                className="action-button action-button--compact"
              >
                Back to run detail
              </Link>
              <Link
                href={`/api/control-plane/runs/${runId}/outputs/${destinationId}/${sourceId}?download=1`}
                className="action-button action-button--compact"
                download={output.capture.fileName}
              >
                Download JSON
              </Link>
            </div>
          </div>
        </section>

        <JsonViewerPanel
          eyebrow="Normalized output"
          title="JSON preview"
          value={output.preview.exists ? parseJsonPreview(output.preview.contents) : null}
          emptyCopy="The structured output could not be read for this run."
          description="Expand the payload only when you need field-level inspection."
          rootLabel="document"
        />
      </AppShell>
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /Unknown run|does not include downloadable output/i.test(error.message)
    ) {
      notFound();
    }

    return (
      <AppShell>
        <ErrorState
          title="Structured output browser could not be loaded"
          message={error instanceof Error ? error.message : 'Unknown structured output error.'}
        />
      </AppShell>
    );
  }
}
