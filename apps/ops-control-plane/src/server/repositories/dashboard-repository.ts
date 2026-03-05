import fs from 'node:fs/promises';
import path from 'node:path';
import { getMongoDb } from '@/server/mongo';
import { env } from '@/server/env';
import type { CrawlerRunSummaryDoc, IngestionRunSummaryDoc, TimeRange } from '@/server/types';
import { getRangeStart } from '@/server/lib/time-range';

export interface DashboardRepository {
  listCrawlerRuns(timeRange: TimeRange): Promise<CrawlerRunSummaryDoc[]>;
  getCrawlerRun(crawlRunId: string): Promise<CrawlerRunSummaryDoc | null>;
  listIngestionRuns(timeRange: TimeRange): Promise<IngestionRunSummaryDoc[]>;
  getIngestionRun(runId: string): Promise<IngestionRunSummaryDoc | null>;
  getIngestionRunByCrawlRunId(crawlRunId: string): Promise<IngestionRunSummaryDoc | null>;
}

class MongoDashboardRepository implements DashboardRepository {
  async listCrawlerRuns(timeRange: TimeRange): Promise<CrawlerRunSummaryDoc[]> {
    const db = await getMongoDb();
    const start = getRangeStart(timeRange).toISOString();
    return db
      .collection<CrawlerRunSummaryDoc>(env.MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION)
      .find({ startedAt: { $gte: start } })
      .sort({ startedAt: -1 })
      .limit(50)
      .toArray();
  }

  async getCrawlerRun(crawlRunId: string): Promise<CrawlerRunSummaryDoc | null> {
    const db = await getMongoDb();
    return db
      .collection<CrawlerRunSummaryDoc>(env.MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION)
      .findOne({ crawlRunId });
  }

  async listIngestionRuns(timeRange: TimeRange): Promise<IngestionRunSummaryDoc[]> {
    const db = await getMongoDb();
    const start = getRangeStart(timeRange).toISOString();
    return db
      .collection<IngestionRunSummaryDoc>(env.MONGODB_INGESTION_RUN_SUMMARIES_COLLECTION)
      .find({ startedAt: { $gte: start } })
      .sort({ startedAt: -1 })
      .limit(50)
      .toArray();
  }

  async getIngestionRun(runId: string): Promise<IngestionRunSummaryDoc | null> {
    const db = await getMongoDb();
    return db
      .collection<IngestionRunSummaryDoc>(env.MONGODB_INGESTION_RUN_SUMMARIES_COLLECTION)
      .findOne({ $or: [{ runId }, { id: runId }] });
  }

  async getIngestionRunByCrawlRunId(crawlRunId: string): Promise<IngestionRunSummaryDoc | null> {
    const db = await getMongoDb();
    return db
      .collection<IngestionRunSummaryDoc>(env.MONGODB_INGESTION_RUN_SUMMARIES_COLLECTION)
      .find({ crawlRunId })
      .sort({ startedAt: -1 })
      .limit(1)
      .next();
  }
}

class FixtureDashboardRepository implements DashboardRepository {
  private async readJsonFile<T>(fileName: string): Promise<T[]> {
    const absolutePath = path.resolve(process.cwd(), env.DASHBOARD_FIXTURE_DIR, fileName);
    const fileContent = await fs.readFile(absolutePath, 'utf8');
    return JSON.parse(fileContent) as T[];
  }

  async listCrawlerRuns(timeRange: TimeRange): Promise<CrawlerRunSummaryDoc[]> {
    const allRuns = await this.readJsonFile<CrawlerRunSummaryDoc>('crawl-run-summaries.json');
    const start = getRangeStart(timeRange).getTime();
    return allRuns
      .filter((run) => new Date(run.startedAt).getTime() >= start)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async getCrawlerRun(crawlRunId: string): Promise<CrawlerRunSummaryDoc | null> {
    const allRuns = await this.readJsonFile<CrawlerRunSummaryDoc>('crawl-run-summaries.json');
    return allRuns.find((run) => run.crawlRunId === crawlRunId) ?? null;
  }

  async listIngestionRuns(timeRange: TimeRange): Promise<IngestionRunSummaryDoc[]> {
    const allRuns = await this.readJsonFile<IngestionRunSummaryDoc>('ingestion-run-summaries.json');
    const start = getRangeStart(timeRange).getTime();
    return allRuns
      .filter((run) => new Date(run.startedAt).getTime() >= start)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async getIngestionRun(runId: string): Promise<IngestionRunSummaryDoc | null> {
    const allRuns = await this.readJsonFile<IngestionRunSummaryDoc>('ingestion-run-summaries.json');
    return allRuns.find((run) => run.runId === runId || run.id === runId) ?? null;
  }

  async getIngestionRunByCrawlRunId(crawlRunId: string): Promise<IngestionRunSummaryDoc | null> {
    const allRuns = await this.readJsonFile<IngestionRunSummaryDoc>('ingestion-run-summaries.json');
    return (
      allRuns
        .filter((run) => run.crawlRunId === crawlRunId)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
    );
  }
}

export function createDashboardRepository(mode = env.DASHBOARD_DATA_MODE): DashboardRepository {
  if (mode === 'fixture') {
    return new FixtureDashboardRepository();
  }

  if (!env.MONGODB_URI) {
    return new FixtureDashboardRepository();
  }

  return new MongoDashboardRepository();
}
