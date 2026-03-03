import { randomUUID } from 'node:crypto';
import type {
  ArtifactDestination,
  ControlPlaneRun,
  CreateArtifactDestinationInput,
  CreatePipelineInput,
  CreateRuntimeProfileInput,
  CreateSearchSpaceInput,
  CreateStructuredOutputDestinationInput,
  Pipeline,
  RunManifest,
  SearchSpace,
  StartRunRequest,
  StructuredOutputDestination,
  RuntimeProfile,
} from '@repo/control-plane-contracts';
import {
  buildRecordId,
  createArtifactDestinationInputSchema,
  createPipelineInputSchema,
  createRuntimeProfileInputSchema,
  createSearchSpaceInputSchema,
  createStructuredOutputDestinationInputSchema,
  nowIso,
  pipelineSchema,
  runManifestSchema,
  searchSpaceSchema,
  startRunRequestSchema,
} from '@repo/control-plane-contracts';
import { env } from '@/server/env';
import { ensureControlPlaneBootstrap } from '@/server/control-plane/bootstrap';
import {
  buildRunGeneratedInputPath,
  buildRunManifestPath,
  buildRunRecordPath,
  controlPlaneBrokerRootDir,
} from '@/server/control-plane/paths';
import { executeRun, writeGeneratedActorInput } from '@/server/control-plane/execution';
import {
  type WorkerRuntime,
  getArtifactDestination,
  getPipeline,
  getRunManifest,
  getRunRecord,
  getRuntimeProfile,
  getSearchSpace,
  getStructuredOutputDestination,
  getWorkerRuntime,
  listArtifactDestinations,
  listPipelines,
  listRunRecords,
  listRuntimeProfiles,
  listSearchSpaces,
  listStructuredOutputDestinations,
  writeArtifactDestination,
  writePipeline,
  writeRunManifest,
  writeRunRecord,
  writeRuntimeProfile,
  writeSearchSpace,
  writeStructuredOutputDestination,
} from '@/server/control-plane/store';

export type ControlPlaneRunView = {
  run: ControlPlaneRun;
  manifest: RunManifest | null;
  crawlerRuntime: WorkerRuntime | null;
  ingestionRuntime: WorkerRuntime | null;
  computedStatus: ControlPlaneRun['status'];
};

export type ControlPlaneOverview = {
  searchSpaces: SearchSpace[];
  runtimeProfiles: RuntimeProfile[];
  artifactDestinations: ArtifactDestination[];
  structuredOutputDestinations: StructuredOutputDestination[];
  pipelines: Pipeline[];
  runs: ControlPlaneRunView[];
};

function deriveComputedStatus(input: {
  run: ControlPlaneRun;
  manifest: RunManifest | null;
  crawlerRuntime: WorkerRuntime | null;
  ingestionRuntime: WorkerRuntime | null;
}): ControlPlaneRun['status'] {
  const { run, manifest, crawlerRuntime, ingestionRuntime } = input;
  if (!crawlerRuntime) {
    return run.status;
  }

  if (crawlerRuntime.status === 'failed' || crawlerRuntime.status === 'stopped') {
    return crawlerRuntime.status;
  }

  const ingestionEnabled =
    manifest?.mode === 'crawl_and_ingest' && manifest.runtimeProfileSnapshot.ingestionEnabled;

  if (!ingestionEnabled) {
    return crawlerRuntime.status;
  }

  if (!ingestionRuntime) {
    return crawlerRuntime.status === 'succeeded' ? 'running' : crawlerRuntime.status;
  }

  if (ingestionRuntime.status === 'failed' || ingestionRuntime.status === 'stopped') {
    return ingestionRuntime.status;
  }

  if (crawlerRuntime.status === 'running' || ingestionRuntime.status === 'running') {
    return 'running';
  }

  if (
    crawlerRuntime.status === 'completed_with_errors' ||
    ingestionRuntime.status === 'completed_with_errors'
  ) {
    return 'completed_with_errors';
  }

  return crawlerRuntime.status === 'succeeded' && ingestionRuntime.status === 'succeeded'
    ? 'succeeded'
    : run.status;
}

async function getPipelineDependencies(pipeline: Pipeline): Promise<{
  searchSpace: SearchSpace;
  runtimeProfile: RuntimeProfile;
  artifactDestination: ArtifactDestination;
  structuredOutputDestinations: StructuredOutputDestination[];
}> {
  const [searchSpace, runtimeProfile, artifactDestination, structuredOutputDestinations] =
    await Promise.all([
      getSearchSpace(pipeline.searchSpaceId),
      getRuntimeProfile(pipeline.runtimeProfileId),
      getArtifactDestination(pipeline.artifactDestinationId),
      Promise.all(
        pipeline.structuredOutputDestinationIds.map((destinationId) =>
          getStructuredOutputDestination(destinationId),
        ),
      ),
    ]);

  if (!searchSpace) {
    throw new Error(`Unknown search space "${pipeline.searchSpaceId}".`);
  }

  if (!runtimeProfile) {
    throw new Error(`Unknown runtime profile "${pipeline.runtimeProfileId}".`);
  }

  if (!artifactDestination) {
    throw new Error(`Unknown artifact destination "${pipeline.artifactDestinationId}".`);
  }

  const missingStructuredOutput = structuredOutputDestinations.find((item) => item === null);
  if (missingStructuredOutput) {
    throw new Error(`Pipeline "${pipeline.id}" references an unknown structured output.`);
  }

  return {
    searchSpace,
    runtimeProfile,
    artifactDestination,
    structuredOutputDestinations: structuredOutputDestinations.filter(
      (item): item is StructuredOutputDestination => item !== null,
    ),
  };
}

function buildRunManifest(input: {
  runId: string;
  pipeline: Pipeline;
  searchSpace: SearchSpace;
  runtimeProfile: RuntimeProfile;
  artifactDestination: ArtifactDestination;
  structuredOutputDestinations: StructuredOutputDestination[];
  createdBy: string;
}): RunManifest {
  return runManifestSchema.parse({
    runId: input.runId,
    pipelineId: input.pipeline.id,
    pipelineVersion: input.pipeline.version,
    sourceType: input.searchSpace.sourceType,
    mode: input.pipeline.mode,
    searchSpaceSnapshot: {
      id: input.searchSpace.id,
      name: input.searchSpace.name,
      sourceType: input.searchSpace.sourceType,
      startUrls: input.searchSpace.startUrls,
      maxItemsDefault: input.searchSpace.maxItemsDefault,
      maxConcurrencyDefault: input.searchSpace.maxConcurrencyDefault,
      maxRequestsPerMinuteDefault: input.searchSpace.maxRequestsPerMinuteDefault,
      allowInactiveMarkingOnPartialRuns: input.searchSpace.allowInactiveMarkingOnPartialRuns,
      version: input.searchSpace.version,
    },
    runtimeProfileSnapshot: {
      id: input.runtimeProfile.id,
      name: input.runtimeProfile.name,
      crawlerMaxConcurrency: input.runtimeProfile.crawlerMaxConcurrency,
      crawlerMaxRequestsPerMinute: input.runtimeProfile.crawlerMaxRequestsPerMinute,
      ingestionConcurrency: input.runtimeProfile.ingestionConcurrency,
      ingestionEnabled: input.runtimeProfile.ingestionEnabled,
      debugLog: input.runtimeProfile.debugLog,
    },
    artifactDestinationSnapshot: {
      id: input.artifactDestination.id,
      name: input.artifactDestination.name,
      type: input.artifactDestination.type,
      config: input.artifactDestination.config,
    },
    structuredOutputDestinationSnapshots: input.structuredOutputDestinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      type: destination.type,
      config: destination.config,
    })),
    createdAt: nowIso(),
    createdBy: input.createdBy,
  });
}

async function buildRunView(run: ControlPlaneRun): Promise<ControlPlaneRunView> {
  const [manifest, crawlerRuntime, ingestionRuntime] = await Promise.all([
    getRunManifest(run.runId),
    getWorkerRuntime(run.runId, 'crawler'),
    getWorkerRuntime(run.runId, 'ingestion'),
  ]);

  return {
    run,
    manifest,
    crawlerRuntime,
    ingestionRuntime,
    computedStatus: deriveComputedStatus({
      run,
      manifest,
      crawlerRuntime,
      ingestionRuntime,
    }),
  };
}

export async function getControlPlaneOverview(): Promise<ControlPlaneOverview> {
  await ensureControlPlaneBootstrap();
  const [
    searchSpaces,
    runtimeProfiles,
    artifactDestinations,
    structuredOutputDestinations,
    pipelines,
    runs,
  ] = await Promise.all([
    listSearchSpaces(),
    listRuntimeProfiles(),
    listArtifactDestinations(),
    listStructuredOutputDestinations(),
    listPipelines(),
    listRunRecords(),
  ]);

  const runViews = await Promise.all(runs.map((run) => buildRunView(run)));

  return {
    searchSpaces: searchSpaces.sort((left, right) => left.name.localeCompare(right.name)),
    runtimeProfiles: runtimeProfiles.sort((left, right) => left.name.localeCompare(right.name)),
    artifactDestinations: artifactDestinations.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    structuredOutputDestinations: structuredOutputDestinations.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    pipelines: pipelines.sort((left, right) => left.name.localeCompare(right.name)),
    runs: runViews.sort((left, right) => right.run.requestedAt.localeCompare(left.run.requestedAt)),
  };
}

export async function createSearchSpace(rawInput: CreateSearchSpaceInput): Promise<SearchSpace> {
  await ensureControlPlaneBootstrap();
  const input = createSearchSpaceInputSchema.parse(rawInput);
  const timestamp = nowIso();
  const id = buildRecordId(input.id ?? input.name);
  const record = searchSpaceSchema.parse({
    id,
    name: input.name,
    description: input.description,
    sourceType: input.sourceType,
    startUrls: input.startUrls,
    maxItemsDefault: input.maxItemsDefault,
    maxConcurrencyDefault: input.maxConcurrencyDefault,
    maxRequestsPerMinuteDefault: input.maxRequestsPerMinuteDefault,
    allowInactiveMarkingOnPartialRuns: input.allowInactiveMarkingOnPartialRuns,
    status: input.status,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return writeSearchSpace(record);
}

export async function createRuntimeProfile(
  rawInput: CreateRuntimeProfileInput,
): Promise<RuntimeProfile> {
  await ensureControlPlaneBootstrap();
  const input = createRuntimeProfileInputSchema.parse(rawInput);
  const timestamp = nowIso();
  return writeRuntimeProfile({
    id: buildRecordId(input.id ?? input.name),
    name: input.name,
    crawlerMaxConcurrency: input.crawlerMaxConcurrency,
    crawlerMaxRequestsPerMinute: input.crawlerMaxRequestsPerMinute,
    ingestionConcurrency: input.ingestionConcurrency,
    ingestionEnabled: input.ingestionEnabled,
    debugLog: input.debugLog,
    status: input.status,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function createArtifactDestination(
  rawInput: CreateArtifactDestinationInput,
): Promise<ArtifactDestination> {
  await ensureControlPlaneBootstrap();
  const input = createArtifactDestinationInputSchema.parse(rawInput);
  const timestamp = nowIso();
  const id = buildRecordId(input.id ?? input.name);

  if (input.type === 'local_filesystem') {
    return writeArtifactDestination({
      id,
      name: input.name,
      type: 'local_filesystem',
      config: input.config,
      status: input.status,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  return writeArtifactDestination({
    id,
    name: input.name,
    type: 'gcs',
    config: input.config,
    status: input.status,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function createStructuredOutputDestination(
  rawInput: CreateStructuredOutputDestinationInput,
): Promise<StructuredOutputDestination> {
  await ensureControlPlaneBootstrap();
  const input = createStructuredOutputDestinationInputSchema.parse(rawInput);
  const timestamp = nowIso();
  const id = buildRecordId(input.id ?? input.name);

  if (input.type === 'mongodb') {
    return writeStructuredOutputDestination({
      id,
      name: input.name,
      type: 'mongodb',
      config: input.config,
      status: input.status,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  if (input.type === 'local_json') {
    return writeStructuredOutputDestination({
      id,
      name: input.name,
      type: 'local_json',
      config: input.config,
      status: input.status,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  return writeStructuredOutputDestination({
    id,
    name: input.name,
    type: 'gcs_json',
    config: input.config,
    status: input.status,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function createPipeline(rawInput: CreatePipelineInput): Promise<Pipeline> {
  await ensureControlPlaneBootstrap();
  const input = createPipelineInputSchema.parse(rawInput);
  const [searchSpace, runtimeProfile, artifactDestination] = await Promise.all([
    getSearchSpace(input.searchSpaceId),
    getRuntimeProfile(input.runtimeProfileId),
    getArtifactDestination(input.artifactDestinationId),
  ]);

  if (!searchSpace) {
    throw new Error(`Unknown search space "${input.searchSpaceId}".`);
  }

  if (!runtimeProfile) {
    throw new Error(`Unknown runtime profile "${input.runtimeProfileId}".`);
  }

  if (!artifactDestination) {
    throw new Error(`Unknown artifact destination "${input.artifactDestinationId}".`);
  }

  const structuredOutputDestinations = await Promise.all(
    input.structuredOutputDestinationIds.map((destinationId) =>
      getStructuredOutputDestination(destinationId),
    ),
  );
  const missingDestination = structuredOutputDestinations.find((item) => item === null);
  if (missingDestination) {
    throw new Error('One or more structured output destinations do not exist.');
  }

  const timestamp = nowIso();
  return writePipeline(
    pipelineSchema.parse({
      id: buildRecordId(input.id ?? input.name),
      name: input.name,
      searchSpaceId: input.searchSpaceId,
      runtimeProfileId: input.runtimeProfileId,
      artifactDestinationId: input.artifactDestinationId,
      structuredOutputDestinationIds: input.structuredOutputDestinationIds,
      mode: input.mode,
      status: input.status,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
}

export async function startRun(rawInput: StartRunRequest): Promise<ControlPlaneRunView> {
  await ensureControlPlaneBootstrap();
  const input = startRunRequestSchema.parse(rawInput);
  const pipeline = await getPipeline(input.pipelineId);
  if (!pipeline) {
    throw new Error(`Unknown pipeline "${input.pipelineId}".`);
  }

  const dependencies = await getPipelineDependencies(pipeline);
  const runId = `crawl-run-${randomUUID().slice(0, 12)}`;
  const manifest = buildRunManifest({
    runId,
    pipeline,
    searchSpace: dependencies.searchSpace,
    runtimeProfile: dependencies.runtimeProfile,
    artifactDestination: dependencies.artifactDestination,
    structuredOutputDestinations: dependencies.structuredOutputDestinations,
    createdBy: input.createdBy,
  });

  const generatedInputPath = buildRunGeneratedInputPath(runId);
  const runRecord = await writeRunRecord({
    runId,
    pipelineId: pipeline.id,
    pipelineVersion: pipeline.version,
    status: 'running',
    requestedAt: nowIso(),
    startedAt: nowIso(),
    stopReason: null,
    summary: {
      manifestPath: buildRunManifestPath(runId),
      runRecordPath: buildRunRecordPath(runId),
      generatedInputPath,
      brokerRootDir: controlPlaneBrokerRootDir,
      executionMode: env.CONTROL_PLANE_EXECUTION_MODE,
      mode: pipeline.mode,
    },
  });

  await writeRunManifest(manifest);
  await writeGeneratedActorInput(manifest, generatedInputPath);
  await executeRun({
    run: runRecord,
    manifest,
  });

  const updatedRun = (await getRunRecord(runId)) ?? runRecord;
  return buildRunView(updatedRun);
}
