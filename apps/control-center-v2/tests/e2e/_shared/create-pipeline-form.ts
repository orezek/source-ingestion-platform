import { expect, type Locator, type Page } from '@playwright/test';

type CreatePipelineMode = 'crawl_only' | 'crawl_and_ingest';

export type CreatePipelineFormValues = {
  name: string;
  source: string;
  mode: CreatePipelineMode;
  searchSpaceName: string;
  searchSpaceDescription: string;
  startUrlsText: string;
  maxItems: string;
  allowInactiveMarking: boolean;
  runtimeProfileName: string;
  crawlerMaxConcurrency: string;
  crawlerMaxRequestsPerMinute: string;
  ingestionConcurrency: string;
  includeMongoOutput: boolean;
  includeDownloadableJson: boolean;
  operatorMongoUri: string;
  operatorDbName: string;
};

const defaultCreateValues: CreatePipelineFormValues = {
  name: 'E2E Pipeline',
  source: 'jobs.cz',
  mode: 'crawl_and_ingest',
  searchSpaceName: 'Prague Tech Jobs',
  searchSpaceDescription: 'Operator validation baseline for safe create flow.',
  startUrlsText: 'https://www.jobs.cz/prace/praha/?q=software-engineer',
  maxItems: '200',
  allowInactiveMarking: true,
  runtimeProfileName: 'Prague Runtime Profile',
  crawlerMaxConcurrency: '3',
  crawlerMaxRequestsPerMinute: '60',
  ingestionConcurrency: '4',
  includeMongoOutput: true,
  includeDownloadableJson: false,
  operatorMongoUri: 'mongodb://localhost:27017',
  operatorDbName: 'pl_e2e_safe_create_01',
};

export async function gotoCreatePipelinePage(page: Page): Promise<void> {
  await page.goto('/pipelines/new');
  await expect(page.getByRole('heading', { name: 'Create Pipeline' })).toBeVisible();
}

async function setCheckbox(locator: Locator, checked: boolean): Promise<void> {
  const current = await locator.isChecked();
  if (current !== checked) {
    await locator.click();
  }
}

export async function fillCreatePipelineForm(
  page: Page,
  overrides: Partial<CreatePipelineFormValues> = {},
): Promise<CreatePipelineFormValues> {
  const values: CreatePipelineFormValues = {
    ...defaultCreateValues,
    ...overrides,
  };

  await page.getByLabel('Pipeline Name').fill(values.name);
  await page.getByLabel('Source').fill(values.source);
  await page.getByLabel('Mode').selectOption(values.mode);
  await page.getByLabel('Search Space Name').fill(values.searchSpaceName);
  await page.getByLabel('Description').fill(values.searchSpaceDescription);
  await page.getByLabel('Start URLs').fill(values.startUrlsText);
  await page.getByLabel('Max Items').fill(values.maxItems);

  await setCheckbox(
    page.getByRole('checkbox', { name: 'Allow inactive marking' }),
    values.allowInactiveMarking,
  );

  await page.getByLabel('Runtime Profile Name').fill(values.runtimeProfileName);
  await page.getByLabel('Crawler Max Concurrency').fill(values.crawlerMaxConcurrency);
  await page.getByLabel('Crawler RPM').fill(values.crawlerMaxRequestsPerMinute);

  const ingestionConcurrencyField = page.getByLabel('Ingestion Concurrency');
  if (!(await ingestionConcurrencyField.isDisabled())) {
    await ingestionConcurrencyField.fill(values.ingestionConcurrency);
  }

  await setCheckbox(page.getByRole('checkbox', { name: 'MongoDB' }), values.includeMongoOutput);
  await setCheckbox(
    page.getByRole('checkbox', { name: 'Downloadable JSON' }),
    values.includeDownloadableJson,
  );

  if (values.includeMongoOutput) {
    await page.getByLabel('MongoDB URI').fill(values.operatorMongoUri);
    await page.getByLabel('Database Name').fill(values.operatorDbName);
  }

  return values;
}

export type CreatePipelineApiMock = {
  createPayloads: unknown[];
  getRunStartRequestCount: () => number;
};

export async function mockCreatePipelineApi(
  page: Page,
  pipelineId = 'pipeline-e2e-created-001',
): Promise<CreatePipelineApiMock> {
  const createPayloads: unknown[] = [];
  let runStartRequestCount = 0;

  await page.route('**/api/pipelines/*/runs', async (route) => {
    runStartRequestCount += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Run start must not be called in create tests.' } }),
    });
  });

  await page.route('**/api/pipelines', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    const postData = route.request().postData();
    createPayloads.push(postData ? JSON.parse(postData) : null);

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ pipelineId }),
    });
  });

  return {
    createPayloads,
    getRunStartRequestCount: () => runStartRequestCount,
  };
}

export async function submitCreatePipeline(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create Pipeline' }).click();
}
