import { expect, test } from '@playwright/test';
import {
  fillCreatePipelineForm,
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('rejects invalid dbName values and accepts a valid 38-byte name', async ({ page }) => {
  const pipelineId = 'pipeline-e2e-dbname-001';
  const createApi = await mockCreatePipelineApi(page, pipelineId);

  await gotoCreatePipelinePage(page);
  await fillCreatePipelineForm(page, {
    name: 'Mongo DB Name Validation',
    searchSpaceName: 'Mongo DB Name Validation Space',
    runtimeProfileName: 'Mongo DB Name Validation Runtime',
    operatorDbName: 'invalid db name',
  });

  await submitCreatePipeline(page);
  await expect(
    page.getByText(
      'MongoDB database name may contain only letters, numbers, underscore, and hyphen.',
      { exact: true },
    ),
  ).toBeVisible();

  const databaseNameInput = page.getByLabel('Database Name');
  await expect(databaseNameInput).toHaveAttribute('maxlength', '38');
  await databaseNameInput.evaluate((node, value) => {
    const input = node as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'a'.repeat(39));
  await submitCreatePipeline(page);
  await expect(
    page.getByText('MongoDB database name must be at most 38 bytes.', { exact: true }),
  ).toBeVisible();

  const validDbName = `pl_${'a'.repeat(35)}`;
  await databaseNameInput.fill(validDbName);
  await submitCreatePipeline(page);

  await expect.poll(() => createApi.createPayloads.length).toBe(1);
  const payload = createApi.createPayloads[0] as {
    operatorSink: { dbName: string };
  };

  expect(payload.operatorSink.dbName).toBe(validDbName);
  expect(createApi.getRunStartRequestCount()).toBe(0);

  await expect(page).toHaveURL(new RegExp(`/pipelines/${pipelineId}$`));
});
