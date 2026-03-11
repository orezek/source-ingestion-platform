import { expect, test } from '@playwright/test';
import {
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('blocks create when required fields are empty', async ({ page }) => {
  const createApi = await mockCreatePipelineApi(page);

  await gotoCreatePipelinePage(page);
  await submitCreatePipeline(page);

  await expect(page.getByText('Name is required.', { exact: true })).toBeVisible();
  await expect(page.getByText('Search space name is required.', { exact: true })).toBeVisible();
  await expect(
    page.getByText('At least one start URL is required.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Runtime profile name is required.', { exact: true })).toBeVisible();
  await expect(page.getByText('MongoDB URI is required.', { exact: true })).toBeVisible();
  await expect(page.getByText('MongoDB database name is required.', { exact: true })).toBeVisible();

  expect(createApi.createPayloads).toHaveLength(0);
  expect(createApi.getRunStartRequestCount()).toBe(0);
});
