import { CONTROL_PLANE_NAME_MAX_LENGTH, type SearchSpace } from '@repo/control-plane-contracts';
import { DisclosurePanel } from '@/components/control-plane/disclosure-panel';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { ResourceLifecycleActions } from '@/components/control-plane/resource-lifecycle-actions';
import {
  createSearchSpaceAction,
  deleteSearchSpaceAction,
  updateSearchSpaceAction,
} from '@/app/control-plane/actions';

type SearchSpaceSectionProps = {
  searchSpaces: SearchSpace[];
};

export function SearchSpaceSection({ searchSpaces }: SearchSpaceSectionProps) {
  return (
    <section className="panel">
      <SectionHeading title="Search spaces" detail={`${searchSpaces.length} total`} />
      <div className="resource-compact-grid">
        {searchSpaces.map((searchSpace) => (
          <article key={searchSpace.id} className="resource-compact-card">
            <div className="resource-compact-card__header">
              <div>
                <strong>{searchSpace.name}</strong>
                <p className="resource-card__meta">{searchSpace.id}</p>
              </div>
              <span className="resource-status-chip">{searchSpace.status}</span>
            </div>
            <div className="resource-spec-list">
              <div className="resource-spec-list__row">
                <span className="resource-spec-list__term">Start URLs</span>
                <span className="resource-spec-list__value">
                  {searchSpace.startUrls.length} URL{searchSpace.startUrls.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="resource-spec-list__row">
                <span className="resource-spec-list__term">Max items</span>
                <span className="resource-spec-list__value">{searchSpace.maxItemsDefault}</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      {searchSpaces.length > 0 ? (
        <DisclosurePanel title="Manage search spaces" description="Edit or retire a search space.">
          <div className="resource-edit-grid">
            {searchSpaces.map((searchSpace) => (
              <details key={searchSpace.id} className="resource-card">
                <summary>{searchSpace.name}</summary>
                <form action={updateSearchSpaceAction} className="control-form">
                  <input type="hidden" name="id" value={searchSpace.id} />
                  <label>
                    <span>NAME</span>
                    <input
                      name="name"
                      defaultValue={searchSpace.name}
                      maxLength={CONTROL_PLANE_NAME_MAX_LENGTH}
                      required
                    />
                  </label>
                  <label>
                    <span>DESCRIPTION</span>
                    <textarea name="description" rows={3} defaultValue={searchSpace.description} />
                  </label>
                  <label>
                    <span>START URLS</span>
                    <textarea
                      name="startUrls"
                      rows={4}
                      defaultValue={searchSpace.startUrls.join('\n')}
                      required
                    />
                  </label>
                  <div className="control-form__row">
                    <label>
                      <span>MAX ITEMS</span>
                      <input
                        name="maxItemsDefault"
                        type="number"
                        min="1"
                        defaultValue={searchSpace.maxItemsDefault}
                        required
                      />
                    </label>
                  </div>
                  <label className="checkbox-row">
                    <input
                      name="allowInactiveMarkingOnPartialRuns"
                      type="checkbox"
                      defaultChecked={searchSpace.allowInactiveMarkingOnPartialRuns}
                    />
                    <span>Allow inactive marking on partial runs</span>
                  </label>
                  <button type="submit">Save search space</button>
                </form>
                <ResourceLifecycleActions
                  id={searchSpace.id}
                  deleteAction={deleteSearchSpaceAction}
                />
              </details>
            ))}
          </div>
        </DisclosurePanel>
      ) : null}

      <DisclosurePanel title="Create search space" description="Create a list-page crawl target.">
        <form action={createSearchSpaceAction} className="control-form">
          <label>
            <span>NAME</span>
            <input
              name="name"
              maxLength={CONTROL_PLANE_NAME_MAX_LENGTH}
              placeholder="Prague backend daily"
              required
            />
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
          </div>
          <label className="checkbox-row">
            <input name="allowInactiveMarkingOnPartialRuns" type="checkbox" />
            <span>Allow inactive marking on partial runs</span>
          </label>
          <button type="submit">Create search space</button>
        </form>
      </DisclosurePanel>
    </section>
  );
}
