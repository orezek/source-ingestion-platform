import { describe, expect, it } from 'vitest';
import {
  mapCrawlerRunSummary,
  mapIngestionRunSummary,
  mapPipelineRunSummary,
} from '@/server/mappers/run-summary-mappers';
import crawlerRuns from '@/test/fixtures/crawl-run-summaries.json';
import ingestionRuns from '@/test/fixtures/ingestion-run-summaries.json';
import type { CrawlerRunSummaryDoc, IngestionRunSummaryDoc } from '@/server/types';

const crawlerFixtures = crawlerRuns as unknown as CrawlerRunSummaryDoc[];
const ingestionFixtures = ingestionRuns as unknown as IngestionRunSummaryDoc[];

describe('run summary mappers', () => {
  it('maps crawler summary counters into the dashboard view', () => {
    const mapped = mapCrawlerRunSummary(crawlerFixtures[0]!);
    expect(mapped.id).toBe('crawl-run-002');
    expect(mapped.newJobsCount).toBe(18);
    expect(mapped.failedRequests).toBe(3);
  });

  it('maps ingestion summary rates into the dashboard view', () => {
    const mapped = mapIngestionRunSummary(ingestionFixtures[0]!);
    expect(mapped.id).toBe('ingestion-run-002');
    expect(mapped.jobsSkippedIncomplete).toBe(2);
    expect(mapped.jobsSuccessRate).toBeCloseTo(0.8333, 3);
  });

  it('derives pipeline mismatch when processed count trails crawler new jobs', () => {
    const pipeline = mapPipelineRunSummary(
      mapCrawlerRunSummary(crawlerFixtures[0]!),
      mapIngestionRunSummary(ingestionFixtures[0]!),
    );
    expect(pipeline.hasMismatch).toBe(true);
    expect(pipeline.mismatchReasons.length).toBeGreaterThan(0);
  });
});
