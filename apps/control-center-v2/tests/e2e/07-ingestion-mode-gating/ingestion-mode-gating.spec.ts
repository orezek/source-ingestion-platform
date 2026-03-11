import { expect, test } from '@playwright/test';
import {
  fillCreatePipelineForm,
  gotoCreatePipelinePage,
  mockCreatePipelineApi,
  submitCreatePipeline,
} from '../_shared/create-pipeline-form';

test('disables ingestion concurrency and removes it from crawl_only payloads', async ({ page }) => {
  const pipelineId = 'pipeline-e2e-crawl-only-001';
  const createApi = await mockCreatePipelineApi(page, pipelineId);

  await gotoCreatePipelinePage(page);
  await fillCreatePipelineForm(page, {
    mode: 'crawl_only',
    name: 'Crawl Only Pipeline',
    searchSpaceName: 'Crawl Only Space',
    runtimeProfileName: 'Crawl Only Runtime',
    operatorDbName: 'pl_crawl_only_01',
  });

  const ingestionInput = page.getByLabel('Ingestion Concurrency');
  await expect(ingestionInput).toBeDisabled();

  await submitCreatePipeline(page);

  await expect.poll(() => createApi.createPayloads.length).toBe(1);
  const payload = createApi.createPayloads[0] as {
    mode: string;
    searchSpace: { allowInactiveMarking: boolean };
    runtimeProfile: { ingestionConcurrency?: number };
    structuredOutput: { destinations: Array<{ type: string }> };
  };

  expect(payload.mode).toBe('crawl_only');
  expect(payload.runtimeProfile.ingestionConcurrency).toBeUndefined();
  expect(payload.structuredOutput.destinations).toEqual([]);
  expect(payload.searchSpace.allowInactiveMarking).toBe(false);
  expect(createApi.getRunStartRequestCount()).toBe(0);

  await expect(page).toHaveURL(new RegExp(`/pipelines/${pipelineId}$`));
});
