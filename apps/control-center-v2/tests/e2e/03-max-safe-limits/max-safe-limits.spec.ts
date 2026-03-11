import { expect, test } from '@playwright/test';
import {
  fillCreatePipelineForm,
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('creates a pipeline with maximum safe numeric values', async ({ page }) => {
  const pipelineId = 'pipeline-e2e-max-safe-001';
  const createApi = await mockCreatePipelineApi(page, pipelineId);

  await gotoCreatePipelinePage(page);
  await fillCreatePipelineForm(page, {
    name: 'Max Bounds Pipeline',
    searchSpaceName: 'Max Bounds Search Space',
    runtimeProfileName: 'Max Bounds Runtime',
    maxItems: '1000',
    crawlerMaxConcurrency: '20',
    crawlerMaxRequestsPerMinute: '600',
    ingestionConcurrency: '64',
    operatorDbName: 'pl_max_bounds_01',
  });

  await submitCreatePipeline(page);

  await expect.poll(() => createApi.createPayloads.length).toBe(1);
  const payload = createApi.createPayloads[0] as {
    searchSpace: { maxItems: number };
    runtimeProfile: {
      crawlerMaxConcurrency?: number;
      crawlerMaxRequestsPerMinute?: number;
      ingestionConcurrency?: number;
    };
  };

  expect(payload.searchSpace.maxItems).toBe(1000);
  expect(payload.runtimeProfile.crawlerMaxConcurrency).toBe(20);
  expect(payload.runtimeProfile.crawlerMaxRequestsPerMinute).toBe(600);
  expect(payload.runtimeProfile.ingestionConcurrency).toBe(64);
  expect(createApi.getRunStartRequestCount()).toBe(0);

  await expect(page).toHaveURL(new RegExp(`/pipelines/${pipelineId}$`));
});
