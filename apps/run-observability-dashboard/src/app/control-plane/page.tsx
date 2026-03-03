import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/state/status-badge';
import { formatDateTime } from '@/server/lib/formatting';
import { env } from '@/server/env';
import { getControlPlaneOverview } from '@/server/control-plane/service';
import {
  createArtifactDestinationAction,
  createPipelineAction,
  createRuntimeProfileAction,
  createSearchSpaceAction,
  createStructuredOutputDestinationAction,
  startRunAction,
} from '@/app/control-plane/actions';
import type { StructuredOutputDestination } from '@repo/control-plane-contracts';

export const dynamic = 'force-dynamic';

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="section-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="empty-copy">{description}</p>
    </div>
  );
}

function describeStructuredOutputConfig(destination: StructuredOutputDestination): string {
  if (destination.type === 'local_json' && 'basePath' in destination.config) {
    return destination.config.basePath;
  }

  if (destination.type === 'mongodb' && 'collectionName' in destination.config) {
    return destination.config.collectionName;
  }

  if (destination.type === 'gcs_json' && 'bucket' in destination.config) {
    return `${destination.config.bucket}/${destination.config.prefix ?? ''}`;
  }

  return destination.id;
}

export default async function ControlPlanePage() {
  const overview = await getControlPlaneOverview();
  const pipelineNames = new Map(overview.pipelines.map((pipeline) => [pipeline.id, pipeline.name]));

  return (
    <AppShell>
      <PageHeader
        eyebrow="Control plane"
        title="Local operator surface"
        description="Bootstrap search spaces, wire local pipelines, generate Apify-compatible INPUT.json, and launch v1 local runs without changing the current crawler or ingestion compatibility contracts."
        environmentLabel={`CONTROL ${env.CONTROL_PLANE_EXECUTION_MODE.toUpperCase()}`}
        databaseName={env.MONGODB_DB_NAME}
        generatedAt={new Date().toISOString()}
        latestCrawlerStatus={overview.runs[0]?.crawlerRuntime?.status ?? null}
        latestIngestionStatus={overview.runs[0]?.ingestionRuntime?.status ?? null}
      />

      <section className="panel control-plane-toolbar">
        <div className="control-plane-toolbar__meta">
          <div className="meta-chip">BROKER: {env.CONTROL_PLANE_BROKER_DIR}</div>
          <div className="meta-chip">STATE: {env.CONTROL_PLANE_DATA_DIR}</div>
          <Link href="/" className="primary-link">
            Open observability dashboard
          </Link>
        </div>
      </section>

      <section className="panel">
        <SectionHeading
          eyebrow="Runs"
          title="Recent control-plane runs"
          description="Each run snapshots the pipeline into an immutable manifest and keeps worker runtime state separate from the base run record."
        />
        {overview.runs.length === 0 ? (
          <p className="empty-copy">No control-plane runs have been started yet.</p>
        ) : (
          <div className="table-wrap" data-testid="control-plane-runs">
            <table className="data-table">
              <thead>
                <tr>
                  <th>RUN</th>
                  <th>PIPELINE</th>
                  <th>STATUS</th>
                  <th>CRAWLER</th>
                  <th>INGESTION</th>
                  <th>REQUESTED</th>
                </tr>
              </thead>
              <tbody>
                {overview.runs.map((entry) => (
                  <tr key={entry.run.runId}>
                    <td>{entry.run.runId}</td>
                    <td>{pipelineNames.get(entry.run.pipelineId) ?? entry.run.pipelineId}</td>
                    <td>
                      <StatusBadge label="RUN" status={entry.computedStatus} />
                    </td>
                    <td>
                      {entry.crawlerRuntime ? (
                        <StatusBadge label="CRAWLER" status={entry.crawlerRuntime.status} />
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td>
                      {entry.ingestionRuntime ? (
                        <StatusBadge label="INGESTION" status={entry.ingestionRuntime.status} />
                      ) : (
                        'DISABLED'
                      )}
                    </td>
                    <td>{formatDateTime(entry.run.requestedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form action={startRunAction} className="control-form control-form--inline">
          <label>
            <span>PIPELINE</span>
            <select
              name="pipelineId"
              required
              defaultValue={overview.pipelines[0]?.id}
              data-testid="start-run-pipeline"
            >
              {overview.pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={overview.pipelines.length === 0}
            data-testid="start-run-submit"
          >
            Start run
          </button>
        </form>
      </section>

      <section className="control-grid">
        <section className="panel">
          <SectionHeading
            eyebrow="Search spaces"
            title="Source definitions"
            description="Bootstrapped from the current crawler configs and editable through the control plane."
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>START URLS</th>
                  <th>MAX ITEMS</th>
                </tr>
              </thead>
              <tbody>
                {overview.searchSpaces.map((searchSpace) => (
                  <tr key={searchSpace.id}>
                    <td>{searchSpace.id}</td>
                    <td>{searchSpace.startUrls.length}</td>
                    <td>{searchSpace.maxItemsDefault}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={createSearchSpaceAction} className="control-form">
            <label>
              <span>NAME</span>
              <input name="name" placeholder="Prague backend daily" required />
            </label>
            <label>
              <span>DESCRIPTION</span>
              <textarea name="description" rows={3} />
            </label>
            <label>
              <span>START URLS</span>
              <textarea
                name="startUrls"
                rows={4}
                placeholder="https://www.jobs.cz/prace/praha/"
                required
              />
            </label>
            <div className="control-form__row">
              <label>
                <span>MAX ITEMS</span>
                <input name="maxItemsDefault" type="number" min="1" defaultValue="100" required />
              </label>
              <label>
                <span>MAX CONCURRENCY</span>
                <input
                  name="maxConcurrencyDefault"
                  type="number"
                  min="1"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                <span>REQ/MIN</span>
                <input
                  name="maxRequestsPerMinuteDefault"
                  type="number"
                  min="1"
                  defaultValue="30"
                  required
                />
              </label>
            </div>
            <label className="checkbox-row">
              <input name="allowInactiveMarkingOnPartialRuns" type="checkbox" />
              <span>Allow inactive marking on partial runs</span>
            </label>
            <button type="submit">Create search space</button>
          </form>
        </section>

        <section className="panel">
          <SectionHeading
            eyebrow="Runtime profiles"
            title="Execution settings"
            description="Separate crawler throughput from artifact and sink configuration."
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>CRAWLER</th>
                  <th>INGESTION</th>
                </tr>
              </thead>
              <tbody>
                {overview.runtimeProfiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>{profile.id}</td>
                    <td>
                      {profile.crawlerMaxConcurrency} / {profile.crawlerMaxRequestsPerMinute}
                    </td>
                    <td>{profile.ingestionEnabled ? 'enabled' : 'disabled'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={createRuntimeProfileAction} className="control-form">
            <label>
              <span>NAME</span>
              <input name="name" placeholder="Daily local crawl" required />
            </label>
            <div className="control-form__row">
              <label>
                <span>CRAWLER CONCURRENCY</span>
                <input
                  name="crawlerMaxConcurrency"
                  type="number"
                  min="1"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                <span>REQ/MIN</span>
                <input
                  name="crawlerMaxRequestsPerMinute"
                  type="number"
                  min="1"
                  defaultValue="30"
                  required
                />
              </label>
              <label>
                <span>INGESTION CONCURRENCY</span>
                <input
                  name="ingestionConcurrency"
                  type="number"
                  min="1"
                  defaultValue="1"
                  required
                />
              </label>
            </div>
            <label className="checkbox-row">
              <input name="ingestionEnabled" type="checkbox" defaultChecked />
              <span>Enable ingestion</span>
            </label>
            <label className="checkbox-row">
              <input name="debugLog" type="checkbox" />
              <span>Enable verbose crawler logging</span>
            </label>
            <button type="submit">Create runtime profile</button>
          </form>
        </section>
      </section>

      <section className="control-grid">
        <section className="panel">
          <SectionHeading
            eyebrow="Destinations"
            title="Artifact storage"
            description="V1 local execution writes HTML artifacts to local filesystem roots while preserving the current run-based layout."
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>TYPE</th>
                  <th>CONFIG</th>
                </tr>
              </thead>
              <tbody>
                {overview.artifactDestinations.map((destination) => (
                  <tr key={destination.id}>
                    <td>{destination.id}</td>
                    <td>{destination.type}</td>
                    <td>
                      {'basePath' in destination.config
                        ? destination.config.basePath
                        : `${destination.config.bucket}/${destination.config.prefix ?? ''}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={createArtifactDestinationAction} className="control-form">
            <label>
              <span>NAME</span>
              <input name="name" placeholder="Local HTML storage" required />
            </label>
            <label>
              <span>BASE PATH</span>
              <input
                name="basePath"
                defaultValue="../jobs-ingestion-service/scrapped_jobs"
                required
              />
            </label>
            <button type="submit">Create artifact destination</button>
          </form>
        </section>

        <section className="panel">
          <SectionHeading
            eyebrow="Outputs"
            title="Structured sinks"
            description="V1 keeps MongoDB and local JSON as direct ingestion worker sinks."
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>TYPE</th>
                  <th>CONFIG</th>
                </tr>
              </thead>
              <tbody>
                {overview.structuredOutputDestinations.map((destination) => (
                  <tr key={destination.id}>
                    <td>{destination.id}</td>
                    <td>{destination.type}</td>
                    <td>{describeStructuredOutputConfig(destination)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={createStructuredOutputDestinationAction} className="control-form">
            <label>
              <span>NAME</span>
              <input name="name" placeholder="Local normalized JSON" required />
            </label>
            <label>
              <span>TYPE</span>
              <select name="type" defaultValue="local_json">
                <option value="local_json">local_json</option>
                <option value="mongodb">mongodb</option>
              </select>
            </label>
            <label>
              <span>BASE PATH</span>
              <input
                name="basePath"
                defaultValue="../jobs-ingestion-service/output/control-plane"
              />
            </label>
            <label>
              <span>COLLECTION</span>
              <input name="collectionName" defaultValue="normalized_job_ads" />
            </label>
            <label>
              <span>CONNECTION REF</span>
              <input name="connectionRef" defaultValue="env:MONGODB_URI" />
            </label>
            <button type="submit">Create structured output</button>
          </form>
        </section>
      </section>

      <section className="panel">
        <SectionHeading
          eyebrow="Pipelines"
          title="Run definitions"
          description="Pipelines bind a search space, runtime profile, artifact destination, and optional structured sinks into a versioned manifest source."
        />
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>SEARCH SPACE</th>
                <th>MODE</th>
                <th>SINKS</th>
              </tr>
            </thead>
            <tbody>
              {overview.pipelines.map((pipeline) => (
                <tr key={pipeline.id}>
                  <td>{pipeline.id}</td>
                  <td>{pipeline.searchSpaceId}</td>
                  <td>{pipeline.mode}</td>
                  <td>
                    {pipeline.structuredOutputDestinationIds.length > 0
                      ? pipeline.structuredOutputDestinationIds.join(', ')
                      : 'none'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form action={createPipelineAction} className="control-form">
          <label>
            <span>NAME</span>
            <input
              name="name"
              placeholder="Prague jobs local pipeline"
              required
              data-testid="pipeline-name-input"
            />
          </label>
          <div className="control-form__row">
            <label>
              <span>SEARCH SPACE</span>
              <select name="searchSpaceId" required defaultValue={overview.searchSpaces[0]?.id}>
                {overview.searchSpaces.map((searchSpace) => (
                  <option key={searchSpace.id} value={searchSpace.id}>
                    {searchSpace.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>RUNTIME</span>
              <select
                name="runtimeProfileId"
                required
                defaultValue={overview.runtimeProfiles[0]?.id}
              >
                {overview.runtimeProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>ARTIFACT DESTINATION</span>
              <select
                name="artifactDestinationId"
                required
                defaultValue={overview.artifactDestinations[0]?.id}
              >
                {overview.artifactDestinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="control-form__row">
            <label>
              <span>MODE</span>
              <select name="mode" defaultValue="crawl_and_ingest">
                <option value="crawl_and_ingest">crawl_and_ingest</option>
                <option value="crawl_only">crawl_only</option>
              </select>
            </label>
            <label className="control-form__wide">
              <span>STRUCTURED OUTPUT IDS</span>
              <input
                name="structuredOutputDestinationIds"
                placeholder="local-json-output,mongo-normalized-jobs"
              />
            </label>
          </div>
          <button type="submit" data-testid="create-pipeline-submit">
            Create pipeline
          </button>
        </form>
      </section>
    </AppShell>
  );
}
