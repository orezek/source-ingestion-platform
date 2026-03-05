import { CONTROL_PLANE_NAME_MAX_LENGTH, type RuntimeProfile } from '@repo/control-plane-contracts';
import { DisclosurePanel } from '@/components/control-plane/disclosure-panel';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { ResourceLifecycleActions } from '@/components/control-plane/resource-lifecycle-actions';
import {
  createRuntimeProfileAction,
  deleteRuntimeProfileAction,
  updateRuntimeProfileAction,
} from '@/app/control-plane/actions';

type RuntimeProfileSectionProps = {
  runtimeProfiles: RuntimeProfile[];
};

export function RuntimeProfileSection({ runtimeProfiles }: RuntimeProfileSectionProps) {
  return (
    <section className="panel">
      <SectionHeading title="Runtime profiles" detail={`${runtimeProfiles.length} total`} />
      <div className="resource-compact-grid">
        {runtimeProfiles.map((profile) => (
          <article key={profile.id} className="resource-compact-card">
            <div className="resource-compact-card__header">
              <div>
                <strong>{profile.name}</strong>
                <p className="resource-card__meta">{profile.id}</p>
              </div>
              <span className="resource-status-chip">{profile.status}</span>
            </div>
            <div className="resource-spec-list">
              <div className="resource-spec-list__row">
                <span className="resource-spec-list__term">Crawler</span>
                <span className="resource-spec-list__value">
                  {profile.crawlerMaxConcurrency} • {profile.crawlerMaxRequestsPerMinute} req/min
                </span>
              </div>
              <div className="resource-spec-list__row">
                <span className="resource-spec-list__term">Ingestion</span>
                <span className="resource-spec-list__value">
                  {profile.ingestionEnabled ? profile.ingestionConcurrency : 'disabled'}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>

      {runtimeProfiles.length > 0 ? (
        <DisclosurePanel
          title="Manage runtime profiles"
          description="Edit crawler and ingestion settings."
        >
          <div className="resource-edit-grid">
            {runtimeProfiles.map((profile) => (
              <details key={profile.id} className="resource-card">
                <summary>{profile.name}</summary>
                <form action={updateRuntimeProfileAction} className="control-form">
                  <input type="hidden" name="id" value={profile.id} />
                  <label>
                    <span>NAME</span>
                    <input
                      name="name"
                      defaultValue={profile.name}
                      maxLength={CONTROL_PLANE_NAME_MAX_LENGTH}
                      required
                    />
                  </label>
                  <div className="control-form__row">
                    <label>
                      <span>CRAWLER CONCURRENCY</span>
                      <input
                        name="crawlerMaxConcurrency"
                        type="number"
                        min="1"
                        defaultValue={profile.crawlerMaxConcurrency}
                        required
                      />
                    </label>
                    <label>
                      <span>REQ/MIN</span>
                      <input
                        name="crawlerMaxRequestsPerMinute"
                        type="number"
                        min="1"
                        defaultValue={profile.crawlerMaxRequestsPerMinute}
                        required
                      />
                    </label>
                    <label>
                      <span>INGESTION CONCURRENCY</span>
                      <input
                        name="ingestionConcurrency"
                        type="number"
                        min="1"
                        defaultValue={profile.ingestionConcurrency}
                        required
                      />
                    </label>
                  </div>
                  <label className="checkbox-row">
                    <input
                      name="ingestionEnabled"
                      type="checkbox"
                      defaultChecked={profile.ingestionEnabled}
                    />
                    <span>Enable ingestion</span>
                  </label>
                  <label className="checkbox-row">
                    <input name="debugLog" type="checkbox" defaultChecked={profile.debugLog} />
                    <span>Enable verbose crawler logging</span>
                  </label>
                  <button type="submit">Save runtime profile</button>
                </form>
                <ResourceLifecycleActions
                  id={profile.id}
                  deleteAction={deleteRuntimeProfileAction}
                />
              </details>
            ))}
          </div>
        </DisclosurePanel>
      ) : null}

      <DisclosurePanel title="Create runtime profile" description="Create a runtime profile.">
        <form action={createRuntimeProfileAction} className="control-form">
          <label>
            <span>NAME</span>
            <input
              name="name"
              maxLength={CONTROL_PLANE_NAME_MAX_LENGTH}
              placeholder="Daily local crawl"
              required
            />
          </label>
          <div className="control-form__row">
            <label>
              <span>CRAWLER CONCURRENCY</span>
              <input name="crawlerMaxConcurrency" type="number" min="1" defaultValue="1" required />
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
              <input name="ingestionConcurrency" type="number" min="1" defaultValue="1" required />
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
      </DisclosurePanel>
    </section>
  );
}
