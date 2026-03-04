import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { ControlPlaneCommandDeck } from '@/components/control-plane/control-plane-command-deck';
import { ControlPlaneRunsSection } from '@/components/control-plane/control-plane-runs-section';
import { SearchSpaceSection } from '@/components/control-plane/search-space-section';
import { RuntimeProfileSection } from '@/components/control-plane/runtime-profile-section';
import { StructuredOutputSection } from '@/components/control-plane/structured-output-section';
import { PipelineSection } from '@/components/control-plane/pipeline-section';
import { env } from '@/server/env';
import { getControlPlaneOverview } from '@/server/control-plane/service';

export const dynamic = 'force-dynamic';

export default async function ControlPlanePage() {
  const overview = await getControlPlaneOverview();
  const activeRuns = overview.runs.filter(
    (runView) => runView.computedStatus === 'queued' || runView.computedStatus === 'running',
  );
  const latestRun = overview.runs[0];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Control plane"
        title="Operator surface"
        description="Launch runs, inspect current execution state, and maintain the reusable pipeline resources behind the dashboard."
        environmentLabel={`CONTROL ${env.CONTROL_PLANE_EXECUTION_MODE.toUpperCase()}`}
        databaseName={env.MONGODB_DB_NAME}
        generatedAt={latestRun?.run.requestedAt}
        latestCrawlerStatus={latestRun?.crawlerRuntime?.status ?? null}
        latestIngestionStatus={latestRun?.ingestionRuntime?.status ?? null}
        showControlPlaneLink={false}
        actions={[{ href: '/', label: 'Operational dashboard', variant: 'ghost' }]}
        summaryItems={[
          {
            label: 'Active runs',
            value: activeRuns.length,
            detail: activeRuns.length === 1 ? 'Pipeline in flight' : 'Pipelines in flight',
          },
          {
            label: 'Pipelines',
            value: overview.pipelines.length,
          },
          {
            label: 'Search spaces',
            value: overview.searchSpaces.length,
          },
          {
            label: 'Outputs',
            value: overview.structuredOutputDestinations.length,
          },
        ]}
      />

      <section className="control-band">
        <div className="control-band__header">
          <h2>Operate</h2>
        </div>
        <ControlPlaneCommandDeck
          runs={overview.runs}
          pipelines={overview.pipelines}
          executionMode={env.CONTROL_PLANE_EXECUTION_MODE}
          brokerBackend={env.CONTROL_PLANE_BROKER_BACKEND}
          brokerDir={env.CONTROL_PLANE_BROKER_DIR}
          dataDir={env.CONTROL_PLANE_DATA_DIR}
          databaseName={env.MONGODB_DB_NAME}
          brokerTopic={
            env.CONTROL_PLANE_BROKER_BACKEND === 'gcp_pubsub'
              ? env.CONTROL_PLANE_GCP_PUBSUB_TOPIC
              : undefined
          }
        />
        <ControlPlaneRunsSection runs={overview.runs} pipelines={overview.pipelines} />
      </section>

      <section className="control-band">
        <div className="control-band__header">
          <h2>Pipelines</h2>
        </div>
        <PipelineSection
          pipelines={overview.pipelines}
          searchSpaces={overview.searchSpaces}
          runtimeProfiles={overview.runtimeProfiles}
          structuredOutputDestinations={overview.structuredOutputDestinations}
        />
      </section>

      <section className="control-band">
        <div className="control-band__header">
          <h2>Setup</h2>
        </div>
        <section className="control-grid control-grid--triple">
          <SearchSpaceSection searchSpaces={overview.searchSpaces} />
          <RuntimeProfileSection runtimeProfiles={overview.runtimeProfiles} />
          <StructuredOutputSection
            structuredOutputDestinations={overview.structuredOutputDestinations}
          />
        </section>
      </section>
    </AppShell>
  );
}
