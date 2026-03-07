import {
  crawlerStartRunRequestV2Schema,
  ingestionStartRunRequestV2Schema,
  startRunResponseV2Schema,
} from '@repo/control-plane-contracts';
import type { EnvSchema } from './env.js';
import { buildAuthHeaders } from './auth.js';

const WORKER_HTTP_TIMEOUT_MS = 10_000;

export class WorkerClientError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkerClientError';
  }
}

export class WorkerClient {
  public constructor(private readonly env: EnvSchema) {}

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

  public async cancelIngestionRun(runId: string): Promise<'accepted' | 'not_found'> {
    return this.postCancelRun(this.env.INGESTION_WORKER_BASE_URL, runId);
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

  private async postCancelRun(baseUrl: string, runId: string): Promise<'accepted' | 'not_found'> {
    const response = await fetch(new URL(`/v1/runs/${runId}/cancel`, baseUrl), {
      method: 'POST',
      headers: buildAuthHeaders(this.env.CONTROL_SHARED_TOKEN),
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
}
