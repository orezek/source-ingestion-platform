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

  await page.getByTestId('pipeline-name-input').fill(pipelineName);
  await page.getByRole('textbox', { name: 'STRUCTURED OUTPUT IDS' }).fill('local-json-output');
  await page.getByTestId('create-pipeline-submit').click();

  await expect(page.getByTestId('start-run-pipeline')).toContainText(pipelineName);

  await page.getByTestId('start-run-pipeline').selectOption({ label: pipelineName });
  await page.getByTestId('start-run-submit').click();

  await expect(page.getByTestId('control-plane-runs')).toContainText(pipelineName);
  await expect(page.getByTestId('control-plane-runs')).toContainText('succeeded');
});
