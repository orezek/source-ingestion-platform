import type { Locator } from 'playwright';
import type { CrawlListingRecord } from './normalized-jobs-repository.js';

const SALARY_SELECTOR = 'span.Tag--success, [data-test="serp-salary"]';

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\u00A0/g, ' ')
    .replace(/\u200D/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getSafeText(loc: Locator): Promise<string | null> {
  if ((await loc.count()) > 0) {
    const elValue = await loc.first().textContent();
    return elValue ? elValue.trim() : null;
  }

  return null;
}

export async function extractListingFromCard(
  card: Locator,
  baseUrl: string,
): Promise<CrawlListingRecord | null> {
  const titleLocator = card.locator('h2[data-test-ad-title]');
  const idLocator = card.locator('a[data-jobad-id]');
  const statusLocator = card.locator('[data-test-ad-status]');
  const locationLocator = card.locator('li[data-test="serp-locality"]');
  const salaryLocator = card.locator(SALARY_SELECTOR);
  const companyLocator = card.locator('span[translate="no"]');

  const title = await titleLocator.getAttribute('data-test-ad-title');
  const jobId = await idLocator.getAttribute('data-jobad-id');
  const status = (await getSafeText(statusLocator)) || '';
  const location = (await getSafeText(locationLocator)) || '';
  const rawSalary = await getSafeText(salaryLocator);
  const salary = rawSalary ? normalizeWhitespace(rawSalary) : null;
  const company = (await getSafeText(companyLocator)) || '';

  const linkLocator = card.locator('h2[data-test-ad-title] a');
  const href = await linkLocator.getAttribute('href');

  if (!href || !jobId) {
    return null;
  }

  return {
    source: 'jobs.cz',
    sourceId: jobId,
    adUrl: new URL(href, baseUrl).toString(),
    jobTitle: title || 'Unknown',
    companyName: company,
    location,
    salary,
    publishedInfoText: status,
  };
}
