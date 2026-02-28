import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  process.env.DASHBOARD_DATA_MODE = 'fixture';
  process.env.DASHBOARD_FIXTURE_DIR = './src/test/fixtures';
  vi.resetModules();
});

describe('dashboard data service', () => {
  it('loads overview data from fixtures', async () => {
    const { getOverviewDashboardData } = await import('@/server/services/dashboard-data');
    const data = await getOverviewDashboardData('7d');

    expect(data.crawlerRuns).toHaveLength(2);
    expect(data.ingestionRuns).toHaveLength(2);
    expect(data.pipelineRuns).toHaveLength(2);
    expect(data.kpis.latestCrawlerNewJobs).toBe(18);
  });

  it('loads a linked pipeline detail from fixtures', async () => {
    const { getPipelineRunDetail } = await import('@/server/services/dashboard-data');
    const data = await getPipelineRunDetail('crawl-run-001');

    expect(data).not.toBeNull();
    expect(data?.ingestionRun?.id).toBe('ingestion-run-001');
    expect(data?.hasMismatch).toBe(false);
  });
});
