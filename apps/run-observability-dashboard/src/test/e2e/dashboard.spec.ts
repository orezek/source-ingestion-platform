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
