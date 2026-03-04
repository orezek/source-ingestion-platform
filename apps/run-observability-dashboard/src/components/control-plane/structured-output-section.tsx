import type { StructuredOutputDestination } from '@repo/control-plane-contracts';
import { DisclosurePanel } from '@/components/control-plane/disclosure-panel';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { ResourceLifecycleActions } from '@/components/control-plane/resource-lifecycle-actions';
import {
  archiveStructuredOutputDestinationAction,
  createStructuredOutputDestinationAction,
  deleteStructuredOutputDestinationAction,
  updateStructuredOutputDestinationAction,
} from '@/app/control-plane/actions';

type StructuredOutputSectionProps = {
  structuredOutputDestinations: StructuredOutputDestination[];
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
        <DisclosurePanel
          title="Manage structured outputs"
          description="Edit reusable output choices."
        >
          <div className="resource-edit-grid">
            {structuredOutputDestinations.map((destination) => (
              <details key={destination.id} className="resource-card">
                <summary>{destination.name}</summary>
                <form action={updateStructuredOutputDestinationAction} className="control-form">
                  <input type="hidden" name="id" value={destination.id} />
                  <input type="hidden" name="type" value={destination.type} />
                  <label>
                    <span>NAME</span>
                    <input name="name" defaultValue={destination.name} required />
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
                    Downloadable JSON uses the managed platform store and is accessed through the
                    dashboard. MongoDB keeps the current automatic per-search-space database naming
                    and collection layout.
                  </p>
                  <button type="submit">Save structured output</button>
                </form>
                <ResourceLifecycleActions
                  id={destination.id}
                  archiveAction={archiveStructuredOutputDestinationAction}
                  deleteAction={deleteStructuredOutputDestinationAction}
                />
              </details>
            ))}
          </div>
        </DisclosurePanel>
      ) : null}

      <DisclosurePanel
        title="Create structured output"
        description="Create a reusable output choice."
      >
        <div className="resource-edit-grid">
          <details className="resource-card">
            <summary>Create downloadable JSON output</summary>
            <form action={createStructuredOutputDestinationAction} className="control-form">
              <input type="hidden" name="type" value="downloadable_json" />
              <label>
                <span>NAME</span>
                <input name="name" placeholder="Downloadable JSON" required />
              </label>
              <p className="empty-copy">
                Downloadable JSON is stored in a managed backend and surfaced through dashboard
                browse and download flows.
              </p>
              <button type="submit">Create downloadable JSON output</button>
            </form>
          </details>

          <details className="resource-card">
            <summary>Create MongoDB output</summary>
            <form action={createStructuredOutputDestinationAction} className="control-form">
              <input type="hidden" name="type" value="mongodb" />
              <label>
                <span>NAME</span>
                <input name="name" placeholder="MongoDB sink" required />
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
