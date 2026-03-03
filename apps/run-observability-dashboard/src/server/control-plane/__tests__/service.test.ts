import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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
      overview.artifactDestinations.some((destination) => destination.id === 'local-shared-html'),
    ).toBe(true);
    expect(
      overview.structuredOutputDestinations.some(
        (destination) => destination.id === 'local-json-output',
      ),
    ).toBe(true);
  });

  it('creates a pipeline and runs it in fixture mode', async () => {
    const { createPipeline, getControlPlaneOverview, startRun } =
      await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;
    const artifactDestination = overview.artifactDestinations[0]!;
    const jsonOutputDestination = overview.structuredOutputDestinations.find(
      (destination) => destination.type === 'local_json',
    )!;

    const pipeline = await createPipeline({
      name: 'Fixture integration pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      artifactDestinationId: artifactDestination.id,
      structuredOutputDestinationIds: [jsonOutputDestination.id],
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
    const artifactDestination = overview.artifactDestinations[0]!;
    const jsonOutputDestination = overview.structuredOutputDestinations.find(
      (destination) => destination.type === 'local_json',
    )!;

    const pipeline = await createPipeline({
      name: 'Fixture detail pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      artifactDestinationId: artifactDestination.id,
      structuredOutputDestinationIds: [jsonOutputDestination.id],
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
    expect(detail?.brokerEvents).toHaveLength(3);
    expect(detail?.artifactCaptures).toHaveLength(1);
    expect(detail?.artifactCaptures[0]?.sourceId).toBe('fixture-001');
    expect(detail?.artifactCaptures[0]?.artifactPath).toContain('job-html-fixture-001.html');
  });

  it('returns the existing active run for a pipeline instead of creating a duplicate', async () => {
    const { createPipeline, getControlPlaneOverview, startRun } =
      await import('@/server/control-plane/service');
    const { listRunRecords, writeRunRecord } = await import('@/server/control-plane/store');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;
    const artifactDestination = overview.artifactDestinations[0]!;

    const pipeline = await createPipeline({
      name: 'Active run guard pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      artifactDestinationId: artifactDestination.id,
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
    const artifactDestination = overview.artifactDestinations[0]!;
    const jsonOutputDestination = overview.structuredOutputDestinations.find(
      (destination) => destination.type === 'local_json',
    )!;

    const pipeline = await createPipeline({
      name: 'Ingest preflight pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      artifactDestinationId: artifactDestination.id,
      structuredOutputDestinationIds: [jsonOutputDestination.id],
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

  it('rejects deleting a search space that is still referenced by a pipeline', async () => {
    const { createPipeline, deleteSearchSpace, getControlPlaneOverview } =
      await import('@/server/control-plane/service');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;
    const artifactDestination = overview.artifactDestinations[0]!;

    await createPipeline({
      name: 'Deletion guard pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      artifactDestinationId: artifactDestination.id,
      structuredOutputDestinationIds: [],
      mode: 'crawl_only',
      status: 'active',
    });

    await expect(deleteSearchSpace(searchSpace.id)).rejects.toThrow(
      /referenced by one or more pipelines/i,
    );
  });
});
