import { PubSub, type Message, type Subscription } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import Fastify from 'fastify';
import { MongoClient } from 'mongodb';
import { ingestionStartRunRequestV2Schema } from '@repo/control-plane-contracts';
import { AuthError, assertControlAuth } from './auth.js';
import { envs } from './env.js';
import { ConflictError, IngestionWorkerRuntime, NotFoundError } from './runtime.js';

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

function isAuthExemptPath(pathname: string): boolean {
  return pathname === '/healthz' || pathname === '/readyz';
}

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: envs.LOG_LEVEL,
    },
  });

  const mongoClient = new MongoClient(envs.MONGODB_URI);
  const storage = new Storage({ projectId: envs.GCP_PROJECT_ID });
  const pubsub = new PubSub({ projectId: envs.GCP_PROJECT_ID });
  const eventsTopic = pubsub.topic(envs.PUBSUB_EVENTS_TOPIC);
  const outputsBucket = storage.bucket(envs.OUTPUTS_BUCKET);

  await mongoClient.connect();
  await mongoClient.db().command({ ping: 1 });

  const runtime = new IngestionWorkerRuntime({
    env: envs,
    logger: app.log,
    eventsTopic,
    storage,
    outputsBucket,
    mongoClient,
  });
  await runtime.initialize();

  let subscription: Subscription | null = null;
  const subscriptionName =
    envs.PUBSUB_EVENTS_SUBSCRIPTION ?? `${envs.SERVICE_NAME}-events-subscription`;

  if (envs.ENABLE_PUBSUB_CONSUMER) {
    subscription = await ensureSubscription({
      pubsub,
      topicName: envs.PUBSUB_EVENTS_TOPIC,
      subscriptionName,
      autoCreate: envs.PUBSUB_AUTO_CREATE_SUBSCRIPTION,
    });

    const messageHandler = async (message: Message): Promise<void> => {
      try {
        await runtime.handlePubSubMessage(message.data.toString('utf8'));
        message.ack();
      } catch (error) {
        app.log.error({ err: error }, 'Failed to process Pub/Sub message.');
        message.nack();
      }
    };

    subscription.on('message', (message) => {
      void messageHandler(message);
    });

    subscription.on('error', (error: Error) => {
      app.log.error({ err: error }, 'Pub/Sub subscription error.');
      runtime.setPubSubConsumerReady(false);
    });

    runtime.setPubSubConsumerReady(true);
  } else {
    runtime.setPubSubConsumerReady(true);
  }

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? request.url;
    if (isAuthExemptPath(pathname)) {
      return;
    }

    try {
      assertControlAuth(request, envs);
    } catch (error) {
      if (error instanceof AuthError) {
        await reply.code(401).send({
          ok: false,
          error: error.message,
        });
        return;
      }

      throw error;
    }
  });

  app.get('/healthz', async () => ({
    ok: true,
    serviceName: envs.SERVICE_NAME,
    serviceVersion: envs.SERVICE_VERSION,
  }));

  app.get('/readyz', async () => ({
    ok: runtime.isReady(),
    serviceName: envs.SERVICE_NAME,
    subscriptionEnabled: envs.ENABLE_PUBSUB_CONSUMER,
  }));

  app.get('/v1/capabilities', async () => ({
    contractVersion: 'v2',
    workerType: 'ingestion',
    endpoints: [
      'GET /healthz',
      'GET /readyz',
      'GET /v1/capabilities',
      'POST /v1/runs',
      'GET /v1/runs/{runId}',
      'POST /v1/runs/{runId}/cancel',
      'GET /v1/runs/{runId}/outputs',
    ],
    transport: {
      eventBroker: 'gcp_pubsub',
      outputStorage: 'gcs',
      persistence: 'mongodb',
    },
  }));

  app.post('/v1/runs', async (request, reply) => {
    const parsed = ingestionStartRunRequestV2Schema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: 'Invalid StartRun payload.',
        issues: parsed.error.issues,
      };
    }

    try {
      const response = await runtime.startRun(parsed.data);
      reply.code(response.deduplicated ? 200 : 202);
      return response;
    } catch (error) {
      if (error instanceof ConflictError) {
        reply.code(error.statusCode);
        return {
          ok: false,
          error: error.message,
          code: 'RUN_ID_CONFLICT',
        };
      }

      throw error;
    }
  });

  app.get('/v1/runs/:runId', async (request, reply) => {
    try {
      return runtime.getRun((request.params as { runId: string }).runId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.code(error.statusCode);
        return {
          ok: false,
          error: error.message,
        };
      }

      throw error;
    }
  });

  app.post('/v1/runs/:runId/cancel', async (request, reply) => {
    try {
      return await runtime.cancelRun((request.params as { runId: string }).runId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.code(error.statusCode);
        return {
          ok: false,
          error: error.message,
        };
      }

      throw error;
    }
  });

  app.get('/v1/runs/:runId/outputs', async (request, reply) => {
    try {
      return runtime.getRunOutputs((request.params as { runId: string }).runId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.code(error.statusCode);
        return {
          ok: false,
          error: error.message,
        };
      }

      throw error;
    }
  });

  app.addHook('onClose', async () => {
    if (subscription) {
      subscription.removeAllListeners();
      await subscription.close();
    }

    await mongoClient.close();
  });

  await app.listen({ host: '0.0.0.0', port: envs.PORT });
  app.log.info(
    {
      port: envs.PORT,
      serviceName: envs.SERVICE_NAME,
      serviceVersion: envs.SERVICE_VERSION,
      topic: envs.PUBSUB_EVENTS_TOPIC,
      subscription: subscriptionName,
      outputBucket: envs.OUTPUTS_BUCKET,
      parserBackend: envs.INGESTION_PARSER_BACKEND,
      parserVersion: envs.PARSER_VERSION,
    },
    'Ingestion worker v2 started.',
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
