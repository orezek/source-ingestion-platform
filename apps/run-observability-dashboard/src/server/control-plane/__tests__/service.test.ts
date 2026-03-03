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
});
