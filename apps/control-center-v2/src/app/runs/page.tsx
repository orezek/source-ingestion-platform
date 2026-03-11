import { ControlServiceNotReachable } from '@/components/state/control-service-not-reachable';
import { RunListClient } from '@/components/runs/run-list-client';
import { listControlPlaneRunsQueryV2Schema } from '@repo/control-plane-contracts/v2';
import {
  buildControlServiceConnectivityDiagnostic,
  isControlServiceUnavailableError,
  listPipelines,
  listRuns,
} from '@/lib/control-service-client';
import type { ListControlPlaneRunsQuery } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

const RUN_STATUSES = new Set<ListControlPlaneRunsQuery['status']>([
  'queued',
  'running',
  'succeeded',
  'completed_with_errors',
  'failed',
  'stopped',
]);

const toFirstString = (value: string | string[] | undefined): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.at(0);
  }

  return undefined;
};

const parseRunsQuery = (rawSearchParams: Record<string, string | string[] | undefined>) => {
  const statusCandidate = toFirstString(rawSearchParams.status);
  const limitCandidate = toFirstString(rawSearchParams.limit);
  const parsedLimit = limitCandidate ? Number.parseInt(limitCandidate, 10) : undefined;

  return listControlPlaneRunsQueryV2Schema.parse({
    pipelineId: toFirstString(rawSearchParams.pipelineId),
    status:
      statusCandidate && RUN_STATUSES.has(statusCandidate as ListControlPlaneRunsQuery['status'])
        ? statusCandidate
        : undefined,
    source: toFirstString(rawSearchParams.source),
    limit:
      parsedLimit && Number.isInteger(parsedLimit) && parsedLimit > 0 && parsedLimit <= 200
        ? parsedLimit
        : undefined,
    cursor: toFirstString(rawSearchParams.cursor),
  });
};

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawSearchParams = await searchParams;
  const query = parseRunsQuery(rawSearchParams);

  try {
    const [runs, pipelines] = await Promise.all([listRuns(query), listPipelines()]);
    const sortedRuns = runs.items
      .slice()
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
    const sortedPipelines = pipelines.items
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return (
      <RunListClient
        initialRuns={sortedRuns}
        filters={query}
        nextCursor={runs.nextCursor}
        pipelines={sortedPipelines}
      />
    );
  } catch (error) {
    if (isControlServiceUnavailableError(error)) {
      return (
        <ControlServiceNotReachable
          diagnostic={buildControlServiceConnectivityDiagnostic(error, 'GET /v1/runs')}
        />
      );
    }

    throw error;
  }
}
