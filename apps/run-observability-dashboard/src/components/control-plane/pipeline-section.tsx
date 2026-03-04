import type {
  Pipeline,
  RuntimeProfile,
  SearchSpace,
  StructuredOutputDestination,
} from '@repo/control-plane-contracts';
import { DisclosurePanel } from '@/components/control-plane/disclosure-panel';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { ResourceLifecycleActions } from '@/components/control-plane/resource-lifecycle-actions';
import {
  createPipelineAction,
  deletePipelineAction,
  updatePipelineAction,
} from '@/app/control-plane/actions';
import {
  buildImplicitDownloadableJsonDestination,
  IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID,
} from '@/server/control-plane/builtin-outputs';

type PipelineSectionProps = {
  pipelines: Pipeline[];
  searchSpaces: SearchSpace[];
  runtimeProfiles: RuntimeProfile[];
  structuredOutputDestinations: StructuredOutputDestination[];
};

function getPipelineModeLabel(mode: Pipeline['mode']): string {
  return mode === 'crawl_and_ingest' ? 'Crawl and ingest' : 'Crawl only';
}

function getStructuredOutputLabel(destination: StructuredOutputDestination): string {
  return `${destination.name} · ${
    destination.type === 'downloadable_json' ? 'Downloadable JSON' : 'MongoDB'
  }`;
}

function getResourceNameById(input: {
  id: string;
  records: Array<{ id: string; name: string }>;
}): string {
  return input.records.find((record) => record.id === input.id)?.name ?? input.id;
}

function renderStructuredOutputChoices(input: {
  destinations: StructuredOutputDestination[];
  selectedIds: string[];
}) {
  if (input.destinations.length === 0) {
    return <p className="empty-copy">No structured outputs are available yet.</p>;
  }

  return (
    <div className="control-form__choice-grid">
      {input.destinations.map((destination) => (
        <label key={destination.id} className="control-form__checkbox">
          <input
            type="checkbox"
            name="structuredOutputDestinationIds"
            value={destination.id}
            defaultChecked={input.selectedIds.includes(destination.id)}
          />
          <span>{getStructuredOutputLabel(destination)}</span>
        </label>
      ))}
    </div>
  );
}

export function PipelineSection({
  pipelines,
  searchSpaces,
  runtimeProfiles,
  structuredOutputDestinations,
}: PipelineSectionProps) {
  const availableStructuredOutputs = [
    buildImplicitDownloadableJsonDestination(),
    ...structuredOutputDestinations,
  ];

  return (
    <section className="panel">
      <SectionHeading title="Pipelines" detail={`${pipelines.length} total`} />
      {pipelines.length === 0 ? (
        <p className="empty-copy">No pipelines yet.</p>
      ) : (
        <div className="pipeline-grid">
          {pipelines.map((pipeline) => (
            <article key={pipeline.id} className="pipeline-card">
              <div className="pipeline-card__header">
                <div>
                  <h3>{pipeline.name}</h3>
                  <p className="resource-card__meta">{pipeline.id}</p>
                </div>
                <span className="resource-status-chip">{pipeline.status}</span>
              </div>
              <dl className="resource-spec-list">
                <div className="resource-spec-list__row">
                  <dt>Source</dt>
                  <dd>
                    {getResourceNameById({
                      id: pipeline.searchSpaceId,
                      records: searchSpaces,
                    })}
                  </dd>
                </div>
                <div className="resource-spec-list__row">
                  <dt>Runtime</dt>
                  <dd>
                    {getResourceNameById({
                      id: pipeline.runtimeProfileId,
                      records: runtimeProfiles,
                    })}
                  </dd>
                </div>
                <div className="resource-spec-list__row">
                  <dt>Mode</dt>
                  <dd>{getPipelineModeLabel(pipeline.mode)}</dd>
                </div>
                <div className="resource-spec-list__row">
                  <dt>Outputs</dt>
                  <dd>
                    {pipeline.structuredOutputDestinationIds.length > 0
                      ? pipeline.structuredOutputDestinationIds.length
                      : 'none'}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}

      {pipelines.length > 0 ? (
        <DisclosurePanel title="Manage pipelines" description="Edit routing, mode, or outputs.">
          <div className="resource-edit-grid">
            {pipelines.map((pipeline) => (
              <details key={pipeline.id} className="resource-card">
                <summary>{pipeline.name}</summary>
                <form action={updatePipelineAction} className="control-form">
                  <input type="hidden" name="id" value={pipeline.id} />
                  <label>
                    <span>NAME</span>
                    <input name="name" defaultValue={pipeline.name} required />
                  </label>
                  <div className="control-form__row">
                    <label>
                      <span>SEARCH SPACE</span>
                      <select name="searchSpaceId" required defaultValue={pipeline.searchSpaceId}>
                        {searchSpaces.map((searchSpace) => (
                          <option key={searchSpace.id} value={searchSpace.id}>
                            {searchSpace.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="control-form__wide">
                      <span>RUNTIME</span>
                      <select
                        name="runtimeProfileId"
                        required
                        defaultValue={pipeline.runtimeProfileId}
                      >
                        {runtimeProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="control-form__row">
                    <label>
                      <span>MODE</span>
                      <select name="mode" defaultValue={pipeline.mode}>
                        <option value="crawl_and_ingest">Crawl and ingest</option>
                        <option value="crawl_only">Crawl only</option>
                      </select>
                    </label>
                  </div>
                  <fieldset className="control-form__fieldset">
                    <legend>STRUCTURED OUTPUTS</legend>
                    {renderStructuredOutputChoices({
                      destinations: availableStructuredOutputs,
                      selectedIds: pipeline.structuredOutputDestinationIds,
                    })}
                  </fieldset>
                  <button type="submit">Save pipeline</button>
                </form>
                <ResourceLifecycleActions id={pipeline.id} deleteAction={deletePipelineAction} />
              </details>
            ))}
          </div>
        </DisclosurePanel>
      ) : null}

      <DisclosurePanel
        title="Create pipeline"
        description="Create a runnable pipeline."
        defaultOpen={pipelines.length === 0}
        testId="create-pipeline-disclosure"
      >
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
              <select name="searchSpaceId" required defaultValue={searchSpaces[0]?.id}>
                {searchSpaces.map((searchSpace) => (
                  <option key={searchSpace.id} value={searchSpace.id}>
                    {searchSpace.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-form__wide">
              <span>RUNTIME</span>
              <select name="runtimeProfileId" required defaultValue={runtimeProfiles[0]?.id}>
                {runtimeProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="control-form__row">
            <label>
              <span>MODE</span>
              <select name="mode" defaultValue="crawl_and_ingest">
                <option value="crawl_and_ingest">Crawl and ingest</option>
                <option value="crawl_only">Crawl only</option>
              </select>
            </label>
          </div>
          <fieldset className="control-form__fieldset">
            <legend>STRUCTURED OUTPUTS</legend>
            {renderStructuredOutputChoices({
              destinations: availableStructuredOutputs,
              selectedIds: [IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID],
            })}
          </fieldset>
          <button type="submit" data-testid="create-pipeline-submit">
            Create pipeline
          </button>
        </form>
      </DisclosurePanel>
    </section>
  );
}
