import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlPlaneRun } from '@repo/control-plane-contracts';

let tempRootDir: string;

function buildManifest(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'crawl-run-test',
    pipelineId: 'pipeline-test',
    pipelineVersion: 1,
    sourceType: 'jobs_cz' as const,
    mode: 'crawl_only' as const,
    searchSpaceSnapshot: {
      id: 'prague-tech-jobs',
      name: 'Prague tech jobs',
      sourceType: 'jobs_cz' as const,
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
    artifactStorageSnapshot: {
      type: 'local_filesystem' as const,
      config: {
        basePath: '/tmp/omnicrawl-control-plane-execution-test/artifacts',
      },
    },
    structuredOutputDestinationSnapshots: [],
    createdAt: '2026-03-03T00:00:00.000Z',
    createdBy: 'vitest',
    ...overrides,
  };
}

function buildRun(overrides: Partial<ControlPlaneRun> = {}): ControlPlaneRun {
  return {
    runId: 'crawl-run-test',
    pipelineId: 'pipeline-test',
    pipelineVersion: 1,
    status: 'running',
    requestedAt: '2026-03-03T00:00:00.000Z',
    startedAt: '2026-03-03T00:00:01.000Z',
    stopReason: null,
    summary: {},
    ...overrides,
  };
}

beforeEach(() => {
  Object.assign(process.env, {
    DASHBOARD_DATA_MODE: 'fixture',
    DASHBOARD_FIXTURE_DIR: './src/test/fixtures',
    CONTROL_PLANE_EXECUTION_MODE: 'local_cli',
    CONTROL_PLANE_DATA_DIR: '/tmp/omnicrawl-control-plane-execution-test/state',
    CONTROL_PLANE_BROKER_DIR: '/tmp/omnicrawl-control-plane-execution-test/broker',
    CONTROL_PLANE_WORKER_LOG_DIR: '/tmp/omnicrawl-control-plane-execution-test/logs',
    CONTROL_PLANE_DEFAULT_ARTIFACT_DIR: '/tmp/omnicrawl-control-plane-execution-test/artifacts',
    CONTROL_PLANE_DEFAULT_JSON_OUTPUT_DIR:
      '/tmp/omnicrawl-control-plane-execution-test/json-output',
    CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND: 'local_filesystem',
    CONTROL_PLANE_DOWNLOADABLE_OUTPUT_BACKEND: 'local_filesystem',
    CONTROL_PLANE_INGESTION_PARSER_BACKEND: 'gemini',
    CONTROL_PLANE_BROKER_BACKEND: 'local',
    CONTROL_PLANE_GCP_PUBSUB_TOPIC: 'omnicrawl-control-plane-events',
    CONTROL_PLANE_GCP_PUBSUB_SUBSCRIPTION_PREFIX: 'omnicrawl-control-plane-run',
    JOB_COMPASS_DB_PREFIX: 'omni-crawl',
    MONGODB_URI: 'mongodb://127.0.0.1:27027',
  });
  Reflect.deleteProperty(process.env, 'GEMINI_API_KEY');
  vi.resetModules();
});

describe('control-plane worker_http execution', () => {
  it('requires worker endpoints and auth token during preflight', async () => {
    Object.assign(process.env, {
      CONTROL_PLANE_EXECUTION_MODE: 'worker_http',
    });
    Reflect.deleteProperty(process.env, 'CONTROL_PLANE_CRAWLER_WORKER_BASE_URL');
    Reflect.deleteProperty(process.env, 'CONTROL_PLANE_INGESTION_WORKER_BASE_URL');
    Reflect.deleteProperty(process.env, 'CONTROL_PLANE_WORKER_AUTH_TOKEN');
    vi.resetModules();

    const { assertExecutableRunPrerequisites } = await import('@/server/control-plane/execution');

    await expect(assertExecutableRunPrerequisites(buildManifest())).rejects.toThrow(
      /CONTROL_PLANE_CRAWLER_WORKER_BASE_URL/i,
    );

    Object.assign(process.env, {
      CONTROL_PLANE_CRAWLER_WORKER_BASE_URL: 'http://127.0.0.1:3010',
      CONTROL_PLANE_WORKER_AUTH_TOKEN: 'dev-control-token',
    });
    vi.resetModules();

    const workerHttpExecution = await import('@/server/control-plane/execution');
    await expect(
      workerHttpExecution.assertExecutableRunPrerequisites(
        buildManifest({
          mode: 'crawl_and_ingest',
          runtimeProfileSnapshot: {
            id: 'runtime-test',
            name: 'Runtime test',
            crawlerMaxConcurrency: 1,
            crawlerMaxRequestsPerMinute: 30,
            ingestionConcurrency: 1,
            ingestionEnabled: true,
            debugLog: false,
          },
        }),
      ),
    ).rejects.toThrow(/CONTROL_PLANE_INGESTION_WORKER_BASE_URL/i);
  });

  it('maps the current manifest into the simplified v2 worker start-run requests', async () => {
    Object.assign(process.env, {
      CONTROL_PLANE_EXECUTION_MODE: 'worker_http',
      JOB_COMPASS_DB_PREFIX: 'jcpl',
    });
    vi.resetModules();

    const { buildCrawlerWorkerStartRunRequestV2, buildIngestionWorkerStartRunRequestV2 } =
      await import('@/server/control-plane/execution');

    const manifest = buildManifest({
      mode: 'crawl_and_ingest',
      searchSpaceSnapshot: {
        id: 'test-vyvoj',
        name: 'Test Vyvoj',
        sourceType: 'jobs_cz' as const,
        startUrls: [
          'https://www.jobs.cz/prace/praha/is-it-vyvoj-aplikaci-a-systemu/?locality%5Bradius%5D=0',
        ],
        maxItemsDefault: 30,
        allowInactiveMarkingOnPartialRuns: false,
        version: 1,
      },
      runtimeProfileSnapshot: {
        id: 'runtime-test',
        name: 'Runtime test',
        crawlerMaxConcurrency: 1,
        crawlerMaxRequestsPerMinute: 30,
        ingestionConcurrency: 1,
        ingestionEnabled: true,
        debugLog: false,
      },
    });

    const crawlerRequest = buildCrawlerWorkerStartRunRequestV2(manifest);
    const ingestionRequest = buildIngestionWorkerStartRunRequestV2(manifest);

    expect(crawlerRequest.runId).toBe(manifest.runId);
    expect(crawlerRequest.inputRef.source).toBe('jobs.cz');
    expect(crawlerRequest.inputRef.searchSpaceId).toBe('test-vyvoj');
    expect(crawlerRequest.inputRef.searchSpaceSnapshot.maxItems).toBe(30);
    expect(crawlerRequest.inputRef.emitDetailCapturedEvents).toBe(true);
    expect(crawlerRequest.persistenceTargets.dbName).toBe('jcpl-pipeline-test');

    expect(ingestionRequest.runId).toBe(manifest.runId);
    expect(ingestionRequest.inputRef.crawlRunId).toBe(manifest.runId);
    expect(ingestionRequest.outputSinks).toEqual([]);
    expect(ingestionRequest.persistenceTargets.dbName).toBe('jcpl-pipeline-test');
  });

  it('starts ingestion first and then crawler when worker_http mode is enabled', async () => {
    Object.assign(process.env, {
      CONTROL_PLANE_EXECUTION_MODE: 'worker_http',
      CONTROL_PLANE_CRAWLER_WORKER_BASE_URL: 'http://127.0.0.1:3010',
      CONTROL_PLANE_INGESTION_WORKER_BASE_URL: 'http://127.0.0.1:3020',
      CONTROL_PLANE_WORKER_AUTH_TOKEN: 'dev-control-token',
      JOB_COMPASS_DB_PREFIX: 'jcpl',
    });
    vi.resetModules();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      return new Response(
        JSON.stringify({
          contractVersion: 'v2',
          ok: true,
          runId: 'crawl-run-test',
          workerType: url.includes(':3020') ? 'ingestion' : 'crawler',
          accepted: true,
          deduplicated: false,
          state: 'accepted',
          message: 'Run accepted for execution.',
        }),
        {
          status: 202,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    try {
      const { executeRun } = await import('@/server/control-plane/execution');

      await executeRun({
        run: buildRun(),
        manifest: buildManifest({
          mode: 'crawl_and_ingest',
          runtimeProfileSnapshot: {
            id: 'runtime-test',
            name: 'Runtime test',
            crawlerMaxConcurrency: 1,
            crawlerMaxRequestsPerMinute: 30,
            ingestionConcurrency: 1,
            ingestionEnabled: true,
            debugLog: false,
          },
        }),
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0].toString()).toContain('127.0.0.1:3020/v1/runs');
      expect(fetchMock.mock.calls[1]?.[0].toString()).toContain('127.0.0.1:3010/v1/runs');
    } finally {
      vi.unstubAllGlobals();
    }
  });
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
      manifest: buildManifest(),
      runId: 'crawl-run-test',
      mongoDbName: 'omni-crawl-prague-tech-jobs',
      crawlerSummaryPath:
        '/tmp/omnicrawl-control-plane-execution-test/state/runs/crawl-run-test/crawler-run-summary.json',
      searchSpacesDir: '/tmp/omnicrawl-control-plane-execution-test/generated-search-spaces',
    });

    expect(envOverrides.CRAWLEE_LOG_LEVEL).toBe('INFO');
    expect(envOverrides.MONGODB_URI).toBe('mongodb://127.0.0.1:27027');
    expect(envOverrides.ENABLE_MONGO_RUN_SUMMARY_WRITE).toBe('true');
    expect(envOverrides.ENABLE_INGESTION_TRIGGER).toBe('false');
    expect(envOverrides.JOB_COMPASS_SEARCH_SPACES_DIR).toBe(
      '/tmp/omnicrawl-control-plane-execution-test/generated-search-spaces',
    );
    expect(envOverrides.JOB_COMPASS_ARTIFACT_STORE_TYPE).toBe('local_filesystem');
    expect(envOverrides.JOB_COMPASS_BROKER_BACKEND).toBe('local');
  });

  it('enables debug crawler logging when the runtime profile requests it', async () => {
    const { buildCrawlerWorkerEnvOverrides } = await import('@/server/control-plane/execution');

    const envOverrides = buildCrawlerWorkerEnvOverrides({
      manifest: buildManifest({
        runtimeProfileSnapshot: {
          id: 'runtime-test',
          name: 'Runtime test',
          crawlerMaxConcurrency: 1,
          crawlerMaxRequestsPerMinute: 30,
          ingestionConcurrency: 1,
          ingestionEnabled: false,
          debugLog: true,
        },
      }),
      runId: 'crawl-run-test',
      mongoDbName: 'omni-crawl-prague-tech-jobs',
      crawlerSummaryPath:
        '/tmp/omnicrawl-control-plane-execution-test/state/runs/crawl-run-test/crawler-run-summary.json',
      searchSpacesDir: '/tmp/omnicrawl-control-plane-execution-test/generated-search-spaces',
    });

    expect(envOverrides.CRAWLEE_LOG_LEVEL).toBe('DEBUG');
  });

  it('maps GCS artifacts, Pub/Sub broker settings, and managed downloadable JSON into worker env overrides', async () => {
    Object.assign(process.env, {
      CONTROL_PLANE_BROKER_BACKEND: 'gcp_pubsub',
      CONTROL_PLANE_GCP_PROJECT_ID: 'omnicrawl-test',
      CONTROL_PLANE_GCP_PUBSUB_TOPIC: 'omnicrawl-control-plane-events',
      CONTROL_PLANE_GCP_PUBSUB_SUBSCRIPTION_PREFIX: 'omnicrawl-run',
    });
    vi.resetModules();

    const { buildCrawlerWorkerEnvOverrides, buildIngestionWorkerEnvOverrides } =
      await import('@/server/control-plane/execution');

    const manifest = buildManifest({
      mode: 'crawl_and_ingest',
      runtimeProfileSnapshot: {
        id: 'runtime-test',
        name: 'Runtime test',
        crawlerMaxConcurrency: 1,
        crawlerMaxRequestsPerMinute: 30,
        ingestionConcurrency: 1,
        ingestionEnabled: true,
        debugLog: false,
      },
      artifactStorageSnapshot: {
        type: 'gcs' as const,
        config: {
          bucket: 'omnicrawl-artifacts-test',
          prefix: 'v1',
        },
      },
      structuredOutputDestinationSnapshots: [
        {
          id: 'json-download',
          name: 'Downloadable JSON',
          type: 'downloadable_json' as const,
          config: {
            storageType: 'gcs' as const,
            bucket: 'omnicrawl-json-test',
            prefix: 'normalized',
          },
        },
        {
          id: 'mongo-primary',
          name: 'Mongo primary',
          type: 'mongodb' as const,
          config: {
            connectionUri: 'env:MONGODB_URI',
          },
        },
      ],
    });

    const crawlerEnv = buildCrawlerWorkerEnvOverrides({
      manifest,
      runId: 'crawl-run-test',
      mongoDbName: 'omni-crawl-prague-tech-jobs',
      crawlerSummaryPath:
        '/tmp/omnicrawl-control-plane-execution-test/state/runs/crawl-run-test/crawler-run-summary.json',
      searchSpacesDir: '/tmp/omnicrawl-control-plane-execution-test/generated-search-spaces',
    });

    const ingestionEnv = buildIngestionWorkerEnvOverrides({
      manifest,
      mongoDbName: 'omni-crawl-prague-tech-jobs',
    });

    expect(crawlerEnv.JOB_COMPASS_ARTIFACT_STORE_TYPE).toBe('gcs');
    expect(crawlerEnv.JOB_COMPASS_GCS_BUCKET).toBe('omnicrawl-artifacts-test');
    expect(crawlerEnv.JOB_COMPASS_BROKER_BACKEND).toBe('gcp_pubsub');
    expect(crawlerEnv.JOB_COMPASS_GCP_PROJECT_ID).toBe('omnicrawl-test');
    expect(ingestionEnv.MONGODB_URI).toBe('mongodb://127.0.0.1:27027');
    expect(ingestionEnv.INGESTION_PARSER_BACKEND).toBe('gemini');
    expect(ingestionEnv.JOB_COMPASS_BROKER_BACKEND).toBe('gcp_pubsub');
    expect(ingestionEnv.JOB_COMPASS_GCP_PUBSUB_TOPIC).toBe('omnicrawl-control-plane-events');
  });

  it('requires LANGSMITH_API_KEY for local_cli Gemini ingestion preflight', async () => {
    Object.assign(process.env, {
      GEMINI_API_KEY: 'test-gemini-key',
    });
    Reflect.deleteProperty(process.env, 'LANGSMITH_API_KEY');
    vi.resetModules();

    tempRootDir = await mkdtemp(path.join(os.tmpdir(), 'omnicrawl-execution-empty-env-'));
    vi.doMock('@/server/control-plane/paths', async () => {
      const actual = await vi.importActual<typeof import('@/server/control-plane/paths')>(
        '@/server/control-plane/paths',
      );

      return {
        ...actual,
        ingestionAppRootDir: tempRootDir,
      };
    });

    try {
      const { assertExecutableRunPrerequisites } = await import('@/server/control-plane/execution');

      await expect(
        assertExecutableRunPrerequisites(
          buildManifest({
            mode: 'crawl_and_ingest',
            runtimeProfileSnapshot: {
              id: 'runtime-test',
              name: 'Runtime test',
              crawlerMaxConcurrency: 1,
              crawlerMaxRequestsPerMinute: 30,
              ingestionConcurrency: 1,
              ingestionEnabled: true,
              debugLog: false,
            },
            structuredOutputDestinationSnapshots: [
              {
                id: 'json-download',
                name: 'Downloadable JSON',
                type: 'downloadable_json' as const,
                config: {
                  storageType: 'local_filesystem' as const,
                  basePath: '/tmp/omnicrawl-control-plane-execution-test/json-output',
                },
              },
            ],
          }),
        ),
      ).rejects.toThrow(/LANGSMITH_API_KEY/i);
    } finally {
      vi.doUnmock('@/server/control-plane/paths');
    }
  });

  it('allows local_cli fixture ingestion preflight without LLM secrets', async () => {
    Object.assign(process.env, {
      CONTROL_PLANE_INGESTION_PARSER_BACKEND: 'fixture',
    });
    Reflect.deleteProperty(process.env, 'GEMINI_API_KEY');
    Reflect.deleteProperty(process.env, 'LANGSMITH_API_KEY');
    vi.resetModules();

    const { assertExecutableRunPrerequisites, buildIngestionWorkerEnvOverrides } =
      await import('@/server/control-plane/execution');

    const manifest = buildManifest({
      mode: 'crawl_and_ingest',
      runtimeProfileSnapshot: {
        id: 'runtime-test',
        name: 'Runtime test',
        crawlerMaxConcurrency: 1,
        crawlerMaxRequestsPerMinute: 30,
        ingestionConcurrency: 1,
        ingestionEnabled: true,
        debugLog: false,
      },
      structuredOutputDestinationSnapshots: [
        {
          id: 'json-download',
          name: 'Downloadable JSON',
          type: 'downloadable_json' as const,
          config: {
            storageType: 'local_filesystem' as const,
            basePath: '/tmp/omnicrawl-control-plane-execution-test/json-output',
          },
        },
      ],
    });

    await expect(assertExecutableRunPrerequisites(manifest)).resolves.toBeUndefined();

    const ingestionEnv = buildIngestionWorkerEnvOverrides({
      manifest,
      mongoDbName: 'omni-crawl-prague-tech-jobs',
    });
    expect(ingestionEnv.INGESTION_PARSER_BACKEND).toBe('fixture');
  });

  it('detects worker keys from app-local env files for local_cli preflight', async () => {
    const { hasWorkerEnvValueInAppDir } = await import('@/server/control-plane/execution');
    tempRootDir = await mkdtemp(path.join(os.tmpdir(), 'omnicrawl-execution-env-'));

    await writeFile(
      path.join(tempRootDir, '.env.local'),
      'GEMINI_API_KEY=test-gemini-key\n',
      'utf8',
    );

    await expect(hasWorkerEnvValueInAppDir(tempRootDir, 'GEMINI_API_KEY')).resolves.toBe(true);
    await expect(hasWorkerEnvValueInAppDir(tempRootDir, 'MISSING_KEY')).resolves.toBe(false);
  });
});
