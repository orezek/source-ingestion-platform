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
pnpm -C apps/jobs-crawler-actor dev
```

## Output Metadata (Detail HTML Snapshot)

Each dataset record also includes detail-page snapshot metadata to support downstream ingestion,
debugging, and reprocessing:

- `requestedDetailUrl` (canonical jobs.cz URL enqueued by the crawler)
- `finalDetailUrl` and `finalDetailHost` (actual page URL/host after redirects)
- `detailRedirected` (whether redirect occurred)
- `detailRenderType` / `detailRenderSignal` (how the detail page was rendered and validated)
- `detailRenderTextChars`, `detailRenderWaitMs`, `detailRenderComplete`
- `detailHtmlByteSize`, `detailHtmlSha256` (rendered HTML snapshot size/hash)

The actor also writes a run-level summary JSON into the key-value store under `RUN_SUMMARY`,
including parsed list-page totals (for example `Našli jsme 1 587 nabídek`), crawl counters,
render-type breakdowns, and stop reason.

Optional MongoDB sink for run summaries (best effort; crawler still succeeds if Mongo is unavailable):

- `ENABLE_MONGO_RUN_SUMMARY_WRITE=true`
- `MONGODB_URI=...`
- `MONGODB_DB_NAME=jobCompass` (default)
- `MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION=crawl_run_summaries` (default)

Optional ingestion trigger (best effort; runs after crawl finalization for `succeeded` and
`completed_with_errors`):

- `ENABLE_INGESTION_TRIGGER=true`
- `INGESTION_TRIGGER_URL=http://127.0.0.1:3010/ingestion/start` (default)
- `INGESTION_TRIGGER_TIMEOUT_MS=10000` (default)

## Validate

From the repository root:

```bash
pnpm -C apps/jobs-crawler-actor lint
pnpm -C apps/jobs-crawler-actor check-types
pnpm -C apps/jobs-crawler-actor build
```
