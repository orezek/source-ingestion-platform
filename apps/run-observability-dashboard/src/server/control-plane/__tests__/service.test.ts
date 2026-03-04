import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID } from '@/server/control-plane/builtin-outputs';

let tempRootDir: string;

beforeEach(async () => {
  tempRootDir = await mkdtemp(path.join(os.tmpdir(), 'jobcompass-control-plane-'));
  process.env.DASHBOARD_DATA_MODE = 'fixture';
  process.env.DASHBOARD_FIXTURE_DIR = './src/test/fixtures';
  process.env.CONTROL_PLANE_DATA_DIR = path.join(tempRootDir, 'state');
  process.env.CONTROL_PLANE_BROKER_DIR = path.join(tempRootDir, 'broker');
  process.env.CONTROL_PLANE_WORKER_LOG_DIR = path.join(tempRootDir, 'logs');
  process.env.CONTROL_PLANE_DEFAULT_ARTIFACT_DIR = path.join(tempRootDir, 'artifacts');
  process.env.CONTROL_PLANE_DEFAULT_JSON_OUTPUT_DIR = path.join(tempRootDir, 'json-output');
  process.env.CONTROL_PLANE_EXECUTION_MODE = 'fixture';
  process.env.CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND = 'local_filesystem';
  process.env.CONTROL_PLANE_DOWNLOADABLE_OUTPUT_BACKEND = 'local_filesystem';
  vi.resetModules();
});

afterEach(async () => {
  await rm(tempRootDir, { recursive: true, force: true });
});

describe('control-plane service', () => {
  it('bootstraps search spaces and local defaults', async () => {
    const { getControlPlaneOverview } = await import('@/server/control-plane/service');
    const overview = await getControlPlaneOverview();

    expect(overview.searchSpaces.length).toBeGreaterThanOrEqual(2);
    expect(overview.runtimeProfiles.some((profile) => profile.id === 'default-local-runtime')).toBe(
      true,
    );
    expect(
      overview.structuredOutputDestinations.some(
        (destination) => destination.id === IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID,
      ),
    ).toBe(false);
    expect(
      overview.structuredOutputDestinations.some(
        (destination) => destination.id === 'mongo-normalized-jobs',
      ),
    ).toBe(true);
  });

  it('creates a pipeline and runs it in fixture mode', async () => {
    const { createPipeline, getControlPlaneOverview, startRun } =
      await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;

    const pipeline = await createPipeline({
      name: 'Fixture integration pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID],
      mode: 'crawl_and_ingest',
      status: 'active',
    });

    const runView = await startRun({
      pipelineId: pipeline.id,
      createdBy: 'vitest',
    });

    expect(runView.computedStatus).toBe('succeeded');
    expect(runView.crawlerRuntime?.status).toBe('succeeded');
    expect(runView.ingestionRuntime?.status).toBe('succeeded');

    const summary = runView.run.summary as Record<string, unknown>;
    const generatedInputPath = summary.generatedInputPath;
    expect(typeof generatedInputPath).toBe('string');

    const generatedInput = JSON.parse(await readFile(String(generatedInputPath), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(generatedInput.searchSpaceId).toBe(searchSpace.id);

    const normalizedJsonPath = path.join(
      tempRootDir,
      'json-output',
      'runs',
      runView.run.runId,
      'records',
      'normalized-job-fixture-001.json',
    );
    const normalizedJson = JSON.parse(await readFile(normalizedJsonPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(normalizedJson.searchSpaceId).toBe(searchSpace.id);
    expect(normalizedJson.crawlRunId).toBe(runView.run.runId);
  });

  it('loads control-plane run detail with manifest, broker events, and artifact captures', async () => {
    const { createPipeline, getControlPlaneOverview, getControlPlaneRunDetail, startRun } =
      await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;

    const pipeline = await createPipeline({
      name: 'Fixture detail pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID],
      mode: 'crawl_and_ingest',
      status: 'active',
    });

    const runView = await startRun({
      pipelineId: pipeline.id,
      createdBy: 'vitest',
    });

    const detail = await getControlPlaneRunDetail(runView.run.runId);
    expect(detail).not.toBeNull();
    expect(detail?.runView.run.runId).toBe(runView.run.runId);
    expect(detail?.generatedInput.exists).toBe(true);
    expect(detail?.generatedInput.contents).toContain(searchSpace.id);
    expect(detail?.brokerEvents).toHaveLength(5);
    expect(detail?.artifactCaptures).toHaveLength(1);
    expect(detail?.structuredOutputCaptures).toHaveLength(1);
    expect(detail?.artifactCaptures[0]?.sourceId).toBe('fixture-001');
    expect(detail?.artifactCaptures[0]?.artifactPath).toContain('job-html-fixture-001.html');
    expect(detail?.structuredOutputCaptures[0]?.fileName).toBe('normalized-job-fixture-001.json');
    expect(detail?.runView.manifest?.artifactStorageSnapshot.type).toBe('local_filesystem');
  });

  it('allows deleting a pipeline after its historical runs have finished', async () => {
    const {
      createPipeline,
      deletePipeline,
      getControlPlaneOverview,
      getControlPlaneRunDetail,
      startRun,
    } = await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;

    const pipeline = await createPipeline({
      name: 'Historical delete pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [],
      mode: 'crawl_only',
      status: 'active',
    });

    const runView = await startRun({
      pipelineId: pipeline.id,
      createdBy: 'vitest',
    });

    await deletePipeline(pipeline.id);

    const updatedOverview = await getControlPlaneOverview();
    expect(updatedOverview.pipelines.some((entry) => entry.id === pipeline.id)).toBe(false);

    const detail = await getControlPlaneRunDetail(runView.run.runId);
    expect(detail).not.toBeNull();
    expect(detail?.pipeline).toBeNull();
    expect(detail?.runView.manifest?.pipelineId).toBe(pipeline.id);
  });

  it('returns the existing active run for a pipeline instead of creating a duplicate', async () => {
    const { createPipeline, getControlPlaneOverview, startRun } =
      await import('@/server/control-plane/service');
    const { listRunRecords, writeRunRecord } = await import('@/server/control-plane/store');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;

    const pipeline = await createPipeline({
      name: 'Active run guard pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [],
      mode: 'crawl_only',
      status: 'active',
    });

    await writeRunRecord({
      runId: 'crawl-run-existing-active',
      pipelineId: pipeline.id,
      pipelineVersion: pipeline.version,
      status: 'running',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      stopReason: null,
      summary: {},
    });

    const runView = await startRun({
      pipelineId: pipeline.id,
      createdBy: 'vitest',
    });

    expect(runView.run.runId).toBe('crawl-run-existing-active');
    expect(runView.computedStatus).toBe('running');

    const runs = await listRunRecords();
    expect(runs.filter((run) => run.pipelineId === pipeline.id)).toHaveLength(1);
  });

  it('rejects deleting a pipeline that still has an active run', async () => {
    const { createPipeline, deletePipeline, getControlPlaneOverview } =
      await import('@/server/control-plane/service');
    const { writeRunRecord } = await import('@/server/control-plane/store');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;

    const pipeline = await createPipeline({
      name: 'Active delete guard pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [],
      mode: 'crawl_only',
      status: 'active',
    });

    await writeRunRecord({
      runId: 'crawl-run-delete-active',
      pipelineId: pipeline.id,
      pipelineVersion: pipeline.version,
      status: 'running',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      stopReason: null,
      summary: {},
    });

    await expect(deletePipeline(pipeline.id)).rejects.toThrow(/active run/i);
  });

  it('rejects local_cli ingest runs before creating a run when GEMINI_API_KEY is unavailable', async () => {
    Object.assign(process.env, {
      CONTROL_PLANE_EXECUTION_MODE: 'local_cli',
      MONGODB_URI: 'mongodb://127.0.0.1:27027',
    });
    Reflect.deleteProperty(process.env, 'GEMINI_API_KEY');
    vi.resetModules();

    const { createPipeline, getControlPlaneOverview, startRun } =
      await import('@/server/control-plane/service');
    const { listRunRecords } = await import('@/server/control-plane/store');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;

    const pipeline = await createPipeline({
      name: 'Ingest preflight pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID],
      mode: 'crawl_and_ingest',
      status: 'active',
    });

    await expect(
      startRun({
        pipelineId: pipeline.id,
        createdBy: 'vitest',
      }),
    ).rejects.toThrow(/GEMINI_API_KEY/i);

    const runs = await listRunRecords();
    expect(runs.filter((run) => run.pipelineId === pipeline.id)).toHaveLength(0);
  });

  it('updates runtime profiles and persists the new values', async () => {
    const { getControlPlaneOverview, updateRuntimeProfile } =
      await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const runtimeProfile = overview.runtimeProfiles[0]!;

    const updated = await updateRuntimeProfile(runtimeProfile.id, {
      id: runtimeProfile.id,
      name: `${runtimeProfile.name} updated`,
      crawlerMaxConcurrency: 3,
      crawlerMaxRequestsPerMinute: 45,
      ingestionConcurrency: 2,
      ingestionEnabled: false,
      debugLog: true,
      status: 'active',
    });

    expect(updated.name).toContain('updated');
    expect(updated.crawlerMaxConcurrency).toBe(3);
    expect(updated.ingestionEnabled).toBe(false);
    expect(updated.debugLog).toBe(true);
  });

  it('allows deleting a runtime profile after historical runs have finished', async () => {
    const {
      createPipeline,
      createRuntimeProfile,
      deletePipeline,
      deleteRuntimeProfile,
      getControlPlaneOverview,
      getControlPlaneRunDetail,
      startRun,
    } = await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = await createRuntimeProfile({
      name: 'Historical delete runtime profile',
      crawlerMaxConcurrency: 2,
      crawlerMaxRequestsPerMinute: 30,
      ingestionConcurrency: 1,
      ingestionEnabled: true,
      debugLog: false,
      status: 'active',
    });

    const pipeline = await createPipeline({
      name: 'Historical runtime profile delete pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [],
      mode: 'crawl_only',
      status: 'active',
    });

    const runView = await startRun({
      pipelineId: pipeline.id,
      createdBy: 'vitest',
    });

    await deletePipeline(pipeline.id);
    await deleteRuntimeProfile(runtimeProfile.id);

    const updatedOverview = await getControlPlaneOverview();
    expect(updatedOverview.runtimeProfiles.some((entry) => entry.id === runtimeProfile.id)).toBe(
      false,
    );

    const detail = await getControlPlaneRunDetail(runView.run.runId);
    expect(detail).not.toBeNull();
    expect(detail?.runView.manifest?.runtimeProfileSnapshot.id).toBe(runtimeProfile.id);
  });

  it('rejects deleting a runtime profile that is still referenced by a pipeline', async () => {
    const { createPipeline, deleteRuntimeProfile, getControlPlaneOverview } =
      await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;

    await createPipeline({
      name: 'Runtime profile delete guard pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [],
      mode: 'crawl_only',
      status: 'active',
    });

    await expect(deleteRuntimeProfile(runtimeProfile.id)).rejects.toThrow(
      /referenced by one or more pipelines/i,
    );
  });

  it('allows deleting a search space after historical runs have finished', async () => {
    const {
      createPipeline,
      createSearchSpace,
      deletePipeline,
      deleteSearchSpace,
      getControlPlaneOverview,
      getControlPlaneRunDetail,
      startRun,
    } = await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const runtimeProfile = overview.runtimeProfiles[0]!;
    const searchSpace = await createSearchSpace({
      name: 'Historical delete search space',
      description: 'test only',
      sourceType: 'jobs_cz',
      startUrls: ['https://example.test/jobs'],
      maxItemsDefault: 10,
      allowInactiveMarkingOnPartialRuns: false,
      status: 'active',
    });

    const pipeline = await createPipeline({
      name: 'Historical search space delete pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [],
      mode: 'crawl_only',
      status: 'active',
    });

    const runView = await startRun({
      pipelineId: pipeline.id,
      createdBy: 'vitest',
    });

    await deletePipeline(pipeline.id);
    await deleteSearchSpace(searchSpace.id);

    const updatedOverview = await getControlPlaneOverview();
    expect(updatedOverview.searchSpaces.some((entry) => entry.id === searchSpace.id)).toBe(false);

    const detail = await getControlPlaneRunDetail(runView.run.runId);
    expect(detail).not.toBeNull();
    expect(detail?.runView.manifest?.searchSpaceSnapshot.id).toBe(searchSpace.id);
  });

  it('rejects deleting a search space that is still referenced by a pipeline', async () => {
    const { createPipeline, deleteSearchSpace, getControlPlaneOverview } =
      await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;

    await createPipeline({
      name: 'Deletion guard pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [],
      mode: 'crawl_only',
      status: 'active',
    });

    await expect(deleteSearchSpace(searchSpace.id)).rejects.toThrow(
      /referenced by one or more pipelines/i,
    );
  });

  it('allows deleting a structured output destination after historical runs have finished', async () => {
    const {
      createPipeline,
      createStructuredOutputDestination,
      deletePipeline,
      deleteStructuredOutputDestination,
      getControlPlaneOverview,
      getControlPlaneRunDetail,
      startRun,
    } = await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;
    const destination = await createStructuredOutputDestination({
      name: 'Historical delete mongo output',
      type: 'mongodb',
      config: {
        connectionUri: 'env:MONGODB_URI',
      },
      status: 'active',
    });

    const pipeline = await createPipeline({
      name: 'Historical output delete pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [destination.id],
      mode: 'crawl_and_ingest',
      status: 'active',
    });

    const runView = await startRun({
      pipelineId: pipeline.id,
      createdBy: 'vitest',
    });

    await deletePipeline(pipeline.id);
    await deleteStructuredOutputDestination(destination.id);

    const updatedOverview = await getControlPlaneOverview();
    expect(
      updatedOverview.structuredOutputDestinations.some((entry) => entry.id === destination.id),
    ).toBe(false);

    const detail = await getControlPlaneRunDetail(runView.run.runId);
    expect(detail).not.toBeNull();
    expect(
      detail?.runView.manifest?.structuredOutputDestinationSnapshots.some(
        (entry) => entry.id === destination.id,
      ),
    ).toBe(true);
  });

  it('rejects deleting a structured output destination that is still referenced by a pipeline', async () => {
    const {
      createPipeline,
      createStructuredOutputDestination,
      deleteStructuredOutputDestination,
      getControlPlaneOverview,
    } = await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;
    const destination = await createStructuredOutputDestination({
      name: 'Structured output delete guard',
      type: 'mongodb',
      config: {
        connectionUri: 'env:MONGODB_URI',
      },
      status: 'active',
    });

    await createPipeline({
      name: 'Structured output guard pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [destination.id],
      mode: 'crawl_and_ingest',
      status: 'active',
    });

    await expect(deleteStructuredOutputDestination(destination.id)).rejects.toThrow(
      /referenced by one or more pipelines/i,
    );
  });
});
