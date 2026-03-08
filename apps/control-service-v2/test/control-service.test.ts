import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientSession } from 'mongodb';
import {
  controlPlanePipelineV2Fixture,
  listControlPlanePipelinesResponseV2Schema,
  listControlPlaneRunEventsResponseV2Schema,
  listControlPlaneRunsResponseV2Schema,
} from '@repo/control-plane-contracts';
import { ControlService } from '../src/control-service.js';
import { WorkerClientError } from '../src/worker-client.js';
import type { EnvSchema } from '../src/env.js';
import type { ControlPlaneStore } from '../src/repository.js';
import { buildPipelineDbName } from '../src/run-model.js';
import { ControlServiceState } from '../src/service-state.js';
import { StreamHub } from '../src/stream-hub.js';
import type {
  ControlPlanePipeline,
  ControlPlaneRun,
  ControlPlaneRunEventIndex,
  ControlPlaneRunManifest,
} from '../src/run-model.js';

function createEnv(overrides: Partial<EnvSchema> = {}): EnvSchema {
  return {
    PORT: 8080,
    HOST: '0.0.0.0',
    SERVICE_NAME: 'control-service-v2',
    SERVICE_VERSION: 'test',
    LOG_LEVEL: 'silent',
    LOG_PRETTY: false,
    CONTROL_SHARED_TOKEN: 'test-token',
    MONGODB_URI: 'mongodb://localhost:27017/omnicrawl',
    CONTROL_PLANE_DB_NAME: 'control-plane',
    CRAWLER_WORKER_BASE_URL: 'http://crawler-worker:3010',
    INGESTION_WORKER_BASE_URL: 'http://ingestion-worker:3020',
    CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND: 'gcs',
    CONTROL_PLANE_ARTIFACT_STORAGE_LOCAL_BASE_PATH: 'control-plane-artifacts',
    CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET: 'control-plane-artifacts',
    CONTROL_PLANE_ARTIFACT_STORAGE_GCS_PREFIX: 'runs',
    GCP_PROJECT_ID: 'omnicrawl-dev',
    PUBSUB_EVENTS_TOPIC: 'run-events',
    PUBSUB_EVENTS_SUBSCRIPTION: 'control-service-events',
    PUBSUB_AUTO_CREATE_SUBSCRIPTION: true,
    ENABLE_PUBSUB_CONSUMER: true,
    SSE_HEARTBEAT_INTERVAL_MS: 15_000,
    ...overrides,
  };
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
    fatal() {},
    child() {
      return this;
    },
  } as const;
}

class InMemoryStore implements ControlPlaneStore {
  public readonly pipelines = new Map<string, ControlPlanePipeline>();
  public readonly runs = new Map<string, ControlPlaneRun>();
  public readonly manifests = new Map<string, ControlPlaneRunManifest>();
  public readonly events = new Map<string, ControlPlaneRunEventIndex>();

  public async ensureIndexes(): Promise<void> {}

  public async withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    return fn({} as ClientSession);
  }

  public async createPipeline(pipeline: ControlPlanePipeline): Promise<ControlPlanePipeline> {
    this.pipelines.set(pipeline.pipelineId, pipeline);
    return pipeline;
  }

  public async getPipeline(pipelineId: string): Promise<ControlPlanePipeline | null> {
    return this.pipelines.get(pipelineId) ?? null;
  }

  public async updatePipelineName(
    pipelineId: string,
    name: string,
  ): Promise<ControlPlanePipeline | null> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      return null;
    }

    const updated = {
      ...pipeline,
      name,
      updatedAt: '2026-03-07T11:00:00.000Z',
    } satisfies ControlPlanePipeline;
    this.pipelines.set(pipelineId, updated);
    return updated;
  }

  public async listPipelines() {
    return listControlPlanePipelinesResponseV2Schema.parse({
      items: [...this.pipelines.values()],
      nextCursor: null,
    });
  }

  public async createRunAndManifest(input: {
    run: ControlPlaneRun;
    manifest: ControlPlaneRunManifest;
  }): Promise<void> {
    this.runs.set(input.run.runId, input.run);
    this.manifests.set(input.manifest.runId, input.manifest);
  }

  public async getRun(runId: string): Promise<ControlPlaneRun | null> {
    return this.runs.get(runId) ?? null;
  }

  public async getRunManifest(runId: string): Promise<ControlPlaneRunManifest | null> {
    return this.manifests.get(runId) ?? null;
  }

  public async replaceRun(run: ControlPlaneRun): Promise<ControlPlaneRun> {
    this.runs.set(run.runId, run);
    return run;
  }

  public async insertRunEvent(
    event: ControlPlaneRunEventIndex,
  ): Promise<ControlPlaneRunEventIndex> {
    if (this.events.has(event.eventId)) {
      const duplicate = new Error('Duplicate key');
      Object.assign(duplicate, { code: 11_000 });
      throw duplicate;
    }

    this.events.set(event.eventId, event);
    return event;
  }

  public async updateRunEventProjectionStatus(
    eventId: string,
    projectionStatus: 'applied' | 'orphaned',
  ): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) {
      return;
    }

    this.events.set(eventId, {
      ...event,
      projectionStatus,
    });
  }

  public async findActiveRunForPipeline(pipelineId: string): Promise<ControlPlaneRun | null> {
    for (const run of this.runs.values()) {
      if (run.pipelineId === pipelineId && (run.status === 'queued' || run.status === 'running')) {
        return run;
      }
    }

    return null;
  }

  public async listRuns() {
    return listControlPlaneRunsResponseV2Schema.parse({
      items: [...this.runs.values()],
      nextCursor: null,
    });
  }

  public async listRunEvents() {
    return listControlPlaneRunEventsResponseV2Schema.parse({
      items: [...this.events.values()],
      nextCursor: null,
    });
  }
}

test('startPipelineRun dispatches ingestion first then crawler for crawl_and_ingest', async () => {
  const store = new InMemoryStore();
  store.pipelines.set(controlPlanePipelineV2Fixture.pipelineId, controlPlanePipelineV2Fixture);

  const calls: string[] = [];
  const workerClient = {
    async ensureCrawlerReady() {
      calls.push('ready:crawler');
    },
    async ensureIngestionReady() {
      calls.push('ready:ingestion');
    },
    async startIngestionRun(payload: { runId: string }) {
      calls.push(`ingestion:${payload.runId}`);
      return {
        ok: true as const,
        accepted: true as const,
        deduplicated: false as const,
        state: 'accepted' as const,
        workerType: 'ingestion' as const,
        runId: payload.runId,
        contractVersion: 'v2' as const,
      };
    },
    async startCrawlerRun(payload: { runId: string }) {
      calls.push(`crawler:${payload.runId}`);
      return {
        ok: true as const,
        accepted: true as const,
        deduplicated: false as const,
        state: 'accepted' as const,
        workerType: 'crawler' as const,
        runId: payload.runId,
        contractVersion: 'v2' as const,
      };
    },
    async cancelCrawlerRun() {
      return 'accepted' as const;
    },
    async cancelIngestionRun(_payload: { runId: string; reason: string }) {
      return 'accepted' as const;
    },
  };

  const logger = createLogger();
  const streamHub = new StreamHub(logger as never);
  const state = new ControlServiceState({
    serviceName: 'control-service-v2',
    serviceVersion: 'test',
    subscriptionEnabled: true,
  });
  const service = new ControlService(
    createEnv(),
    store,
    workerClient,
    state,
    streamHub,
    logger as never,
  );

  const response = await service.startPipelineRun(controlPlanePipelineV2Fixture.pipelineId);

  assert.equal(response.pipelineId, controlPlanePipelineV2Fixture.pipelineId);
  assert.equal(response.status, 'queued');
  assert.equal(calls.length, 4);
  assert.equal(calls[0], 'ready:crawler');
  assert.equal(calls[1], 'ready:ingestion');
  assert.equal(calls[2]?.startsWith('ingestion:'), true);
  assert.equal(calls[3]?.startsWith('crawler:'), true);

  const persistedRun = store.runs.get(response.runId);
  assert.ok(persistedRun);
  assert.equal(persistedRun?.status, 'queued');

  const persistedManifest = store.manifests.get(response.runId);
  assert.ok(persistedManifest);
  assert.equal(persistedManifest?.workerCommands.crawler.artifactSink.type, 'gcs');
});

test('createPipeline derives a Mongo-safe hidden dbName from the display name', async () => {
  const store = new InMemoryStore();
  const logger = createLogger();
  const service = new ControlService(
    createEnv(),
    store,
    {
      async ensureCrawlerReady() {
        return undefined;
      },
      async ensureIngestionReady() {
        return undefined;
      },
      async startCrawlerRun() {
        throw new Error('not used');
      },
      async startIngestionRun() {
        throw new Error('not used');
      },
      async cancelCrawlerRun() {
        throw new Error('not used');
      },
      async cancelIngestionRun() {
        throw new Error('not used');
      },
    },
    new ControlServiceState({
      serviceName: 'control-service-v2',
      serviceVersion: 'test',
      subscriptionEnabled: true,
    }),
    new StreamHub(logger as never),
    logger as never,
  );

  const pipeline = await service.createPipeline({
    name: 'Vyvoj aplikaci a systemu',
    source: 'jobs.cz',
    mode: 'crawl_and_ingest',
    searchSpace: {
      id: 'vyvoj-aplikaci-a-systemu',
      name: 'Vyvoj aplikaci a systemu',
      description: 'Regression case for Mongo-safe db naming.',
      startUrls: ['https://example.com/jobs'],
      maxItems: 25,
      allowInactiveMarking: false,
    },
    runtimeProfile: {
      id: 'runtime-vyvoj',
      name: 'Vyvoj Runtime',
      crawlerMaxConcurrency: 3,
      crawlerMaxRequestsPerMinute: 60,
      ingestionConcurrency: 4,
      ingestionEnabled: true,
      debugLog: false,
    },
    structuredOutput: {
      destinations: [{ type: 'mongodb' }],
    },
  });

  assert.equal(pipeline.dbName, buildPipelineDbName(pipeline.name, pipeline.pipelineId));
  assert.equal(pipeline.dbName.endsWith(pipeline.pipelineId.split('-').at(-1)!), true);
  assert.equal(Buffer.byteLength(pipeline.dbName, 'utf8') <= 38, true);
  assert.notEqual(pipeline.dbName, pipeline.pipelineId);
});

test('startPipelineRun rejects stored pipelines with an overlong dbName', async () => {
  const store = new InMemoryStore();
  store.pipelines.set(controlPlanePipelineV2Fixture.pipelineId, {
    ...controlPlanePipelineV2Fixture,
    dbName: 'pipeline-vyvoj-aplikaci-a-systemu-cee0eec9',
  });

  const logger = createLogger();
  const service = new ControlService(
    createEnv(),
    store,
    {
      async ensureCrawlerReady() {
        return undefined;
      },
      async ensureIngestionReady() {
        return undefined;
      },
      async startCrawlerRun() {
        throw new Error('not used');
      },
      async startIngestionRun() {
        throw new Error('not used');
      },
      async cancelCrawlerRun() {
        throw new Error('not used');
      },
      async cancelIngestionRun() {
        throw new Error('not used');
      },
    },
    new ControlServiceState({
      serviceName: 'control-service-v2',
      serviceVersion: 'test',
      subscriptionEnabled: true,
    }),
    new StreamHub(logger as never),
    logger as never,
  );

  await assert.rejects(
    () => service.startPipelineRun(controlPlanePipelineV2Fixture.pipelineId),
    /PIPELINE_INVALID_DB_NAME|MongoDB limit of 38 bytes/i,
  );
});

test('startPipelineRun marks run failed and cancels ingestion when crawler dispatch fails', async () => {
  const store = new InMemoryStore();
  store.pipelines.set(controlPlanePipelineV2Fixture.pipelineId, controlPlanePipelineV2Fixture);

  let cancelledRunId: string | null = null;
  let cancelReason: string | null = null;
  const workerClient = {
    async ensureCrawlerReady() {},
    async ensureIngestionReady() {},
    async startIngestionRun(payload: { runId: string }) {
      return {
        ok: true as const,
        accepted: true as const,
        deduplicated: false as const,
        state: 'accepted' as const,
        workerType: 'ingestion' as const,
        runId: payload.runId,
        contractVersion: 'v2' as const,
      };
    },
    async startCrawlerRun() {
      throw new WorkerClientError('Crawler worker unavailable.');
    },
    async cancelCrawlerRun() {
      return 'accepted' as const;
    },
    async cancelIngestionRun(payload: { runId: string; reason: string }) {
      cancelledRunId = payload.runId;
      cancelReason = payload.reason;
      return 'accepted' as const;
    },
  };

  const logger = createLogger();
  const streamHub = new StreamHub(logger as never);
  const state = new ControlServiceState({
    serviceName: 'control-service-v2',
    serviceVersion: 'test',
    subscriptionEnabled: true,
  });
  const service = new ControlService(
    createEnv(),
    store,
    workerClient,
    state,
    streamHub,
    logger as never,
  );

  await assert.rejects(
    () => service.startPipelineRun(controlPlanePipelineV2Fixture.pipelineId),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'CRAWLER_DISPATCH_FAILED');
      return true;
    },
  );

  const failedRun = [...store.runs.values()].at(0);
  assert.ok(failedRun);
  assert.equal(failedRun?.status, 'failed');
  assert.equal(failedRun?.stopReason, 'crawler_dispatch_failed');
  assert.equal(cancelledRunId, failedRun?.runId ?? null);
  assert.equal(cancelReason, 'startup_rollback');
});

test('startPipelineRun fails fast when required worker readiness check fails', async () => {
  const store = new InMemoryStore();
  store.pipelines.set(controlPlanePipelineV2Fixture.pipelineId, controlPlanePipelineV2Fixture);

  const workerClient = {
    async ensureCrawlerReady() {},
    async ensureIngestionReady() {
      throw new WorkerClientError('ingestion worker readiness check failed (503).');
    },
    async startIngestionRun() {
      throw new Error('should not be called');
    },
    async startCrawlerRun() {
      throw new Error('should not be called');
    },
    async cancelCrawlerRun() {
      return 'accepted' as const;
    },
    async cancelIngestionRun(_payload: { runId: string; reason: string }) {
      return 'accepted' as const;
    },
  };

  const logger = createLogger();
  const streamHub = new StreamHub(logger as never);
  const state = new ControlServiceState({
    serviceName: 'control-service-v2',
    serviceVersion: 'test',
    subscriptionEnabled: true,
  });
  const service = new ControlService(
    createEnv(),
    store,
    workerClient,
    state,
    streamHub,
    logger as never,
  );

  await assert.rejects(
    () => service.startPipelineRun(controlPlanePipelineV2Fixture.pipelineId),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'INGESTION_WORKER_UNAVAILABLE');
      return true;
    },
  );

  assert.equal(store.runs.size, 0);
  assert.equal(store.manifests.size, 0);
});

test('startPipelineRun marks run failed when startup rollback cancel fails', async () => {
  const store = new InMemoryStore();
  store.pipelines.set(controlPlanePipelineV2Fixture.pipelineId, controlPlanePipelineV2Fixture);

  const workerClient = {
    async ensureCrawlerReady() {},
    async ensureIngestionReady() {},
    async startIngestionRun(payload: { runId: string }) {
      return {
        ok: true as const,
        accepted: true as const,
        deduplicated: false as const,
        state: 'accepted' as const,
        workerType: 'ingestion' as const,
        runId: payload.runId,
        contractVersion: 'v2' as const,
      };
    },
    async startCrawlerRun() {
      throw new WorkerClientError('Crawler worker unavailable.');
    },
    async cancelCrawlerRun() {
      return 'accepted' as const;
    },
    async cancelIngestionRun(_payload: { runId: string; reason: string }) {
      throw new WorkerClientError('ingestion cancel request failed (500).');
    },
  };

  const logger = createLogger();
  const streamHub = new StreamHub(logger as never);
  const state = new ControlServiceState({
    serviceName: 'control-service-v2',
    serviceVersion: 'test',
    subscriptionEnabled: true,
  });
  const service = new ControlService(
    createEnv(),
    store,
    workerClient,
    state,
    streamHub,
    logger as never,
  );

  await assert.rejects(
    () => service.startPipelineRun(controlPlanePipelineV2Fixture.pipelineId),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'STARTUP_ROLLBACK_CANCEL_FAILED');
      return true;
    },
  );

  const failedRun = [...store.runs.values()].at(0);
  assert.ok(failedRun);
  assert.equal(failedRun?.status, 'failed');
  assert.equal(failedRun?.stopReason, 'startup_rollback_cancel_failed');
});
