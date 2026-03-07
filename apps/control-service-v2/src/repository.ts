import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { Collection, type ClientSession, Db, type Filter, MongoClient, type Sort } from 'mongodb';
import {
  listControlPlanePipelinesQueryV2Schema,
  listControlPlanePipelinesResponseV2Schema,
  listControlPlaneRunEventsQueryV2Schema,
  listControlPlaneRunEventsResponseV2Schema,
  listControlPlaneRunsQueryV2Schema,
  listControlPlaneRunsResponseV2Schema,
} from '@repo/control-plane-contracts';
import type {
  ControlPlanePipeline,
  ControlPlaneRun,
  ControlPlaneRunEventIndex,
  ControlPlaneRunManifest,
} from './run-model.js';

type PipelineDocument = ControlPlanePipeline & { _id: string };
type RunDocument = ControlPlaneRun & { _id: string };
type RunManifestDocument = ControlPlaneRunManifest & { _id: string };
type RunEventDocument = ControlPlaneRunEventIndex & { _id: string };

function stripMongoId<T extends { _id: string }>(value: T | null): Omit<T, '_id'> | null {
  if (!value) {
    return null;
  }

  const { _id: _unused, ...rest } = value;
  return rest;
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | null {
  if (!cursor) {
    return null;
  }

  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  return schema.parse(JSON.parse(decoded) as unknown);
}

export type ControlPlaneStore = {
  ensureIndexes: () => Promise<void>;
  withTransaction: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  createPipeline: (pipeline: ControlPlanePipeline) => Promise<ControlPlanePipeline>;
  getPipeline: (
    pipelineId: string,
    session?: ClientSession,
  ) => Promise<ControlPlanePipeline | null>;
  updatePipelineName: (pipelineId: string, name: string) => Promise<ControlPlanePipeline | null>;
  listPipelines: (
    query: z.infer<typeof listControlPlanePipelinesQueryV2Schema>,
  ) => Promise<z.infer<typeof listControlPlanePipelinesResponseV2Schema>>;
  createRunAndManifest: (input: {
    run: ControlPlaneRun;
    manifest: ControlPlaneRunManifest;
  }) => Promise<void>;
  getRun: (runId: string, session?: ClientSession) => Promise<ControlPlaneRun | null>;
  getRunManifest: (
    runId: string,
    session?: ClientSession,
  ) => Promise<ControlPlaneRunManifest | null>;
  replaceRun: (run: ControlPlaneRun, session?: ClientSession) => Promise<ControlPlaneRun>;
  insertRunEvent: (
    event: ControlPlaneRunEventIndex,
    session?: ClientSession,
  ) => Promise<ControlPlaneRunEventIndex>;
  updateRunEventProjectionStatus: (
    eventId: string,
    projectionStatus: 'applied' | 'orphaned',
    session?: ClientSession,
  ) => Promise<void>;
  findActiveRunForPipeline: (pipelineId: string) => Promise<ControlPlaneRun | null>;
  listRuns: (
    query: z.infer<typeof listControlPlaneRunsQueryV2Schema>,
  ) => Promise<z.infer<typeof listControlPlaneRunsResponseV2Schema>>;
  listRunEvents: (
    runId: string,
    query: z.infer<typeof listControlPlaneRunEventsQueryV2Schema>,
  ) => Promise<z.infer<typeof listControlPlaneRunEventsResponseV2Schema>>;
};

export class ControlPlaneRepository {
  private readonly db: Db;
  private readonly pipelines: Collection<PipelineDocument>;
  private readonly runs: Collection<RunDocument>;
  private readonly runManifests: Collection<RunManifestDocument>;
  private readonly runEvents: Collection<RunEventDocument>;

  public constructor(
    private readonly mongoClient: MongoClient,
    dbName: string,
  ) {
    this.db = mongoClient.db(dbName);
    this.pipelines = this.db.collection<PipelineDocument>('control_plane_pipelines');
    this.runs = this.db.collection<RunDocument>('control_plane_runs');
    this.runManifests = this.db.collection<RunManifestDocument>('control_plane_run_manifests');
    this.runEvents = this.db.collection<RunEventDocument>('control_plane_run_event_index');
  }

  public async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.pipelines.createIndexes([
        { key: { pipelineId: 1 }, unique: true, name: 'pipeline_id_unique' },
        { key: { dbName: 1 }, unique: true, name: 'pipeline_db_name_unique' },
        { key: { status: 1, updatedAt: -1 }, name: 'pipeline_status_updated_at' },
      ]),
      this.runManifests.createIndexes([{ key: { runId: 1 }, unique: true, name: 'run_id_unique' }]),
      this.runs.createIndexes([
        { key: { runId: 1 }, unique: true, name: 'run_id_unique' },
        { key: { pipelineId: 1, requestedAt: -1 }, name: 'pipeline_requested_at' },
        { key: { status: 1, requestedAt: -1 }, name: 'status_requested_at' },
      ]),
      this.runEvents.createIndexes([
        { key: { eventId: 1 }, unique: true, name: 'event_id_unique' },
        { key: { runId: 1, occurredAt: 1 }, name: 'run_occurred_at' },
      ]),
    ]);
  }

  public async withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.mongoClient.startSession();

    try {
      return (await session.withTransaction(async () => fn(session))) as T;
    } finally {
      await session.endSession();
    }
  }

  public async createPipeline(pipeline: ControlPlanePipeline): Promise<ControlPlanePipeline> {
    await this.pipelines.insertOne({ _id: pipeline.pipelineId, ...pipeline });
    return pipeline;
  }

  public async getPipeline(
    pipelineId: string,
    session?: ClientSession,
  ): Promise<ControlPlanePipeline | null> {
    const doc = await this.pipelines.findOne({ _id: pipelineId }, { session });
    return stripMongoId(doc as PipelineDocument | null);
  }

  public async updatePipelineName(
    pipelineId: string,
    name: string,
  ): Promise<ControlPlanePipeline | null> {
    const updatedAt = new Date().toISOString();
    const result = await this.pipelines.findOneAndUpdate(
      { _id: pipelineId },
      {
        $set: {
          name,
          updatedAt,
        },
      },
      {
        returnDocument: 'after',
      },
    );

    return stripMongoId(result as PipelineDocument | null);
  }

  public async listPipelines(
    query: z.infer<typeof listControlPlanePipelinesQueryV2Schema>,
  ): Promise<z.infer<typeof listControlPlanePipelinesResponseV2Schema>> {
    const cursor = decodeCursor(
      query.cursor,
      z.object({ updatedAt: z.string(), pipelineId: z.string() }).strict(),
    );
    const clauses: Record<string, unknown>[] = [];

    if (cursor) {
      clauses.push({
        $or: [
          { updatedAt: { $lt: cursor.updatedAt } },
          { updatedAt: cursor.updatedAt, pipelineId: { $lt: cursor.pipelineId } },
        ],
      });
    }

    const filter: Filter<PipelineDocument> =
      clauses.length === 0
        ? {}
        : clauses.length === 1
          ? (clauses[0] as Filter<PipelineDocument>)
          : ({ $and: clauses } as Filter<PipelineDocument>);
    const sort: Sort = { updatedAt: -1, pipelineId: -1 };
    const docs = await this.pipelines
      .find(filter)
      .sort(sort)
      .limit(query.limit + 1)
      .toArray();
    const hasNext = docs.length > query.limit;
    const page = docs.slice(0, query.limit).map((doc) => stripMongoId(doc) as ControlPlanePipeline);
    const nextCursor =
      hasNext && page.length > 0
        ? encodeCursor({
            updatedAt: page.at(-1)?.updatedAt,
            pipelineId: page.at(-1)?.pipelineId,
          })
        : null;

    return listControlPlanePipelinesResponseV2Schema.parse({
      items: page,
      nextCursor,
    });
  }

  public async createRunAndManifest(input: {
    run: ControlPlaneRun;
    manifest: ControlPlaneRunManifest;
  }): Promise<void> {
    await this.withTransaction(async (session) => {
      await this.runs.insertOne({ _id: input.run.runId, ...input.run }, { session });
      await this.runManifests.insertOne(
        { _id: input.manifest.runId, ...input.manifest },
        { session },
      );
    });
  }

  public async getRun(runId: string, session?: ClientSession): Promise<ControlPlaneRun | null> {
    const doc = await this.runs.findOne({ _id: runId }, { session });
    return stripMongoId(doc as RunDocument | null);
  }

  public async getRunManifest(
    runId: string,
    session?: ClientSession,
  ): Promise<ControlPlaneRunManifest | null> {
    const doc = await this.runManifests.findOne({ _id: runId }, { session });
    return stripMongoId(doc as RunManifestDocument | null);
  }

  public async replaceRun(run: ControlPlaneRun, session?: ClientSession): Promise<ControlPlaneRun> {
    await this.runs.updateOne(
      { _id: run.runId },
      {
        $set: run,
      },
      { upsert: true, session },
    );
    return run;
  }

  public async insertRunEvent(
    event: ControlPlaneRunEventIndex,
    session?: ClientSession,
  ): Promise<ControlPlaneRunEventIndex> {
    await this.runEvents.insertOne({ _id: event.eventId, ...event }, { session });
    return event;
  }

  public async updateRunEventProjectionStatus(
    eventId: string,
    projectionStatus: 'applied' | 'orphaned',
    session?: ClientSession,
  ): Promise<void> {
    await this.runEvents.updateOne(
      { _id: eventId },
      {
        $set: {
          projectionStatus,
        },
      },
      { session },
    );
  }

  public async findActiveRunForPipeline(pipelineId: string): Promise<ControlPlaneRun | null> {
    const doc = await this.runs.findOne(
      {
        pipelineId,
        status: { $in: ['queued', 'running'] },
      },
      {
        sort: {
          requestedAt: -1,
          runId: -1,
        },
      },
    );

    return stripMongoId(doc as RunDocument | null);
  }

  public async listRuns(
    query: z.infer<typeof listControlPlaneRunsQueryV2Schema>,
  ): Promise<z.infer<typeof listControlPlaneRunsResponseV2Schema>> {
    const cursor = decodeCursor(
      query.cursor,
      z.object({ requestedAt: z.string(), runId: z.string() }).strict(),
    );

    const clauses: Record<string, unknown>[] = [];
    if (query.pipelineId) {
      clauses.push({ pipelineId: query.pipelineId });
    }
    if (query.status) {
      clauses.push({ status: query.status });
    }
    if (query.source) {
      clauses.push({ source: query.source });
    }
    if (cursor) {
      clauses.push({
        $or: [
          { requestedAt: { $lt: cursor.requestedAt } },
          { requestedAt: cursor.requestedAt, runId: { $lt: cursor.runId } },
        ],
      });
    }

    const filter: Filter<RunDocument> =
      clauses.length === 0
        ? {}
        : clauses.length === 1
          ? (clauses[0] as Filter<RunDocument>)
          : ({ $and: clauses } as Filter<RunDocument>);
    const sort: Sort = { requestedAt: -1, runId: -1 };
    const docs = await this.runs
      .find(filter)
      .sort(sort)
      .limit(query.limit + 1)
      .toArray();
    const hasNext = docs.length > query.limit;
    const page = docs.slice(0, query.limit).map((doc) => stripMongoId(doc) as ControlPlaneRun);
    const nextCursor =
      hasNext && page.length > 0
        ? encodeCursor({
            requestedAt: page.at(-1)?.requestedAt,
            runId: page.at(-1)?.runId,
          })
        : null;

    return listControlPlaneRunsResponseV2Schema.parse({
      items: page,
      nextCursor,
    });
  }

  public async listRunEvents(
    runId: string,
    query: z.infer<typeof listControlPlaneRunEventsQueryV2Schema>,
  ): Promise<z.infer<typeof listControlPlaneRunEventsResponseV2Schema>> {
    const cursor = decodeCursor(
      query.cursor,
      z.object({ occurredAt: z.string(), eventId: z.string() }).strict(),
    );

    const clauses: Record<string, unknown>[] = [{ runId }];
    if (cursor) {
      clauses.push({
        $or: [
          { occurredAt: { $gt: cursor.occurredAt } },
          { occurredAt: cursor.occurredAt, eventId: { $gt: cursor.eventId } },
        ],
      });
    }

    const filter: Filter<RunEventDocument> =
      clauses.length === 1
        ? (clauses[0] as Filter<RunEventDocument>)
        : ({ $and: clauses } as Filter<RunEventDocument>);
    const sort: Sort = { occurredAt: 1, eventId: 1 };
    const docs = await this.runEvents
      .find(filter)
      .sort(sort)
      .limit(query.limit + 1)
      .toArray();
    const hasNext = docs.length > query.limit;
    const page = docs
      .slice(0, query.limit)
      .map((doc) => stripMongoId(doc) as ControlPlaneRunEventIndex);
    const nextCursor =
      hasNext && page.length > 0
        ? encodeCursor({
            occurredAt: page.at(-1)?.occurredAt,
            eventId: page.at(-1)?.eventId,
          })
        : null;

    return listControlPlaneRunEventsResponseV2Schema.parse({
      items: page,
      nextCursor,
    });
  }
}
