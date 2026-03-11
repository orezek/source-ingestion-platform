import { expect, test } from '@playwright/test';
import {
  fillCreatePipelineForm,
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('rejects non-mongodb schemes and accepts mongodb+srv URIs', async ({ page }) => {
  const pipelineId = 'pipeline-e2e-mongo-uri-001';
  const createApi = await mockCreatePipelineApi(page, pipelineId);

  await gotoCreatePipelinePage(page);

  const mongoUriInput = page.getByLabel('MongoDB URI');
  await expect(mongoUriInput).toHaveAttribute('pattern', '^mongodb(\\\\+srv)?:\\\\/\\\\/.+');

  await fillCreatePipelineForm(page, {
    name: 'Mongo URI Validation',
    searchSpaceName: 'Mongo URI Validation Space',
    runtimeProfileName: 'Mongo URI Validation Runtime',
    operatorMongoUri: 'https://example.com/not-mongo',
    operatorDbName: 'pl_mongo_uri_validation_01',
  });

  await submitCreatePipeline(page);
  await expect(
    page.getByText('MongoDB URI must start with mongodb:// or mongodb+srv://.', { exact: true }),
  ).toBeVisible();

  await mongoUriInput.fill('mongodb+srv://cluster0.example.mongodb.net');
  await submitCreatePipeline(page);

  await expect.poll(() => createApi.createPayloads.length).toBe(1);
  const payload = createApi.createPayloads[0] as {
    operatorSink: { mongodbUri: string };
  };

  expect(payload.operatorSink.mongodbUri).toBe('mongodb+srv://cluster0.example.mongodb.net');
  expect(createApi.getRunStartRequestCount()).toBe(0);

  await expect(page).toHaveURL(new RegExp(`/pipelines/${pipelineId}$`));
});
