import { expect, test } from '@playwright/test';
import {
  fillCreatePipelineForm,
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('rejects max items above the configured safe ceiling', async ({ page }) => {
  const createApi = await mockCreatePipelineApi(page);

  await gotoCreatePipelinePage(page);

  const maxItemsInput = page.getByLabel('Max Items');
  await expect(maxItemsInput).toHaveAttribute('min', '1');
  await expect(maxItemsInput).toHaveAttribute('max', '1000');

  await fillCreatePipelineForm(page, {
    maxItems: '1001',
    name: 'Unsafe Max Items Pipeline',
    searchSpaceName: 'Unsafe Max Items Space',
    runtimeProfileName: 'Unsafe Max Runtime',
    operatorDbName: 'pl_unsafe_max_items_01',
  });

  await submitCreatePipeline(page);

  await expect(page.getByText('Max items must be at most 1000.', { exact: true })).toBeVisible();
  expect(createApi.createPayloads).toHaveLength(0);
  expect(createApi.getRunStartRequestCount()).toBe(0);
});
