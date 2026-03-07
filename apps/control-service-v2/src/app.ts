import { PubSub, type Message, type Subscription } from '@google-cloud/pubsub';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';
import { ZodError } from 'zod';
import {
  controlServiceErrorResponseV2Schema,
  controlServiceStreamQueryV2Schema,
} from '@repo/control-plane-contracts';
import { AuthError, assertControlAuth } from './auth.js';
import { ControlService } from './control-service.js';
import type { EnvSchema } from './env.js';
import { isControlServiceError } from './errors.js';
import { ControlPlaneRepository } from './repository.js';
import { ControlServiceState } from './service-state.js';
import { StreamHub } from './stream-hub.js';
import { WorkerClient } from './worker-client.js';

type RouteDeps = {
  env: EnvSchema;
  service: Pick<
    ControlService,
    | 'createPipeline'
    | 'listPipelines'
    | 'getPipeline'
    | 'updatePipeline'
    | 'startPipelineRun'
    | 'cancelRun'
    | 'listRuns'
    | 'getRun'
    | 'listRunEvents'
  >;
  state: ControlServiceState;
  streamHub: StreamHub;
};

function nowIso(): string {
  return new Date().toISOString();
}

function isAuthExemptPath(pathname: string): boolean {
  return pathname === '/healthz' || pathname === '/readyz';
}

function buildLoggerOptions(env: EnvSchema) {
  return env.LOG_PRETTY && process.stdout.isTTY
    ? {
        level: env.LOG_LEVEL,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        },
      }
    : {
        level: env.LOG_LEVEL,
      };
}

async function ensureSubscription(input: {
  pubsub: PubSub;
  topicName: string;
  subscriptionName: string;
  autoCreate: boolean;
}): Promise<Subscription> {
  const topic = input.pubsub.topic(input.topicName);
  const subscription = topic.subscription(input.subscriptionName);
  const [topicExists] = await topic.exists();
  const [subscriptionExists] = await subscription.exists();

  if (subscriptionExists) {
    return subscription;
  }

  if (!input.autoCreate) {
    throw new Error(
      `Pub/Sub subscription "${input.subscriptionName}" does not exist and auto-create is disabled.`,
    );
  }

  if (!topicExists) {
    await topic.create();
  }

  await topic.createSubscription(input.subscriptionName);
  return topic.subscription(input.subscriptionName);
}

function sendErrorResponse(
  reply: FastifyReply,
  input: {
    statusCode: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  },
) {
  const payload = controlServiceErrorResponseV2Schema.parse({
    ok: false,
    error: {
      code: input.code,
      message: input.message,
      ...(input.details ? { details: input.details } : {}),
    },
  });

  return reply.code(input.statusCode).send(payload);
}

export function registerControlServiceRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): FastifyInstance {
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? request.url;
    if (isAuthExemptPath(pathname)) {
      return;
    }

    try {
      assertControlAuth(request, deps.env);
    } catch (error) {
      if (error instanceof AuthError) {
        await sendErrorResponse(reply, {
          statusCode: error.statusCode,
          code: 'UNAUTHORIZED',
          message: error.message,
        });
        return;
      }

      throw error;
    }
  });

  app.setErrorHandler(async (error, _request, reply) => {
    if (isControlServiceError(error)) {
      return sendErrorResponse(reply, {
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    if (error instanceof ZodError) {
      return sendErrorResponse(reply, {
        statusCode: 400,
        code: 'INVALID_REQUEST',
        message: 'Request validation failed.',
        details: {
          issues: error.issues,
        },
      });
    }

    reply.log.error({ err: error }, 'Unhandled control-service request error.');
    return sendErrorResponse(reply, {
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
    });
  });

  app.get('/healthz', async () => deps.state.buildHealthz(nowIso()));

  app.get('/readyz', async (_request, reply) => {
    const response = deps.state.buildReadyz(nowIso());
    reply.code(response.ok ? 200 : 503);
    return response;
  });

  app.get('/heartbeat', async () => deps.state.buildHeartbeat(nowIso()));

  app.post('/v1/pipelines', async (request, reply) => {
    const pipeline = await deps.service.createPipeline(request.body);
    reply.code(201);
    return pipeline;
  });

  app.get('/v1/pipelines', async (request) => deps.service.listPipelines(request.query));

  app.get('/v1/pipelines/:pipelineId', async (request) =>
    deps.service.getPipeline((request.params as { pipelineId: string }).pipelineId),
  );

  app.patch('/v1/pipelines/:pipelineId', async (request) =>
    deps.service.updatePipeline(
      (request.params as { pipelineId: string }).pipelineId,
      request.body,
    ),
  );

  app.post('/v1/pipelines/:pipelineId/runs', async (request, reply) => {
    const response = await deps.service.startPipelineRun(
      (request.params as { pipelineId: string }).pipelineId,
    );
    reply.code(202);
    return response;
  });

  app.post('/v1/runs/:runId/cancel', async (request, reply) => {
    const response = await deps.service.cancelRun((request.params as { runId: string }).runId);
    reply.code(202);
    return response;
  });

  app.get('/v1/runs', async (request) => deps.service.listRuns(request.query));

  app.get('/v1/runs/:runId', async (request) =>
    deps.service.getRun((request.params as { runId: string }).runId),
  );

  app.get('/v1/runs/:runId/events', async (request) =>
    deps.service.listRunEvents((request.params as { runId: string }).runId, request.query),
  );

  app.get('/v1/stream', async (request, reply) => {
    const filters = controlServiceStreamQueryV2Schema.parse(request.query);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write(deps.streamHub.buildHelloEvent(filters, deps.env.SSE_HEARTBEAT_INTERVAL_MS));

    const unsubscribe = deps.streamHub.subscribe({
      filters,
      send: (chunk) => {
        reply.raw.write(chunk);
      },
    });

    const heartbeatTimer = setInterval(() => {
      reply.raw.write(deps.streamHub.buildHeartbeatEvent(deps.state));
    }, deps.env.SSE_HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(heartbeatTimer);
      unsubscribe();
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });

  return app;
}

async function main(): Promise<void> {
  const { envs } = await import('./env.js');
  const app = Fastify({
    logger: buildLoggerOptions(envs),
  });

  const mongoClient = new MongoClient(envs.MONGODB_URI);
  await mongoClient.connect();
  await mongoClient.db().command({ ping: 1 });

  const store = new ControlPlaneRepository(mongoClient, envs.CONTROL_PLANE_DB_NAME);
  await store.ensureIndexes();

  const pubsub = new PubSub({ projectId: envs.GCP_PROJECT_ID });
  let subscription: Subscription | null = null;

  if (envs.ENABLE_PUBSUB_CONSUMER) {
    subscription = await ensureSubscription({
      pubsub,
      topicName: envs.PUBSUB_EVENTS_TOPIC,
      subscriptionName: envs.PUBSUB_EVENTS_SUBSCRIPTION,
      autoCreate: envs.PUBSUB_AUTO_CREATE_SUBSCRIPTION,
    });
  }

  const state = new ControlServiceState({
    serviceName: envs.SERVICE_NAME,
    serviceVersion: envs.SERVICE_VERSION,
    subscriptionEnabled: envs.ENABLE_PUBSUB_CONSUMER,
  });
  state.setMongoReady(true);
  state.setSubscriptionName(envs.PUBSUB_EVENTS_SUBSCRIPTION);

  const streamHub = new StreamHub(app.log);
  const workerClient = new WorkerClient(envs);
  const service = new ControlService(envs, store, workerClient, state, streamHub, app.log);

  registerControlServiceRoutes(app, {
    env: envs,
    service,
    state,
    streamHub,
  });

  if (subscription) {
    const handleMessage = async (message: Message): Promise<void> => {
      try {
        const result = await service.handlePubSubMessage(message.data.toString('utf8'));
        app.log.debug(
          {
            disposition: result.disposition,
            eventId: result.eventId,
            runId: result.runId,
          },
          'Processed runtime Pub/Sub event.',
        );
        message.ack();
      } catch (error) {
        app.log.error({ err: error }, 'Failed to process runtime Pub/Sub event.');
        message.nack();
      }
    };

    subscription.on('message', (message) => {
      void handleMessage(message);
    });
    subscription.on('error', (error) => {
      state.setConsumerReady(false);
      state.recordError(nowIso());
      app.log.error({ err: error }, 'Pub/Sub subscription error.');
    });
    state.setConsumerReady(true);
  } else {
    state.setConsumerReady(true);
  }

  app.addHook('onClose', async () => {
    state.setConsumerReady(false);
    state.setMongoReady(false);

    if (subscription) {
      subscription.removeAllListeners();
      await subscription.close();
    }

    await mongoClient.close();
  });

  await app.listen({ host: envs.HOST, port: envs.PORT });
  app.log.info(
    {
      serviceName: envs.SERVICE_NAME,
      serviceVersion: envs.SERVICE_VERSION,
      port: envs.PORT,
      host: envs.HOST,
      mongoDbName: envs.CONTROL_PLANE_DB_NAME,
      topic: envs.PUBSUB_EVENTS_TOPIC,
      subscription: envs.PUBSUB_EVENTS_SUBSCRIPTION,
      subscriptionEnabled: envs.ENABLE_PUBSUB_CONSUMER,
    },
    'Control-service v2 started.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
