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
        eyebrow="Outputs"
        title="Structured outputs"
        description="Choose operator-facing delivery targets. Storage backends stay managed by the platform."
        detail={`${structuredOutputDestinations.length} total`}
      />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>TYPE</th>
              <th>CONFIG</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {structuredOutputDestinations.map((destination) => (
              <tr key={destination.id}>
                <td>{destination.id}</td>
                <td>{getStructuredOutputTypeLabel(destination.type)}</td>
                <td>{describeStructuredOutputConfig(destination)}</td>
                <td>{destination.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {structuredOutputDestinations.length > 0 ? (
        <DisclosurePanel
          title="Manage structured outputs"
          description="Expand to edit reusable output choices for normalized results."
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
        description="Register reusable output choices without exposing bucket, prefix, or local path settings in the operator UI."
      >
        <div className="resource-edit-grid">
          <form
            action={createStructuredOutputDestinationAction}
            className="control-form resource-card"
          >
            <input type="hidden" name="type" value="downloadable_json" />
            <label>
              <span>NAME</span>
              <input name="name" placeholder="Downloadable JSON" required />
            </label>
            <p className="empty-copy">
              Downloadable JSON is stored in a managed backend and surfaced through dashboard browse
              and download flows.
            </p>
            <button type="submit">Create downloadable JSON output</button>
          </form>

          <form
            action={createStructuredOutputDestinationAction}
            className="control-form resource-card"
          >
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
        </div>
      </DisclosurePanel>
    </section>
  );
}
