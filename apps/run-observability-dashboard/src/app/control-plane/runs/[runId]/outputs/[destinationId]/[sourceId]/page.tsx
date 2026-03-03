import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/state/error-state';
import { FilePreviewPanel } from '@/components/control-plane/file-preview-panel';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { formatDateTime } from '@/server/lib/formatting';
import { env } from '@/server/env';
import { getControlPlaneRunStructuredOutputPreview } from '@/server/control-plane/outputs';
import { getControlPlaneRunDetail } from '@/server/control-plane/service';

export const dynamic = 'force-dynamic';

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
        <PageHeader
          eyebrow="Structured output browser"
          title={output.capture.fileName}
          description="Browse a normalized JSON result for a single run item without leaving the control plane."
          environmentLabel={`CONTROL ${env.CONTROL_PLANE_EXECUTION_MODE.toUpperCase()}`}
          databaseName={detail.mongoDatabaseName ?? 'local-only'}
          generatedAt={output.capture.occurredAt}
          latestCrawlerStatus={detail.runView.crawlerRuntime?.status ?? null}
          latestIngestionStatus={detail.runView.ingestionRuntime?.status ?? null}
        />

        <section className="panel detail-grid">
          <div>
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
          <div>
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
          <div>
            <SectionHeading
              eyebrow="Actions"
              title="Operator shortcuts"
              description="Preview in the dashboard or download the raw JSON document directly."
            />
            <div className="artifact-actions">
              <Link href={`/control-plane/runs/${runId}`} className="primary-link">
                Back to run detail
              </Link>
              <Link
                href={`/api/control-plane/runs/${runId}/outputs/${destinationId}/${sourceId}?download=1`}
                className="primary-link"
                download={output.capture.fileName}
              >
                Download JSON
              </Link>
            </div>
          </div>
        </section>

        <FilePreviewPanel
          eyebrow="Normalized output"
          title="JSON preview"
          preview={output.preview}
          emptyCopy="The structured output could not be read for this run."
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
