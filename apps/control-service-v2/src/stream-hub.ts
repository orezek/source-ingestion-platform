import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import {
  controlServiceSseEventV2Schema,
  controlServiceSseHeartbeatEventV2Schema,
  controlServiceSseHelloEventV2Schema,
  controlServiceSseRunEventAppendedEventV2Schema,
  controlServiceSseRunUpsertedEventV2Schema,
  controlServiceStreamQueryV2Schema,
} from '@repo/control-plane-contracts';
import type { ControlPlaneRun, ControlPlaneRunEventIndex } from './run-model.js';
import type { ControlServiceState } from './service-state.js';

type ControlServiceStreamQuery = z.infer<typeof controlServiceStreamQueryV2Schema>;

type StreamListener = {
  filters: ControlServiceStreamQuery;
  send: (chunk: string) => void;
};

function formatSseEvent(input: { event: string; id: string; data: unknown }): string {
  return `id: ${input.id}\nevent: ${input.event}\ndata: ${JSON.stringify(input.data)}\n\n`;
}

export class StreamHub {
  private readonly listeners = new Map<string, StreamListener>();
  private readonly logger: FastifyBaseLogger;

  public constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  public subscribe(input: StreamListener): () => void {
    const id = randomUUID();
    this.listeners.set(id, input);

    return () => {
      this.listeners.delete(id);
    };
  }

  public buildHelloEvent(filters: ControlServiceStreamQuery, heartbeatIntervalMs: number): string {
    const envelope = controlServiceSseHelloEventV2Schema.parse({
      id: randomUUID(),
      event: 'stream.hello',
      data: {
        connectedAt: new Date().toISOString(),
        filters,
        heartbeatIntervalSeconds: Math.max(1, Math.floor(heartbeatIntervalMs / 1_000)),
      },
    });

    return formatSseEvent(envelope);
  }

  public buildHeartbeatEvent(state: ControlServiceState): string {
    const envelope = controlServiceSseHeartbeatEventV2Schema.parse({
      id: randomUUID(),
      event: 'stream.heartbeat',
      data: state.buildHeartbeat(new Date().toISOString()),
    });

    return formatSseEvent(envelope);
  }

  public publishRunUpserted(run: ControlPlaneRun): void {
    const envelope = controlServiceSseRunUpsertedEventV2Schema.parse({
      id: randomUUID(),
      event: 'run.upserted',
      data: { run },
    });

    this.broadcast(envelope, { pipelineId: run.pipelineId, runId: run.runId });
  }

  public publishRunEventAppended(event: ControlPlaneRunEventIndex, pipelineId?: string): void {
    const envelope = controlServiceSseRunEventAppendedEventV2Schema.parse({
      id: randomUUID(),
      event: 'run.event.appended',
      data: { event },
    });

    this.broadcast(envelope, { pipelineId, runId: event.runId });
  }

  private broadcast(
    envelope: ReturnType<typeof controlServiceSseEventV2Schema.parse>,
    scope: { pipelineId?: string; runId: string },
  ): void {
    const payload = formatSseEvent(envelope);

    for (const listener of this.listeners.values()) {
      if (listener.filters.runId && listener.filters.runId !== scope.runId) {
        continue;
      }

      if (listener.filters.pipelineId && listener.filters.pipelineId !== scope.pipelineId) {
        continue;
      }

      try {
        listener.send(payload);
      } catch (error) {
        this.logger.warn({ err: error }, 'Failed to write SSE event to client.');
      }
    }
  }
}
