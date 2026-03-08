import {
  crawlerStartRunRequestV2Schema,
  ingestionCancelRunRequestV2Schema,
  ingestionStartRunRequestV2Schema,
  startRunResponseV2Schema,
} from '@repo/control-plane-contracts';
import { z } from 'zod';
import type { EnvSchema } from './env.js';
import { buildAuthHeaders } from './auth.js';

const WORKER_HTTP_TIMEOUT_MS = 10_000;
const WORKER_READY_TIMEOUT_MS = 2_000;
const WORKER_READY_ATTEMPTS = 3;
const WORKER_READY_BACKOFF_MS = 500;
const workerReadyzResponseSchema = z
  .object({
    ok: z.boolean(),
  })
  .passthrough();

export class WorkerClientError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkerClientError';
  }
}

export class WorkerClient {
  public constructor(private readonly env: EnvSchema) {}

  public async ensureCrawlerReady(): Promise<void> {
    await this.ensureWorkerReady(this.env.CRAWLER_WORKER_BASE_URL, 'crawler');
  }

  public async ensureIngestionReady(): Promise<void> {
    await this.ensureWorkerReady(this.env.INGESTION_WORKER_BASE_URL, 'ingestion');
  }

  public async startCrawlerRun(payload: unknown) {
    const parsedPayload = crawlerStartRunRequestV2Schema.parse(payload);
    return this.postStartRun(this.env.CRAWLER_WORKER_BASE_URL, parsedPayload);
  }

  public async startIngestionRun(payload: unknown) {
    const parsedPayload = ingestionStartRunRequestV2Schema.parse(payload);
    return this.postStartRun(this.env.INGESTION_WORKER_BASE_URL, parsedPayload);
  }

  public async cancelCrawlerRun(runId: string): Promise<'accepted' | 'not_found'> {
    return this.postCancelRun(this.env.CRAWLER_WORKER_BASE_URL, runId);
  }

  public async cancelIngestionRun(payload: {
    runId: string;
    reason: 'startup_rollback' | 'operator_request';
    details?: Record<string, unknown>;
  }): Promise<'accepted' | 'not_found'> {
    const parsedPayload = ingestionCancelRunRequestV2Schema.parse({
      reason: payload.reason,
      ...(payload.details ? { details: payload.details } : {}),
    });

    return this.postCancelRun(this.env.INGESTION_WORKER_BASE_URL, payload.runId, parsedPayload);
  }

  private async ensureWorkerReady(
    baseUrl: string,
    workerLabel: 'crawler' | 'ingestion',
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= WORKER_READY_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(new URL('/readyz', baseUrl), {
          method: 'GET',
          headers: buildAuthHeaders(this.env.CONTROL_SHARED_TOKEN),
          signal: AbortSignal.timeout(WORKER_READY_TIMEOUT_MS),
        });
        const body = await this.parseJsonBody(response);
        const parsedBody = workerReadyzResponseSchema.safeParse(body);
        if (!response.ok || !parsedBody.success || !parsedBody.data.ok) {
          throw new WorkerClientError(
            `${workerLabel} worker readiness check failed (${response.status}).`,
          );
        }

        return;
      } catch (error) {
        lastError = error;
        if (attempt < WORKER_READY_ATTEMPTS) {
          await this.sleep(WORKER_READY_BACKOFF_MS);
        }
      }
    }

    if (lastError instanceof WorkerClientError) {
      throw lastError;
    }

    if (lastError instanceof Error) {
      throw new WorkerClientError(
        `${workerLabel} worker readiness check failed: ${lastError.message}`,
      );
    }

    throw new WorkerClientError(`${workerLabel} worker readiness check failed.`);
  }

  private async postStartRun(baseUrl: string, payload: unknown) {
    const response = await fetch(new URL('/v1/runs', baseUrl), {
      method: 'POST',
      headers: buildAuthHeaders(this.env.CONTROL_SHARED_TOKEN),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WORKER_HTTP_TIMEOUT_MS),
    });

    const body = await this.parseJsonBody(response);
    const parsed = startRunResponseV2Schema.safeParse(body);
    if (!parsed.success) {
      throw new WorkerClientError(
        `Worker returned invalid StartRun response (${response.status}).`,
      );
    }

    if (!response.ok || !parsed.data.ok || !parsed.data.accepted) {
      const message = parsed.data.ok
        ? 'Worker rejected StartRun request.'
        : parsed.data.error.message;
      throw new WorkerClientError(message);
    }

    return parsed.data;
  }

  private async postCancelRun(
    baseUrl: string,
    runId: string,
    payload?: unknown,
  ): Promise<'accepted' | 'not_found'> {
    const response = await fetch(new URL(`/v1/runs/${runId}/cancel`, baseUrl), {
      method: 'POST',
      headers: buildAuthHeaders(this.env.CONTROL_SHARED_TOKEN),
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(WORKER_HTTP_TIMEOUT_MS),
    });

    if (response.status === 404) {
      return 'not_found';
    }

    if (!response.ok) {
      const body = await response.text();
      throw new WorkerClientError(`Worker cancel request failed (${response.status}): ${body}`);
    }

    return 'accepted';
  }

  private async parseJsonBody(response: Response): Promise<unknown> {
    const raw = await response.text();

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new WorkerClientError(`Worker returned non-JSON response (${response.status}): ${raw}`);
    }
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }
}
