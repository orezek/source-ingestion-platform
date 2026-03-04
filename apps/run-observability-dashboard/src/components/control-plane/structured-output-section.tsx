import {
  CONTROL_PLANE_NAME_MAX_LENGTH,
  type Pipeline,
  type StructuredOutputDestination,
} from '@repo/control-plane-contracts';
import { DisclosurePanel } from '@/components/control-plane/disclosure-panel';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { ResourceLifecycleActions } from '@/components/control-plane/resource-lifecycle-actions';
import {
  createStructuredOutputDestinationAction,
  deleteStructuredOutputDestinationAction,
  updateStructuredOutputDestinationAction,
} from '@/app/control-plane/actions';

type StructuredOutputSectionProps = {
  structuredOutputDestinations: StructuredOutputDestination[];
  pipelines: Pipeline[];
};

function getStructuredOutputTypeLabel(type: StructuredOutputDestination['type']): string {
  return type === 'downloadable_json' ? 'Downloadable JSON' : 'MongoDB';
}

function describeStructuredOutputConfig(destination: StructuredOutputDestination): string {
  if (destination.type === 'downloadable_json') {
    return 'Managed dashboard download';
  }

  return destination.config.connectionUri || 'env:MONGODB_URI';
}

export function StructuredOutputSection({
  structuredOutputDestinations,
  pipelines,
}: StructuredOutputSectionProps) {
  return (
    <section className="panel">
      <SectionHeading
        title="Structured outputs"
        detail={`${structuredOutputDestinations.length} total`}
      />
      <div className="resource-compact-grid">
        {structuredOutputDestinations.map((destination) => (
          <article key={destination.id} className="resource-compact-card">
            <div className="resource-compact-card__header">
              <div>
                <strong>{destination.name}</strong>
                <p className="resource-card__meta">{destination.id}</p>
              </div>
              <span className="resource-status-chip">{destination.status}</span>
            </div>
            <dl className="resource-spec-list">
              <div className="resource-spec-list__row">
                <dt>Type</dt>
                <dd>{getStructuredOutputTypeLabel(destination.type)}</dd>
              </div>
              <div className="resource-spec-list__row">
                <dt>Target</dt>
                <dd>{describeStructuredOutputConfig(destination)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      {structuredOutputDestinations.length > 0 ? (
        <DisclosurePanel title="Manage structured outputs" description="Edit managed add-on sinks.">
          <div className="resource-edit-grid">
            {structuredOutputDestinations.map((destination) => {
              const referencingPipelineCount = pipelines.filter((pipeline) =>
                pipeline.structuredOutputDestinationIds.includes(destination.id),
              ).length;

              return (
                <details key={destination.id} className="resource-card">
                  <summary>{destination.name}</summary>
                  <form action={updateStructuredOutputDestinationAction} className="control-form">
                    <input type="hidden" name="id" value={destination.id} />
                    <input type="hidden" name="type" value={destination.type} />
                    <label>
                      <span>NAME</span>
                      <input
                        name="name"
                        defaultValue={destination.name}
                        maxLength={CONTROL_PLANE_NAME_MAX_LENGTH}
                        required
                      />
                    </label>
                    <label>
                      <span>TYPE</span>
                      <input value={getStructuredOutputTypeLabel(destination.type)} disabled />
                    </label>
                    {destination.type === 'mongodb' ? (
                      <label>
                        <span>MONGODB CONNECTION URI</span>
                        <input
                          name="connectionUri"
                          defaultValue={destination.config.connectionUri ?? 'env:MONGODB_URI'}
                        />
                      </label>
                    ) : null}
                    <p className="empty-copy">
                      Managed structured outputs are add-on sinks. Downloadable JSON is built in and
                      selected directly on pipelines.
                    </p>
                    <button type="submit">Save structured output</button>
                  </form>
                  <ResourceLifecycleActions
                    id={destination.id}
                    deleteAction={deleteStructuredOutputDestinationAction}
                    deleteDisabledReason={
                      referencingPipelineCount > 0
                        ? `Used by ${referencingPipelineCount} pipeline${
                            referencingPipelineCount === 1 ? '' : 's'
                          }. Remove it from pipelines before deleting.`
                        : undefined
                    }
                  />
                </details>
              );
            })}
          </div>
        </DisclosurePanel>
      ) : null}

      <DisclosurePanel title="Create structured output" description="Create a managed add-on sink.">
        <div className="resource-edit-grid">
          <details className="resource-card">
            <summary>Create MongoDB output</summary>
            <form action={createStructuredOutputDestinationAction} className="control-form">
              <input type="hidden" name="type" value="mongodb" />
              <label>
                <span>NAME</span>
                <input
                  name="name"
                  maxLength={CONTROL_PLANE_NAME_MAX_LENGTH}
                  placeholder="MongoDB sink"
                  required
                />
              </label>
              <label>
                <span>MONGODB CONNECTION URI</span>
                <input name="connectionUri" defaultValue="env:MONGODB_URI" />
              </label>
              <p className="empty-copy">
                MongoDB keeps the current automatic per-search-space database naming and collection
                layout in V1.
              </p>
              <button type="submit">Create MongoDB output</button>
            </form>
          </details>
        </div>
      </DisclosurePanel>
    </section>
  );
}
