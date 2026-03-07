import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID } from '@/server/control-plane/builtin-outputs';

let tempRootDir: string;

beforeEach(async () => {
  tempRootDir = await mkdtemp(path.join(os.tmpdir(), 'omnicrawl-control-plane-artifacts-'));
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

describe('control-plane artifact access', () => {
  it('loads previews and downloads for captured HTML artifacts', async () => {
    const { createPipeline, getControlPlaneOverview, startRun } =
      await import('@/server/control-plane/service');
    const { getControlPlaneRunArtifactDownload, getControlPlaneRunArtifactPreview } =
      await import('@/server/control-plane/artifacts');

    const overview = await getControlPlaneOverview();
    const searchSpace = overview.searchSpaces[0]!;
    const runtimeProfile = overview.runtimeProfiles[0]!;

    const pipeline = await createPipeline({
      name: 'Artifact preview pipeline',
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

    const preview = await getControlPlaneRunArtifactPreview({
      runId: runView.run.runId,
      sourceId: 'fixture-001',
    });
    expect(preview.capture.htmlDetailPageKey).toBe('job-html-fixture-001.html');
    expect(preview.preview.exists).toBe(true);
    expect(preview.preview.contents).toContain('Fixture platform engineer');

    const download = await getControlPlaneRunArtifactDownload({
      runId: runView.run.runId,
      sourceId: 'fixture-001',
    });
    expect(download.fileName).toBe('job-html-fixture-001.html');
    expect(download.contents.toString('utf8')).toContain(
      'Fixture detail for control-plane testing.',
    );
  });
});
