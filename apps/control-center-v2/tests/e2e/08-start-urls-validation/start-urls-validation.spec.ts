import { expect, test } from '@playwright/test';
import {
  fillCreatePipelineForm,
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('rejects malformed and oversized start URL input', async ({ page }) => {
  const createApi = await mockCreatePipelineApi(page);

  await gotoCreatePipelinePage(page);
  await fillCreatePipelineForm(page, {
    name: 'Start URL Validation',
    searchSpaceName: 'Start URL Validation Space',
    runtimeProfileName: 'Start URL Validation Runtime',
    startUrlsText: 'https://www.jobs.cz/prace/praha/?q=backend\nnot-a-valid-url',
    operatorDbName: 'pl_start_url_validation_01',
  });

  await submitCreatePipeline(page);
  await expect(
    page.getByText('Each start URL must be a valid absolute URL.', { exact: true }),
  ).toBeVisible();

  const tooManyUrls = Array.from(
    { length: 21 },
    (_, index) => `https://example.com/jobs?page=${index + 1}`,
  ).join('\n');
  await page.getByLabel('Start URLs').fill(tooManyUrls);

  await submitCreatePipeline(page);
  await expect(page.getByText('At most 20 start URLs are allowed.', { exact: true })).toBeVisible();

  expect(createApi.createPayloads).toHaveLength(0);
  expect(createApi.getRunStartRequestCount()).toBe(0);
});
