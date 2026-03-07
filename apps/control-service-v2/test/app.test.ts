import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerControlServiceRoutes } from '../src/app.js';
import type { EnvSchema } from '../src/env.js';
import { ControlServiceState } from '../src/service-state.js';
import { StreamHub } from '../src/stream-hub.js';

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
    CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND: 'local_filesystem',
    CONTROL_PLANE_ARTIFACT_STORAGE_LOCAL_BASE_PATH: 'control-plane-artifacts',
    CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET: undefined,
    CONTROL_PLANE_ARTIFACT_STORAGE_GCS_PREFIX: '',
    GCP_PROJECT_ID: 'omnicrawl-dev',
    PUBSUB_EVENTS_TOPIC: 'run-events',
    PUBSUB_EVENTS_SUBSCRIPTION: 'control-service-events',
    PUBSUB_AUTO_CREATE_SUBSCRIPTION: true,
    ENABLE_PUBSUB_CONSUMER: false,
    SSE_HEARTBEAT_INTERVAL_MS: 15_000,
    ...overrides,
  };
}

test('healthz is auth-exempt and heartbeat requires bearer auth', async () => {
  const app = Fastify({ logger: false });
  const env = createEnv();
  const state = new ControlServiceState({
    serviceName: env.SERVICE_NAME,
    serviceVersion: env.SERVICE_VERSION,
    subscriptionEnabled: env.ENABLE_PUBSUB_CONSUMER,
  });
  state.setMongoReady(true);
  state.setConsumerReady(true);

  const streamHub = new StreamHub(app.log);
  const fakeService = {
    async createPipeline() {
      return {};
    },
    async listPipelines() {
      return { items: [], nextCursor: null };
    },
    async getPipeline() {
      return {};
    },
    async updatePipeline() {
      return {};
    },
    async startPipelineRun() {
      return {
        ok: true,
        accepted: true,
        pipelineId: 'pipeline-1',
        runId: 'run-1',
        status: 'queued',
      };
    },
    async cancelRun() {
      return { ok: true, accepted: true, runId: 'run-1' };
    },
    async listRuns() {
      return { items: [], nextCursor: null };
    },
    async getRun() {
      return {};
    },
    async listRunEvents() {
      return { items: [], nextCursor: null };
    },
  };

  registerControlServiceRoutes(app, {
    env,
    service: fakeService,
    state,
    streamHub,
  });

  const healthz = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(healthz.statusCode, 200);

  const heartbeatUnauthorized = await app.inject({ method: 'GET', url: '/heartbeat' });
  assert.equal(heartbeatUnauthorized.statusCode, 401);

  const heartbeatAuthorized = await app.inject({
    method: 'GET',
    url: '/heartbeat',
    headers: {
      authorization: `Bearer ${env.CONTROL_SHARED_TOKEN}`,
    },
  });
  assert.equal(heartbeatAuthorized.statusCode, 200);

  await app.close();
});
