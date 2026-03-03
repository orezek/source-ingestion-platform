import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRootDir: string;

beforeEach(async () => {
  tempRootDir = await mkdtemp(path.join(os.tmpdir(), 'jobcompass-control-plane-outputs-'));
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

describe('control-plane structured output access', () => {
  it('loads previews and downloads for downloadable json outputs', async () => {
    const { createPipeline, getControlPlaneOverview, getControlPlaneRunDetail, startRun } =
      await import('@/server/control-plane/service');
    const {
      getControlPlaneRunStructuredOutputDownload,
      getControlPlaneRunStructuredOutputPreview,
    } = await import('@/server/control-plane/outputs');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;
    const jsonOutputDestination = overview.structuredOutputDestinations.find(
      (destination) => destination.type === 'downloadable_json',
    )!;

    const pipeline = await createPipeline({
      name: 'Structured output preview pipeline',
      searchSpaceId: searchSpace.id,
      runtimeProfileId: runtimeProfile.id,
      structuredOutputDestinationIds: [jsonOutputDestination.id],
      mode: 'crawl_and_ingest',
      status: 'active',
    });

    const runView = await startRun({
      pipelineId: pipeline.id,
      createdBy: 'vitest',
    });

    const detail = await getControlPlaneRunDetail(runView.run.runId);
    const capture = detail?.structuredOutputCaptures[0];

    expect(capture).toBeDefined();
    expect(capture?.destinationId).toBe(jsonOutputDestination.id);
    expect(capture?.fileName).toBe('normalized-job-fixture-001.json');

    const preview = await getControlPlaneRunStructuredOutputPreview({
      runId: runView.run.runId,
      destinationId: jsonOutputDestination.id,
      sourceId: 'fixture-001',
    });
    expect(preview.preview.exists).toBe(true);
    expect(preview.preview.contents).toContain('"sourceId": "fixture-001"');

    const download = await getControlPlaneRunStructuredOutputDownload({
      runId: runView.run.runId,
      destinationId: jsonOutputDestination.id,
      sourceId: 'fixture-001',
    });
    expect(download.fileName).toBe('normalized-job-fixture-001.json');
    expect(download.contents.toString('utf8')).toContain('"crawlRunId"');
  });
});
