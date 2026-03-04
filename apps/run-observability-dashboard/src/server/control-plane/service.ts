import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import type {
  BrokerEvent,
  ControlPlaneRun,
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
  createPipelineInputSchema,
  createRuntimeProfileInputSchema,
  createSearchSpaceInputSchema,
  createStructuredOutputDestinationInputSchema,
  nowIso,
  pipelineSchema,
  readBrokerEvents,
  runManifestSchema,
  searchSpaceSchema,
  startRunRequestSchema,
} from '@repo/control-plane-contracts';
import { env } from '@/server/env';
import {
  buildArtifactCaptures,
  type ControlPlaneArtifactCapture,
} from '@/server/control-plane/artifacts';
import {
  buildStructuredOutputCaptures,
  type ControlPlaneStructuredOutputCapture,
} from '@/server/control-plane/outputs';
import { ensureControlPlaneBootstrap } from '@/server/control-plane/bootstrap';
import {
  readOptionalTextPreview,
  readTextPreview,
  type ControlPlaneFilePreview,
} from '@/server/control-plane/file-previews';
import {
  buildPipelineStartLockDir,
  buildRunGeneratedInputPath,
  buildRunManifestPath,
  buildRunRecordPath,
  controlPlaneBrokerRootDir,
  controlPlaneLockRootDir,
} from '@/server/control-plane/paths';
import {
  assertExecutableRunPrerequisites,
  executeRun,
  writeGeneratedActorInput,
} from '@/server/control-plane/execution';
import {
  buildManagedArtifactStorageSnapshot,
  buildManagedDownloadableJsonDeliveryConfig,
} from '@/server/control-plane/managed-storage';
import {
  type WorkerRuntime,
  deleteCollectionRecord,
  getPipeline,
  getRunManifest,
  getRunRecord,
  getRuntimeProfile,
  getSearchSpace,
  getStructuredOutputDestination,
  getWorkerRuntime,
  listPipelines,
  listRunRecords,
  listRuntimeProfiles,
  listSearchSpaces,
  listStructuredOutputDestinations,
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

export type ControlPlaneRunDetail = {
  runView: ControlPlaneRunView;
  pipeline: Pipeline | null;
  generatedInput: ControlPlaneFilePreview;
  crawlerLog: ControlPlaneFilePreview | null;
  ingestionLog: ControlPlaneFilePreview | null;
  brokerEvents: BrokerEvent[];
  artifactCaptures: ControlPlaneArtifactCapture[];
  structuredOutputCaptures: ControlPlaneStructuredOutputCapture[];
  mongoDatabaseName: string | null;
};

export type ControlPlaneOverview = {
  searchSpaces: SearchSpace[];
  runtimeProfiles: RuntimeProfile[];
  structuredOutputDestinations: StructuredOutputDestination[];
  pipelines: Pipeline[];
  runs: ControlPlaneRunView[];
};

const activeRunStatuses = new Set<ControlPlaneRun['status']>(['queued', 'running']);

function isActiveRunStatus(status: ControlPlaneRun['status']): boolean {
  return activeRunStatuses.has(status);
}

function compareRunsByRequestedAtDesc(
  left: ControlPlaneRunView,
  right: ControlPlaneRunView,
): number {
  return right.run.requestedAt.localeCompare(left.run.requestedAt);
}

function deriveMongoDatabaseName(manifest: RunManifest | null): string | null {
  if (!manifest) {
    return null;
  }

  const hasMongoSink = manifest.structuredOutputDestinationSnapshots.some(
    (destination) => destination.type === 'mongodb',
  );

  if (!hasMongoSink) {
    return null;
  }

  return `${env.JOB_COMPASS_DB_PREFIX}-${manifest.searchSpaceSnapshot.id}`;
}

function assertRecordIsActive(
  record:
    | { id: string; status: 'draft' | 'active' | 'archived' }
    | { id: string; status: 'active' | 'archived' },
  label: string,
): void {
  if (record.status !== 'active') {
    throw new Error(`${label} "${record.id}" is not active.`);
  }
}

function assertPipelineOutputModeConsistency(input: {
  mode: Pipeline['mode'];
  structuredOutputDestinationIds: string[];
}): void {
  if (input.mode === 'crawl_and_ingest' && input.structuredOutputDestinationIds.length === 0) {
    throw new Error('crawl_and_ingest pipelines must select at least one structured output.');
  }
}

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
  structuredOutputDestinations: StructuredOutputDestination[];
}> {
  const [searchSpace, runtimeProfile, structuredOutputDestinations] = await Promise.all([
    getSearchSpace(pipeline.searchSpaceId),
    getRuntimeProfile(pipeline.runtimeProfileId),
    Promise.all(
      pipeline.structuredOutputDestinationIds.map((destinationId) =>
        getStructuredOutputDestination(destinationId),
      ),
    ),
  ]);

  if (!searchSpace) {
    throw new Error(`Unknown search space "${pipeline.searchSpaceId}".`);
  }
  assertRecordIsActive(searchSpace, 'Search space');

  if (!runtimeProfile) {
    throw new Error(`Unknown runtime profile "${pipeline.runtimeProfileId}".`);
  }
  assertRecordIsActive(runtimeProfile, 'Runtime profile');

  const missingStructuredOutput = structuredOutputDestinations.find((item) => item === null);
  if (missingStructuredOutput) {
    throw new Error(`Pipeline "${pipeline.id}" references an unknown structured output.`);
  }

  for (const destination of structuredOutputDestinations) {
    if (destination) {
      assertRecordIsActive(destination, 'Structured output destination');
    }
  }

  return {
    searchSpace,
    runtimeProfile,
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
    artifactStorageSnapshot: buildManagedArtifactStorageSnapshot(),
    structuredOutputDestinationSnapshots: input.structuredOutputDestinations.map((destination) =>
      destination.type === 'downloadable_json'
        ? {
            id: destination.id,
            name: destination.name,
            type: 'downloadable_json' as const,
            config: buildManagedDownloadableJsonDeliveryConfig(),
          }
        : {
            id: destination.id,
            name: destination.name,
            type: 'mongodb' as const,
            config: destination.config,
          },
    ),
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

async function getActiveRunForPipeline(pipelineId: string): Promise<ControlPlaneRunView | null> {
  const runs = await listRunRecords();
  const pipelineRuns = runs.filter((run) => run.pipelineId === pipelineId);
  if (pipelineRuns.length === 0) {
    return null;
  }

  const runViews = await Promise.all(pipelineRuns.map((run) => buildRunView(run)));
  const activeRuns = runViews
    .filter((runView) => isActiveRunStatus(runView.computedStatus))
    .sort(compareRunsByRequestedAtDesc);

  return activeRuns[0] ?? null;
}

async function waitForActiveRunForPipeline(
  pipelineId: string,
  input: { attempts?: number; delayMs?: number } = {},
): Promise<ControlPlaneRunView | null> {
  const attempts = input.attempts ?? 10;
  const delayMs = input.delayMs ?? 50;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const activeRun = await getActiveRunForPipeline(pipelineId);
    if (activeRun) {
      return activeRun;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}

async function withPipelineStartLock<T>(
  pipelineId: string,
  fn: () => Promise<T>,
): Promise<T | ControlPlaneRunView> {
  const lockDir = buildPipelineStartLockDir(pipelineId);
  await mkdir(controlPlaneLockRootDir, { recursive: true });

  try {
    await mkdir(lockDir);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      const activeRun = await waitForActiveRunForPipeline(pipelineId);
      if (activeRun) {
        return activeRun;
      }

      throw new Error(
        `Another start request for pipeline "${pipelineId}" is already in progress. Try again.`,
      );
    }

    throw error;
  }

  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function assertSearchSpaceDeleteAllowed(id: string): Promise<void> {
  const pipelines = await listPipelines();
  if (pipelines.some((pipeline) => pipeline.searchSpaceId === id)) {
    throw new Error(`Search space "${id}" is still referenced by one or more pipelines.`);
  }
}

async function assertRuntimeProfileDeleteAllowed(id: string): Promise<void> {
  const pipelines = await listPipelines();
  if (pipelines.some((pipeline) => pipeline.runtimeProfileId === id)) {
    throw new Error(`Runtime profile "${id}" is still referenced by one or more pipelines.`);
  }
}

async function assertStructuredOutputDestinationDeleteAllowed(id: string): Promise<void> {
  const pipelines = await listPipelines();
  if (
    pipelines.some((pipeline) =>
      pipeline.structuredOutputDestinationIds.some((item) => item === id),
    )
  ) {
    throw new Error(
      `Structured output destination "${id}" is still referenced by one or more pipelines.`,
    );
  }
}

async function assertPipelineDeleteAllowed(id: string): Promise<void> {
  const activeRun = await getActiveRunForPipeline(id);
  if (activeRun) {
    throw new Error(
      `Pipeline "${id}" has an active run (${activeRun.run.runId}) and cannot be deleted.`,
    );
  }
}

export async function getControlPlaneOverview(): Promise<ControlPlaneOverview> {
  await ensureControlPlaneBootstrap();
  const [searchSpaces, runtimeProfiles, structuredOutputDestinations, pipelines, runs] =
    await Promise.all([
      listSearchSpaces(),
      listRuntimeProfiles(),
      listStructuredOutputDestinations(),
      listPipelines(),
      listRunRecords(),
    ]);

  const runViews = await Promise.all(runs.map((run) => buildRunView(run)));

  return {
    searchSpaces: searchSpaces.sort((left, right) => left.name.localeCompare(right.name)),
    runtimeProfiles: runtimeProfiles.sort((left, right) => left.name.localeCompare(right.name)),
    structuredOutputDestinations: structuredOutputDestinations.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    pipelines: pipelines.sort((left, right) => left.name.localeCompare(right.name)),
    runs: runViews.sort(compareRunsByRequestedAtDesc),
  };
}

export async function getControlPlaneRunDetail(
  runId: string,
): Promise<ControlPlaneRunDetail | null> {
  await ensureControlPlaneBootstrap();
  const run = await getRunRecord(runId);
  if (!run) {
    return null;
  }

  const runView = await buildRunView(run);
  const [pipeline, brokerEvents, generatedInput, crawlerLog, ingestionLog] = await Promise.all([
    getPipeline(run.pipelineId),
    readBrokerEvents(controlPlaneBrokerRootDir, runId),
    readTextPreview(buildRunGeneratedInputPath(runId)),
    readOptionalTextPreview(runView.crawlerRuntime?.logPath),
    readOptionalTextPreview(runView.ingestionRuntime?.logPath),
  ]);

  return {
    runView,
    pipeline,
    generatedInput,
    crawlerLog,
    ingestionLog,
    brokerEvents,
    artifactCaptures: buildArtifactCaptures(brokerEvents),
    structuredOutputCaptures: runView.manifest
      ? buildStructuredOutputCaptures({
          events: brokerEvents,
          manifest: runView.manifest,
        })
      : [],
    mongoDatabaseName: deriveMongoDatabaseName(runView.manifest),
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
    allowInactiveMarkingOnPartialRuns: input.allowInactiveMarkingOnPartialRuns,
    status: input.status,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return writeSearchSpace(record);
}

export async function updateSearchSpace(
  id: string,
  rawInput: CreateSearchSpaceInput,
): Promise<SearchSpace> {
  await ensureControlPlaneBootstrap();
  const existing = await getSearchSpace(id);
  if (!existing) {
    throw new Error(`Unknown search space "${id}".`);
  }

  const input = createSearchSpaceInputSchema.parse(rawInput);
  return writeSearchSpace(
    searchSpaceSchema.parse({
      ...existing,
      name: input.name,
      description: input.description,
      sourceType: input.sourceType,
      startUrls: input.startUrls,
      maxItemsDefault: input.maxItemsDefault,
      allowInactiveMarkingOnPartialRuns: input.allowInactiveMarkingOnPartialRuns,
      version: existing.version + 1,
      updatedAt: nowIso(),
    }),
  );
}

export async function archiveSearchSpace(id: string): Promise<SearchSpace> {
  await ensureControlPlaneBootstrap();
  const existing = await getSearchSpace(id);
  if (!existing) {
    throw new Error(`Unknown search space "${id}".`);
  }

  return writeSearchSpace({
    ...existing,
    status: 'archived',
    version: existing.version + 1,
    updatedAt: nowIso(),
  });
}

export async function deleteSearchSpace(id: string): Promise<void> {
  await ensureControlPlaneBootstrap();
  const existing = await getSearchSpace(id);
  if (!existing) {
    throw new Error(`Unknown search space "${id}".`);
  }

  await assertSearchSpaceDeleteAllowed(id);
  await deleteCollectionRecord('searchSpaces', id);
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

export async function updateRuntimeProfile(
  id: string,
  rawInput: CreateRuntimeProfileInput,
): Promise<RuntimeProfile> {
  await ensureControlPlaneBootstrap();
  const existing = await getRuntimeProfile(id);
  if (!existing) {
    throw new Error(`Unknown runtime profile "${id}".`);
  }

  const input = createRuntimeProfileInputSchema.parse(rawInput);
  return writeRuntimeProfile({
    ...existing,
    name: input.name,
    crawlerMaxConcurrency: input.crawlerMaxConcurrency,
    crawlerMaxRequestsPerMinute: input.crawlerMaxRequestsPerMinute,
    ingestionConcurrency: input.ingestionConcurrency,
    ingestionEnabled: input.ingestionEnabled,
    debugLog: input.debugLog,
    updatedAt: nowIso(),
  });
}

export async function archiveRuntimeProfile(id: string): Promise<RuntimeProfile> {
  await ensureControlPlaneBootstrap();
  const existing = await getRuntimeProfile(id);
  if (!existing) {
    throw new Error(`Unknown runtime profile "${id}".`);
  }

  return writeRuntimeProfile({
    ...existing,
    status: 'archived',
    updatedAt: nowIso(),
  });
}

export async function deleteRuntimeProfile(id: string): Promise<void> {
  await ensureControlPlaneBootstrap();
  const existing = await getRuntimeProfile(id);
  if (!existing) {
    throw new Error(`Unknown runtime profile "${id}".`);
  }

  await assertRuntimeProfileDeleteAllowed(id);
  await deleteCollectionRecord('runtimeProfiles', id);
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

  return writeStructuredOutputDestination({
    id,
    name: input.name,
    type: 'downloadable_json',
    config: input.config,
    status: input.status,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function updateStructuredOutputDestination(
  id: string,
  rawInput: CreateStructuredOutputDestinationInput,
): Promise<StructuredOutputDestination> {
  await ensureControlPlaneBootstrap();
  const existing = await getStructuredOutputDestination(id);
  if (!existing) {
    throw new Error(`Unknown structured output destination "${id}".`);
  }

  const input = createStructuredOutputDestinationInputSchema.parse(rawInput);
  const timestamp = nowIso();

  if (input.type === 'mongodb') {
    return writeStructuredOutputDestination({
      id: existing.id,
      name: input.name,
      type: 'mongodb',
      config: input.config,
      status: existing.status,
      createdAt: existing.createdAt,
      updatedAt: timestamp,
    });
  }

  return writeStructuredOutputDestination({
    id: existing.id,
    name: input.name,
    type: 'downloadable_json',
    config: input.config,
    status: existing.status,
    createdAt: existing.createdAt,
    updatedAt: timestamp,
  });
}

export async function archiveStructuredOutputDestination(
  id: string,
): Promise<StructuredOutputDestination> {
  await ensureControlPlaneBootstrap();
  const existing = await getStructuredOutputDestination(id);
  if (!existing) {
    throw new Error(`Unknown structured output destination "${id}".`);
  }

  return writeStructuredOutputDestination({
    ...existing,
    status: 'archived',
    updatedAt: nowIso(),
  });
}

export async function deleteStructuredOutputDestination(id: string): Promise<void> {
  await ensureControlPlaneBootstrap();
  const existing = await getStructuredOutputDestination(id);
  if (!existing) {
    throw new Error(`Unknown structured output destination "${id}".`);
  }

  await assertStructuredOutputDestinationDeleteAllowed(id);
  await deleteCollectionRecord('structuredOutputDestinations', id);
}

export async function createPipeline(rawInput: CreatePipelineInput): Promise<Pipeline> {
  await ensureControlPlaneBootstrap();
  const input = createPipelineInputSchema.parse(rawInput);
  assertPipelineOutputModeConsistency(input);
  const [searchSpace, runtimeProfile] = await Promise.all([
    getSearchSpace(input.searchSpaceId),
    getRuntimeProfile(input.runtimeProfileId),
  ]);

  if (!searchSpace) {
    throw new Error(`Unknown search space "${input.searchSpaceId}".`);
  }
  assertRecordIsActive(searchSpace, 'Search space');

  if (!runtimeProfile) {
    throw new Error(`Unknown runtime profile "${input.runtimeProfileId}".`);
  }
  assertRecordIsActive(runtimeProfile, 'Runtime profile');

  const structuredOutputDestinations = await Promise.all(
    input.structuredOutputDestinationIds.map((destinationId) =>
      getStructuredOutputDestination(destinationId),
    ),
  );
  const missingDestination = structuredOutputDestinations.find((item) => item === null);
  if (missingDestination) {
    throw new Error('One or more structured output destinations do not exist.');
  }

  for (const destination of structuredOutputDestinations) {
    if (destination) {
      assertRecordIsActive(destination, 'Structured output destination');
    }
  }

  const timestamp = nowIso();
  return writePipeline(
    pipelineSchema.parse({
      id: buildRecordId(input.id ?? input.name),
      name: input.name,
      searchSpaceId: input.searchSpaceId,
      runtimeProfileId: input.runtimeProfileId,
      structuredOutputDestinationIds: input.structuredOutputDestinationIds,
      mode: input.mode,
      status: input.status,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
}

export async function updatePipeline(id: string, rawInput: CreatePipelineInput): Promise<Pipeline> {
  await ensureControlPlaneBootstrap();
  const existing = await getPipeline(id);
  if (!existing) {
    throw new Error(`Unknown pipeline "${id}".`);
  }

  const input = createPipelineInputSchema.parse(rawInput);
  assertPipelineOutputModeConsistency(input);
  const [searchSpace, runtimeProfile] = await Promise.all([
    getSearchSpace(input.searchSpaceId),
    getRuntimeProfile(input.runtimeProfileId),
  ]);

  if (!searchSpace) {
    throw new Error(`Unknown search space "${input.searchSpaceId}".`);
  }
  assertRecordIsActive(searchSpace, 'Search space');

  if (!runtimeProfile) {
    throw new Error(`Unknown runtime profile "${input.runtimeProfileId}".`);
  }
  assertRecordIsActive(runtimeProfile, 'Runtime profile');

  const structuredOutputDestinations = await Promise.all(
    input.structuredOutputDestinationIds.map((destinationId) =>
      getStructuredOutputDestination(destinationId),
    ),
  );
  const missingDestination = structuredOutputDestinations.find((item) => item === null);
  if (missingDestination) {
    throw new Error('One or more structured output destinations do not exist.');
  }

  for (const destination of structuredOutputDestinations) {
    if (destination) {
      assertRecordIsActive(destination, 'Structured output destination');
    }
  }

  return writePipeline(
    pipelineSchema.parse({
      ...existing,
      name: input.name,
      searchSpaceId: input.searchSpaceId,
      runtimeProfileId: input.runtimeProfileId,
      structuredOutputDestinationIds: input.structuredOutputDestinationIds,
      mode: input.mode,
      version: existing.version + 1,
      updatedAt: nowIso(),
    }),
  );
}

export async function archivePipeline(id: string): Promise<Pipeline> {
  await ensureControlPlaneBootstrap();
  const existing = await getPipeline(id);
  if (!existing) {
    throw new Error(`Unknown pipeline "${id}".`);
  }

  return writePipeline({
    ...existing,
    status: 'archived',
    version: existing.version + 1,
    updatedAt: nowIso(),
  });
}

export async function deletePipeline(id: string): Promise<void> {
  await ensureControlPlaneBootstrap();
  const existing = await getPipeline(id);
  if (!existing) {
    throw new Error(`Unknown pipeline "${id}".`);
  }

  await assertPipelineDeleteAllowed(id);
  await deleteCollectionRecord('pipelines', id);
}

export async function startRun(rawInput: StartRunRequest): Promise<ControlPlaneRunView> {
  await ensureControlPlaneBootstrap();
  const input = startRunRequestSchema.parse(rawInput);
  const lockedResult = await withPipelineStartLock(input.pipelineId, async () => {
    const activeRun = await getActiveRunForPipeline(input.pipelineId);
    if (activeRun) {
      return activeRun;
    }

    const pipeline = await getPipeline(input.pipelineId);
    if (!pipeline) {
      throw new Error(`Unknown pipeline "${input.pipelineId}".`);
    }
    assertRecordIsActive(pipeline, 'Pipeline');

    const dependencies = await getPipelineDependencies(pipeline);
    const runId = `crawl-run-${randomUUID().slice(0, 12)}`;
    const manifest = buildRunManifest({
      runId,
      pipeline,
      searchSpace: dependencies.searchSpace,
      runtimeProfile: dependencies.runtimeProfile,
      structuredOutputDestinations: dependencies.structuredOutputDestinations,
      createdBy: input.createdBy,
    });

    const generatedInputPath = buildRunGeneratedInputPath(runId);
    await assertExecutableRunPrerequisites(manifest);
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
  });

  return lockedResult;
}
