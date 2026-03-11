import { ControlServiceNotReachable } from '@/components/state/control-service-not-reachable';
import { PipelineListClient } from '@/components/pipelines/pipeline-list-client';
import {
  buildControlServiceConnectivityDiagnostic,
  isControlServiceUnavailableError,
  listPipelines,
} from '@/lib/control-service-client';

export const dynamic = 'force-dynamic';

export default async function PipelinesPage() {
  try {
    const response = await listPipelines();
    const pipelines = response.items
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return (
      <div className="min-w-0 overflow-hidden">
        <PipelineListClient pipelines={pipelines} />
      </div>
    );
  } catch (error) {
    if (isControlServiceUnavailableError(error)) {
      return (
        <ControlServiceNotReachable
          diagnostic={buildControlServiceConnectivityDiagnostic(error, 'GET /v1/pipelines')}
        />
      );
    }

    throw error;
  }
}
