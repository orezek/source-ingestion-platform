# Job Compass: Jobs.cz Scraper

A robust and efficient crawler for extracting job opportunities from **Jobs.cz**, one of the largest job boards in the Czech Republic. This actor parses list pages and details pages to extract structured data about vacancies, salaries, and companies.

## Monorepo Notes

- This app is part of the `pnpm` + Turborepo workspace in JobCompass.
- The crawler logic is preserved from the original actor implementation.
- Runtime target remains Apify actor images (Node 20 compatible) to avoid changing deployed behavior.

## 🚀 Features

- **Detailed Extraction:** Scrapes job title, company name, salary (if available), location, and publication date.
- **Smart Formatting:** Automatically cleans up whitespace and standardizes text fields.
- **Proxy Support:** Fully compatible with Apify Proxy to avoid IP blocking.
- **Cost Control:** Configurable `maxItems` limit (job ads/detail pages) to control your scraping budget.
- **Typed Output:** Returns clean, JSON-structured data validated against a schema.

## 📋 Input Parameters

The input of this actor should be JSON. Using the Apify platform, you can configure these parameters via a visual interface.

| Field | Type | Description |
|Args|---|---|
| **startUrls** | Array | Optional. List of Search URLs from Jobs.cz. You can paste multiple different search categories here. If omitted, the actor starts from the default Jobs.cz search page. |
| **maxItems** | Integer | **Required.** The maximum number of job ads (detail pages) to scrape. The actor will stop once this limit is reached. |
| **proxyConfiguration** | Object | (Optional) Proxy settings. Default is Apify Proxy (Automatic). |
| **debugLog** | Boolean | (Optional) Enable detailed debug logging for troubleshooting. |

### Example Input

```json
{
  "startUrls": [
    {
      "url": "https://www.jobs.cz/prace/?field%5B%5D=200900012"
    }
  ],
  "maxItems": 50,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

## Local Development (Monorepo)

From the repository root:

```bash
pnpm -C apps/job-compass-actor dev
```

## Validate

From the repository root:

```bash
pnpm -C apps/job-compass-actor lint
pnpm -C apps/job-compass-actor check-types
pnpm -C apps/job-compass-actor build
```
