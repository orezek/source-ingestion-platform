import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRootDir: string;

beforeEach(() => {
  Object.assign(process.env, {
    DASHBOARD_DATA_MODE: 'fixture',
    DASHBOARD_FIXTURE_DIR: './src/test/fixtures',
    CONTROL_PLANE_EXECUTION_MODE: 'local_cli',
    CONTROL_PLANE_DATA_DIR: '/tmp/jobcompass-control-plane-execution-test/state',
    CONTROL_PLANE_BROKER_DIR: '/tmp/jobcompass-control-plane-execution-test/broker',
    CONTROL_PLANE_WORKER_LOG_DIR: '/tmp/jobcompass-control-plane-execution-test/logs',
    CONTROL_PLANE_DEFAULT_ARTIFACT_DIR: '/tmp/jobcompass-control-plane-execution-test/artifacts',
    CONTROL_PLANE_DEFAULT_JSON_OUTPUT_DIR:
      '/tmp/jobcompass-control-plane-execution-test/json-output',
    JOB_COMPASS_DB_PREFIX: 'job-compass',
    MONGODB_URI: 'mongodb://127.0.0.1:27027',
  });
  Reflect.deleteProperty(process.env, 'GEMINI_API_KEY');
  vi.resetModules();
});

afterEach(async () => {
  if (tempRootDir) {
    await rm(tempRootDir, { recursive: true, force: true });
    tempRootDir = '';
  }
});

describe('control-plane local_cli env overrides', () => {
  it('sets crawler defaults required by the current worker env parser', async () => {
    const { buildCrawlerWorkerEnvOverrides } = await import('@/server/control-plane/execution');

    const envOverrides = buildCrawlerWorkerEnvOverrides({
      manifest: {
        runId: 'crawl-run-test',
        pipelineId: 'pipeline-test',
        pipelineVersion: 1,
        sourceType: 'jobs_cz',
        mode: 'crawl_only',
        searchSpaceSnapshot: {
          id: 'prague-tech-jobs',
          name: 'Prague tech jobs',
          sourceType: 'jobs_cz',
          startUrls: ['https://www.jobs.cz/prace/praha/'],
          maxItemsDefault: 1,
          allowInactiveMarkingOnPartialRuns: false,
          version: 1,
        },
        runtimeProfileSnapshot: {
          id: 'runtime-test',
          name: 'Runtime test',
          crawlerMaxConcurrency: 1,
          crawlerMaxRequestsPerMinute: 30,
          ingestionConcurrency: 1,
          ingestionEnabled: false,
          debugLog: false,
        },
        artifactDestinationSnapshot: {
          id: 'artifact-test',
          name: 'Artifact test',
          type: 'local_filesystem',
          config: {
            basePath: '/tmp/jobcompass-control-plane-execution-test/artifacts',
          },
        },
        structuredOutputDestinationSnapshots: [],
        createdAt: '2026-03-03T00:00:00.000Z',
        createdBy: 'vitest',
      },
      runId: 'crawl-run-test',
      mongoDbName: 'job-compass-prague-tech-jobs',
      artifactRoot: '/tmp/jobcompass-control-plane-execution-test/artifacts',
      crawlerSummaryPath:
        '/tmp/jobcompass-control-plane-execution-test/state/runs/crawl-run-test/crawler-run-summary.json',
    });

    expect(envOverrides.CRAWLEE_LOG_LEVEL).toBe('INFO');
    expect(envOverrides.MONGODB_URI).toBe('mongodb://127.0.0.1:27027');
    expect(envOverrides.ENABLE_MONGO_RUN_SUMMARY_WRITE).toBe('true');
    expect(envOverrides.ENABLE_INGESTION_TRIGGER).toBe('false');
  });

  it('enables debug crawler logging when the runtime profile requests it', async () => {
    const { buildCrawlerWorkerEnvOverrides } = await import('@/server/control-plane/execution');

    const envOverrides = buildCrawlerWorkerEnvOverrides({
      manifest: {
        runId: 'crawl-run-test',
        pipelineId: 'pipeline-test',
        pipelineVersion: 1,
        sourceType: 'jobs_cz',
        mode: 'crawl_only',
        searchSpaceSnapshot: {
          id: 'prague-tech-jobs',
          name: 'Prague tech jobs',
          sourceType: 'jobs_cz',
          startUrls: ['https://www.jobs.cz/prace/praha/'],
          maxItemsDefault: 1,
          allowInactiveMarkingOnPartialRuns: false,
          version: 1,
        },
        runtimeProfileSnapshot: {
          id: 'runtime-test',
          name: 'Runtime test',
          crawlerMaxConcurrency: 1,
          crawlerMaxRequestsPerMinute: 30,
          ingestionConcurrency: 1,
          ingestionEnabled: false,
          debugLog: true,
        },
        artifactDestinationSnapshot: {
          id: 'artifact-test',
          name: 'Artifact test',
          type: 'local_filesystem',
          config: {
            basePath: '/tmp/jobcompass-control-plane-execution-test/artifacts',
          },
        },
        structuredOutputDestinationSnapshots: [],
        createdAt: '2026-03-03T00:00:00.000Z',
        createdBy: 'vitest',
      },
      runId: 'crawl-run-test',
      mongoDbName: 'job-compass-prague-tech-jobs',
      artifactRoot: '/tmp/jobcompass-control-plane-execution-test/artifacts',
      crawlerSummaryPath:
        '/tmp/jobcompass-control-plane-execution-test/state/runs/crawl-run-test/crawler-run-summary.json',
    });

    expect(envOverrides.CRAWLEE_LOG_LEVEL).toBe('DEBUG');
  });

  it('detects worker keys from app-local env files for local_cli preflight', async () => {
    const { hasWorkerEnvValueInAppDir } = await import('@/server/control-plane/execution');
    tempRootDir = await mkdtemp(path.join(os.tmpdir(), 'jobcompass-execution-env-'));

    await writeFile(
      path.join(tempRootDir, '.env.local'),
      'GEMINI_API_KEY=test-gemini-key\\n',
      'utf8',
    );

    await expect(hasWorkerEnvValueInAppDir(tempRootDir, 'GEMINI_API_KEY')).resolves.toBe(true);
    await expect(hasWorkerEnvValueInAppDir(tempRootDir, 'MISSING_KEY')).resolves.toBe(false);
  });
});
