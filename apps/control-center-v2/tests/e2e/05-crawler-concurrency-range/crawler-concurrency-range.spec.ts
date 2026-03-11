import { expect, test } from '@playwright/test';
import {
  fillCreatePipelineForm,
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('enforces crawler max concurrency min and max bounds', async ({ page }) => {
  const createApi = await mockCreatePipelineApi(page);

  await gotoCreatePipelinePage(page);

  const input = page.getByLabel('Crawler Max Concurrency');
  await expect(input).toHaveAttribute('min', '1');
  await expect(input).toHaveAttribute('max', '20');

  await fillCreatePipelineForm(page, {
    crawlerMaxConcurrency: '0',
    name: 'Crawler Concurrency Range',
    searchSpaceName: 'Crawler Concurrency Space',
    runtimeProfileName: 'Crawler Concurrency Runtime',
    operatorDbName: 'pl_crawler_concurrency_01',
  });

  await submitCreatePipeline(page);
  await expect(
    page.getByText('Crawler max concurrency must be at least 1.', { exact: true }),
  ).toBeVisible();

  await input.fill('21');
  await submitCreatePipeline(page);
  await expect(
    page.getByText('Crawler max concurrency must be at most 20.', { exact: true }),
  ).toBeVisible();

  expect(createApi.createPayloads).toHaveLength(0);
  expect(createApi.getRunStartRequestCount()).toBe(0);
});
