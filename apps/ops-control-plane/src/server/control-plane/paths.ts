import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '@/server/env';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const dashboardAppRootDir = path.resolve(currentDir, '../../..');
export const repoRootDir = path.resolve(dashboardAppRootDir, '../..');

export const controlPlaneDataRootDir = path.resolve(
  dashboardAppRootDir,
  env.CONTROL_PLANE_DATA_DIR,
);
export const controlPlaneBrokerRootDir = path.resolve(
  dashboardAppRootDir,
  env.CONTROL_PLANE_BROKER_DIR,
);
export const controlPlaneWorkerLogRootDir = path.resolve(
  dashboardAppRootDir,
  env.CONTROL_PLANE_WORKER_LOG_DIR,
);
export const bootstrapSearchSpacesDir = path.resolve(
  dashboardAppRootDir,
  env.CONTROL_PLANE_BOOTSTRAP_SEARCH_SPACES_DIR,
);
export const defaultArtifactRootDir = path.resolve(
  dashboardAppRootDir,
  env.CONTROL_PLANE_DEFAULT_ARTIFACT_DIR,
);
export const defaultJsonOutputRootDir = path.resolve(
  dashboardAppRootDir,
  env.CONTROL_PLANE_DEFAULT_JSON_OUTPUT_DIR,
);
export const crawlerAppRootDir = path.join(repoRootDir, 'apps', 'jobs-crawler-actor');
export const ingestionAppRootDir = path.join(repoRootDir, 'apps', 'jobs-ingestion-service');

export const controlPlaneCollectionDirs = {
  searchSpaces: path.join(controlPlaneDataRootDir, 'search-spaces'),
  runtimeProfiles: path.join(controlPlaneDataRootDir, 'runtime-profiles'),
  structuredOutputDestinations: path.join(
    controlPlaneDataRootDir,
    'structured-output-destinations',
  ),
  pipelines: path.join(controlPlaneDataRootDir, 'pipelines'),
  runs: path.join(controlPlaneDataRootDir, 'runs'),
} as const;

export const controlPlaneLockRootDir = path.join(controlPlaneDataRootDir, '.locks');

export const buildControlPlaneRunDir = (runId: string): string =>
  path.join(controlPlaneCollectionDirs.runs, runId);

export const buildRunManifestPath = (runId: string): string =>
  path.join(buildControlPlaneRunDir(runId), 'manifest.json');

export const buildRunRecordPath = (runId: string): string =>
  path.join(buildControlPlaneRunDir(runId), 'run.json');

export const buildRunGeneratedInputPath = (runId: string): string =>
  path.join(buildControlPlaneRunDir(runId), 'input', 'INPUT.json');

export const buildRunWorkerRuntimePath = (
  runId: string,
  workerType: 'crawler' | 'ingestion',
): string => path.join(buildControlPlaneRunDir(runId), 'runtime', `${workerType}.json`);

export const buildRunWorkerLogPath = (runId: string, workerType: 'crawler' | 'ingestion'): string =>
  path.join(controlPlaneWorkerLogRootDir, `${runId}-${workerType}.log`);

export const buildPipelineStartLockDir = (pipelineId: string): string =>
  path.join(controlPlaneLockRootDir, `start-run-${pipelineId}`);
