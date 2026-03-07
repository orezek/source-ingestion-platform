import {
  controlPlanePipelineV2Schema,
  controlServiceCancelRunAcceptedResponseV2Schema,
  controlServiceStartPipelineRunAcceptedResponseV2Schema,
  createControlPlanePipelineRequestV2Schema,
  listControlPlanePipelinesQueryV2Schema,
  listControlPlaneRunEventsQueryV2Schema,
  listControlPlaneRunsQueryV2Schema,
  runtimeBrokerEventV2Schema,
  updateControlPlanePipelineRequestV2Schema,
} from '@repo/control-plane-contracts';
import type { FastifyBaseLogger } from 'fastify';
import { MongoServerError } from 'mongodb';
import type { EnvSchema } from './env.js';
import { ControlServiceError } from './errors.js';
import type { ControlPlaneStore } from './repository.js';
import {
  applyRuntimeEventToRun,
  assertPipelineCreateRequestConsistency,
  buildInitialRun,
  buildPipelineDbName,
  buildRunEventIndexRecord,
  buildRunManifest,
  generatePipelineId,
  generateRunId,
  markRunDispatchFailed,
  type ControlPlaneArtifactSink,
} from './run-model.js';
import type { ControlServiceState } from './service-state.js';
import type { StreamHub } from './stream-hub.js';
import { WorkerClientError } from './worker-client.js';

export type ControlServiceWorkerClient = Pick<
  import('./worker-client.js').WorkerClient,
  'startCrawlerRun' | 'startIngestionRun' | 'cancelCrawlerRun' | 'cancelIngestionRun'
>;

function isDuplicateKeyError(error: unknown): error is MongoServerError {
  return error instanceof MongoServerError && error.code === 11_000;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveArtifactSink(env: EnvSchema): ControlPlaneArtifactSink {
  if (env.CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND === 'gcs') {
    return {
      type: 'gcs',
      bucket: env.CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET!,
      prefix: env.CONTROL_PLANE_ARTIFACT_STORAGE_GCS_PREFIX,
    };
  }

  return {
    type: 'local_filesystem',
    basePath: env.CONTROL_PLANE_ARTIFACT_STORAGE_LOCAL_BASE_PATH,
  };
}

export class ControlService {
  private readonly artifactSink: ControlPlaneArtifactSink;

  public constructor(
    private readonly env: EnvSchema,
    private readonly store: ControlPlaneStore,
    private readonly workerClient: ControlServiceWorkerClient,
    private readonly state: ControlServiceState,
    private readonly streamHub: StreamHub,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.artifactSink = resolveArtifactSink(env);
  }

  public async createPipeline(payload: unknown) {
    const request = createControlPlanePipelineRequestV2Schema.parse(payload);
    assertPipelineCreateRequestConsistency({
      mode: request.mode,
      runtimeProfile: request.runtimeProfile,
      structuredOutput: request.structuredOutput,
    });

    const timestamp = nowIso();
    const pipelineId = generatePipelineId(request.name);
    const pipeline = controlPlanePipelineV2Schema.parse({
      ...request,
      pipelineId,
      dbName: buildPipelineDbName(pipelineId),
      version: 1,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    try {
      return await this.store.createPipeline(pipeline);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ControlServiceError({
          statusCode: 409,
          code: 'PIPELINE_CONFLICT',
          message: 'Pipeline identity conflict while creating pipeline.',
        });
      }

      throw error;
    }
  }

  public async listPipelines(query: unknown) {
    const parsedQuery = listControlPlanePipelinesQueryV2Schema.parse(query);
    return this.store.listPipelines(parsedQuery);
  }

  public async getPipeline(pipelineId: string) {
    const pipeline = await this.store.getPipeline(pipelineId);
    if (!pipeline) {
      throw new ControlServiceError({
        statusCode: 404,
        code: 'PIPELINE_NOT_FOUND',
        message: `Pipeline "${pipelineId}" was not found.`,
      });
    }

    return pipeline;
  }

  public async updatePipeline(pipelineId: string, payload: unknown) {
    const request = updateControlPlanePipelineRequestV2Schema.parse(payload);
    const pipeline = await this.store.updatePipelineName(pipelineId, request.name);
    if (!pipeline) {
      throw new ControlServiceError({
        statusCode: 404,
        code: 'PIPELINE_NOT_FOUND',
        message: `Pipeline "${pipelineId}" was not found.`,
      });
    }

    return pipeline;
  }

  public async startPipelineRun(pipelineId: string) {
    const pipeline = await this.store.getPipeline(pipelineId);
    if (!pipeline) {
      throw new ControlServiceError({
        statusCode: 404,
        code: 'PIPELINE_NOT_FOUND',
        message: `Pipeline "${pipelineId}" was not found.`,
      });
    }

    const activeRun = await this.store.findActiveRunForPipeline(pipelineId);
    if (activeRun) {
      throw new ControlServiceError({
        statusCode: 409,
        code: 'ACTIVE_RUN_EXISTS',
        message: `Pipeline "${pipelineId}" already has an active run.`,
        details: {
          activeRunId: activeRun.runId,
        },
      });
    }

    const runId = generateRunId();
    const manifest = buildRunManifest({
      pipeline,
      runId,
      createdBy: this.env.SERVICE_NAME,
      artifactSink: this.artifactSink,
    });
    const run = buildInitialRun({ pipeline, runId });

    await this.store.createRunAndManifest({ run, manifest });
    this.streamHub.publishRunUpserted(run);

    try {
      if (manifest.workerCommands.ingestion) {
        await this.workerClient.startIngestionRun(manifest.workerCommands.ingestion);
      }
    } catch (error) {
      await this.failRunAfterDispatchError(run, 'ingestion_dispatch_failed');
      throw this.mapWorkerError('INGESTION_DISPATCH_FAILED', error);
    }

    try {
      await this.workerClient.startCrawlerRun(manifest.workerCommands.crawler);
    } catch (error) {
      if (manifest.workerCommands.ingestion) {
        try {
          await this.workerClient.cancelIngestionRun(runId);
        } catch (cancelError) {
          this.logger.warn(
            {
              err: cancelError,
              runId,
            },
            'Best-effort ingestion cancel failed after crawler dispatch failure.',
          );
        }
      }

      await this.failRunAfterDispatchError(run, 'crawler_dispatch_failed');
      throw this.mapWorkerError('CRAWLER_DISPATCH_FAILED', error);
    }

    return controlServiceStartPipelineRunAcceptedResponseV2Schema.parse({
      ok: true,
      accepted: true,
      pipelineId,
      runId,
      status: 'queued',
      message: 'Run accepted for control-plane execution.',
    });
  }

  public async cancelRun(runId: string) {
    const run = await this.store.getRun(runId);
    if (!run) {
      throw new ControlServiceError({
        statusCode: 404,
        code: 'RUN_NOT_FOUND',
        message: `Run "${runId}" was not found.`,
      });
    }

    if (!['queued', 'running'].includes(run.status)) {
      return controlServiceCancelRunAcceptedResponseV2Schema.parse({
        ok: true,
        accepted: true,
        runId,
        message: 'Run is already terminal.',
      });
    }

    try {
      const crawlerResult = await this.workerClient.cancelCrawlerRun(runId);
      if (crawlerResult === 'not_found') {
        this.logger.warn({ runId }, 'Crawler worker did not find the run during cancel.');
      }

      if (run.ingestion.enabled) {
        const ingestionResult = await this.workerClient.cancelIngestionRun(runId);
        if (ingestionResult === 'not_found') {
          this.logger.warn({ runId }, 'Ingestion worker did not find the run during cancel.');
        }
      }
    } catch (error) {
      throw this.mapWorkerError('RUN_CANCEL_FAILED', error);
    }

    return controlServiceCancelRunAcceptedResponseV2Schema.parse({
      ok: true,
      accepted: true,
      runId,
      message: 'Cancellation requested.',
    });
  }

  public async listRuns(query: unknown) {
    const parsedQuery = listControlPlaneRunsQueryV2Schema.parse(query);
    return this.store.listRuns(parsedQuery);
  }

  public async getRun(runId: string) {
    const run = await this.store.getRun(runId);
    if (!run) {
      throw new ControlServiceError({
        statusCode: 404,
        code: 'RUN_NOT_FOUND',
        message: `Run "${runId}" was not found.`,
      });
    }

    return run;
  }

  public async listRunEvents(runId: string, query: unknown) {
    const run = await this.store.getRun(runId);
    if (!run) {
      throw new ControlServiceError({
        statusCode: 404,
        code: 'RUN_NOT_FOUND',
        message: `Run "${runId}" was not found.`,
      });
    }

    const parsedQuery = listControlPlaneRunEventsQueryV2Schema.parse(query);
    return this.store.listRunEvents(runId, parsedQuery);
  }

  public async handlePubSubMessage(rawMessage: string): Promise<{
    disposition: 'applied' | 'orphaned' | 'duplicate' | 'invalid';
    eventId?: string;
    runId?: string;
  }> {
    this.state.recordMessageReceived(nowIso());

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawMessage) as unknown;
    } catch (error) {
      this.state.recordError(nowIso());
      this.logger.warn({ err: error }, 'Skipping malformed Pub/Sub message payload.');
      return { disposition: 'invalid' };
    }

    const parsedEvent = runtimeBrokerEventV2Schema.safeParse(parsedJson);
    if (!parsedEvent.success) {
      this.state.recordError(nowIso());
      this.logger.warn(
        { issues: parsedEvent.error.issues },
        'Skipping invalid runtime Pub/Sub event.',
      );
      return { disposition: 'invalid' };
    }

    const runtimeEvent = parsedEvent.data;
    const indexedEvent = buildRunEventIndexRecord(runtimeEvent);

    try {
      const result = await this.store.withTransaction(async (session) => {
        await this.store.insertRunEvent(indexedEvent, session);

        const run = await this.store.getRun(runtimeEvent.runId, session);
        if (!run) {
          await this.store.updateRunEventProjectionStatus(
            runtimeEvent.eventId,
            'orphaned',
            session,
          );
          return {
            disposition: 'orphaned' as const,
            event: {
              ...indexedEvent,
              projectionStatus: 'orphaned' as const,
            },
            run: null,
          };
        }

        const nextRun = applyRuntimeEventToRun(run, runtimeEvent);
        await this.store.replaceRun(nextRun, session);
        return {
          disposition: 'applied' as const,
          event: indexedEvent,
          run: nextRun,
        };
      });

      this.state.recordMessageApplied(nowIso());
      this.streamHub.publishRunEventAppended(result.event, result.run?.pipelineId);
      if (result.run) {
        this.streamHub.publishRunUpserted(result.run);
      }

      return {
        disposition: result.disposition,
        eventId: runtimeEvent.eventId,
        runId: runtimeEvent.runId,
      };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        this.logger.debug(
          {
            eventId: runtimeEvent.eventId,
            runId: runtimeEvent.runId,
          },
          'Ignoring duplicate runtime Pub/Sub event.',
        );
        this.state.recordMessageApplied(nowIso());
        return {
          disposition: 'duplicate',
          eventId: runtimeEvent.eventId,
          runId: runtimeEvent.runId,
        };
      }

      this.state.recordError(nowIso());
      throw error;
    }
  }

  private async failRunAfterDispatchError(
    run: Parameters<typeof markRunDispatchFailed>[0],
    stopReason: Parameters<typeof markRunDispatchFailed>[1],
  ): Promise<void> {
    const failedRun = markRunDispatchFailed(run, stopReason);
    await this.store.replaceRun(failedRun);
    this.streamHub.publishRunUpserted(failedRun);
  }

  private mapWorkerError(code: string, error: unknown): ControlServiceError {
    if (error instanceof WorkerClientError) {
      return new ControlServiceError({
        statusCode: 502,
        code,
        message: error.message,
      });
    }

    return new ControlServiceError({
      statusCode: 502,
      code,
      message: 'Worker request failed.',
    });
  }
}
