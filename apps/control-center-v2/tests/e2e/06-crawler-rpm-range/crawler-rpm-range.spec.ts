import { expect, test } from '@playwright/test';
import {
  fillCreatePipelineForm,
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('enforces crawler RPM min and max bounds', async ({ page }) => {
  const createApi = await mockCreatePipelineApi(page);

  await gotoCreatePipelinePage(page);

  const input = page.getByLabel('Crawler RPM');
  await expect(input).toHaveAttribute('min', '1');
  await expect(input).toHaveAttribute('max', '600');

  await fillCreatePipelineForm(page, {
    crawlerMaxRequestsPerMinute: '0',
    name: 'Crawler RPM Range',
    searchSpaceName: 'Crawler RPM Space',
    runtimeProfileName: 'Crawler RPM Runtime',
    operatorDbName: 'pl_crawler_rpm_01',
  });

  await submitCreatePipeline(page);
  await expect(page.getByText('Crawler RPM must be at least 1.', { exact: true })).toBeVisible();

  await input.fill('601');
  await submitCreatePipeline(page);
  await expect(page.getByText('Crawler RPM must be at most 600.', { exact: true })).toBeVisible();

  expect(createApi.createPayloads).toHaveLength(0);
  expect(createApi.getRunStartRequestCount()).toBe(0);
});
