import { expect, test } from '@playwright/test';
import {
  fillCreatePipelineForm,
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('creates a pipeline with minimum safe numeric values', async ({ page }) => {
  const pipelineId = 'pipeline-e2e-min-safe-001';
  const createApi = await mockCreatePipelineApi(page, pipelineId);

  await gotoCreatePipelinePage(page);
  await fillCreatePipelineForm(page, {
    name: 'Min Bounds Pipeline',
    searchSpaceName: 'Min Bounds Search Space',
    runtimeProfileName: 'Min Bounds Runtime',
    maxItems: '1',
    crawlerMaxConcurrency: '1',
    crawlerMaxRequestsPerMinute: '1',
    ingestionConcurrency: '1',
    operatorDbName: 'pl_min_bounds_01',
  });

  await submitCreatePipeline(page);

  await expect.poll(() => createApi.createPayloads.length).toBe(1);
  const payload = createApi.createPayloads[0] as {
    searchSpace: { maxItems: number; allowInactiveMarking: boolean };
    runtimeProfile: {
      crawlerMaxConcurrency?: number;
      crawlerMaxRequestsPerMinute?: number;
      ingestionConcurrency?: number;
    };
  };

  expect(payload.searchSpace.maxItems).toBe(1);
  expect(payload.searchSpace.allowInactiveMarking).toBe(true);
  expect(payload.runtimeProfile.crawlerMaxConcurrency).toBe(1);
  expect(payload.runtimeProfile.crawlerMaxRequestsPerMinute).toBe(1);
  expect(payload.runtimeProfile.ingestionConcurrency).toBe(1);
  expect(createApi.getRunStartRequestCount()).toBe(0);

  await expect(page).toHaveURL(new RegExp(`/pipelines/${pipelineId}$`));
});
