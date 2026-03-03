import { expect, test } from '@playwright/test';

test('overview renders KPI and tables', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operational dashboard' })).toBeVisible();
  await expect(page.locator('.kpi-card__label', { hasText: 'CRAWLER RUNS' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /crawl-ru/i }).first()).toBeVisible();
});

test('crawler, ingestion, and pipeline detail routes render', async ({ page }) => {
  await page.goto('/crawler/runs/crawl-run-001');
  await expect(page.getByRole('heading', { name: /Crawler run crawl-ru/i })).toBeVisible();

  await page.goto('/ingestion/runs/ingestion-run-001');
  await expect(page.getByRole('heading', { name: /Ingestion run ingestio/i })).toBeVisible();

  await page.goto('/pipeline/crawl-run-001');
  await expect(page.getByRole('heading', { name: /Pipeline crawl-ru/i })).toBeVisible();
});

test('control plane can create a pipeline and run it in fixture mode', async ({ page }) => {
  const pipelineName = `Fixture pipeline ${Date.now()}`;

  await page.goto('/control-plane');
  await expect(page.getByRole('heading', { name: 'Local operator surface' })).toBeVisible();
  await expect(page.locator('.kpi-card__label', { hasText: 'ACTIVE RUNS' }).first()).toBeVisible();
  await expect(page.getByTestId('create-pipeline-disclosure')).toBeVisible();
  await expect(page.getByText('Manage source definitions')).toBeVisible();

  await page.getByTestId('pipeline-name-input').fill(pipelineName);
  await page.getByTestId('create-pipeline-submit').click();

  await expect(page.getByTestId('start-run-pipeline')).toContainText(pipelineName);

  await page.getByTestId('start-run-pipeline').selectOption({ label: pipelineName });
  await page.getByTestId('start-run-submit').click();

  await expect(page.getByTestId('control-plane-runs')).toContainText(pipelineName);
  await expect(page.getByTestId('control-plane-runs')).toContainText('succeeded');

  await page
    .getByTestId('control-plane-runs')
    .getByRole('link', { name: /crawl-run-/i })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /Run crawl-run-/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Generated INPUT.json' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Event history' })).toBeVisible();

  await page.getByTestId('artifact-browse-fixture-001').click();
  await expect(page.getByRole('heading', { name: 'Fixture platform engineer' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Artifact preview' })).toBeVisible();

  const htmlDownloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download HTML' }).click();
  const htmlDownload = await htmlDownloadPromise;
  expect(await htmlDownload.suggestedFilename()).toBe('job-html-fixture-001.html');

  await page.goto('/control-plane');
  await page
    .getByTestId('control-plane-runs')
    .getByRole('link', { name: /crawl-run-/i })
    .first()
    .click();
  await page.getByTestId('output-browse-downloadable-json-fixture-001').click();
  await expect(page.getByRole('heading', { name: 'JSON preview' })).toBeVisible();
  await expect(page.getByText('DESTINATION: Downloadable JSON')).toBeVisible();

  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(await jsonDownload.suggestedFilename()).toBe('normalized-job-fixture-001.json');
});
