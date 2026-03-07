# Jobs Crawler Actor

`jobs-crawler-actor` crawls `jobs.cz` list pages, reconciles live listing coverage against trusted normalized documents, fetches detail HTML only for jobs missing from `normalized_job_ads`, writes shared artifacts, and asynchronously triggers ingestion per persisted detail artifact.

## Purpose

This app owns:

- list-page crawling and pagination
- search-space resolution
- phase-one reconciliation against `normalized_job_ads`
- inactive marking for full/allowed runs
- detail-page HTML snapshot capture for missing jobs
- crawl run summaries
- local shared artifact writes
- asynchronous per-item ingestion triggers

This app does not own:

- text cleaning
- LLM extraction
- normalized job document creation
- batch ingestion logic

## Trusted State Model

The crawler no longer maintains a separate crawl-state collection.

Trusted persistent state is:

- `normalized_job_ads`

Rules:

- if a normalized document exists, the job was successfully ingested at least once
- phase one updates only existing normalized docs
- phase two processes only jobs missing from `normalized_job_ads`
- partial runs may refresh seen documents, but must not mark unseen documents inactive

## Two-Phase Flow

### Phase 1: listing reconciliation

The crawler scans the list pages for the selected search space and builds the current set of seen `sourceId`s.

Against existing `normalized_job_ads` documents in the search-space database:

- seen existing docs:
  - `isActive = true`
  - `lastSeenAt = <run timestamp>`
  - `lastSeenRunId = <crawlRunId>`
- unseen existing docs:
  - `isActive = false` only on full allowed reconciliation
- seen missing docs:
  - treated as new work for phase two

### Phase 2: detail artifacts + async ingestion

For jobs missing from `normalized_job_ads`:

1. fetch detail page
2. persist HTML artifact locally
3. append the listing snapshot to run dataset output
4. asynchronously trigger ingestion for that single artifact

The crawler does not wait for ingestion to finish.

## Operator Flow

1. configure runtime and infrastructure in `apps/jobs-crawler-actor/.env`
2. define crawl behavior in `apps/jobs-crawler-actor/search-spaces/*.json`
3. build the app
4. run with a search space

```bash
pnpm -C apps/jobs-crawler-actor build
pnpm -C apps/jobs-crawler-actor start -- --search-space prague-tech-jobs --max-items 100
```

## Search Spaces

A search space is a checked-in JSON config under:

- `apps/jobs-crawler-actor/search-spaces/*.json`

Each search space defines:

- `searchSpaceId`
- `description`
- `startUrls`
- crawl defaults
- reconciliation policy
- optional ingestion defaults

Current search spaces:

- `default`
- `prague-tech-jobs`

## Database Naming

Default DB derivation:

- `<JOB_COMPASS_DB_PREFIX>-<searchSpaceId>`

Example:

- `JOB_COMPASS_DB_PREFIX=omni-crawl`
- `searchSpaceId=prague-tech-jobs`
- resolved DB: `omni-crawl-prague-tech-jobs`

`MONGODB_DB_NAME` is an explicit override and should be used rarely.

## Reconciliation Safety Rule

Search spaces explicitly control whether a partial run may mark unseen jobs inactive.

Config field:

- `reconciliation.allowInactiveMarkingOnPartialRuns`

Recommended default:

- `false`

Meaning:

- full allowed run: unseen existing normalized docs may be marked inactive
- partial run: seen existing docs are refreshed, unseen docs are not marked inactive

## Runtime Input

Canonical operator input is:

- `searchSpaceId`
- optional overrides:
  - `maxItems`
  - `maxConcurrency`
  - `maxRequestsPerMinute`
  - `proxyConfiguration`
  - `debugLog`
  - `allowInactiveMarkingOnPartialRuns`

The actor resolves start URLs and defaults from the search-space definition at runtime.

## Apify Compatibility

Apify compatibility is preserved.

The actor input contract remains JSON, but the human-maintained crawl definition is the search-space file. A local operator or Apify run selects a search space and optional overrides.

## Shared Local Output

Crawler artifacts are written to:

```text
<LOCAL_SHARED_SCRAPED_JOBS_DIR>/
  runs/
    <crawlRunId>/
      dataset.json
      records/
        job-html-<sourceId>.html
```

Default:

- `LOCAL_SHARED_SCRAPED_JOBS_DIR=../jobs-ingestion-service/scrapped_jobs`

## Ingestion Trigger Contract

When enabled, the crawler calls:

- `POST /ingestion/item`

Payload:

```json
{
  "source": "jobs.cz",
  "crawlRunId": "<crawl-run-id>",
  "searchSpaceId": "prague-tech-jobs",
  "mongoDbName": "omni-crawl-prague-tech-jobs",
  "listingRecord": {
    "sourceId": "2001077729",
    "adUrl": "https://www.jobs.cz/rpd/2001077729/...",
    "jobTitle": "Senior Engineer - F# powered distributed systems on kubernetes",
    "companyName": "Alma Career Czechia s.r.o.",
    "location": "Praha – Libeň + 1 další lokalita",
    "salary": "75 000 – 90 000 Kč",
    "publishedInfoText": "Příležitost dne",
    "scrapedAt": "2026-02-28T12:00:00.000Z",
    "source": "jobs.cz",
    "htmlDetailPageKey": "job-html-2001077729.html"
  },
  "detailHtmlPath": "/abs/path/to/scrapped_jobs/runs/<crawlRunId>/records/job-html-2001077729.html",
  "datasetFileName": "dataset.json",
  "datasetRecordIndex": 0
}
```

The ingestion boundary is:

- HTML artifact persisted successfully
- trigger accepted successfully

## Environment

Copy:

- `apps/jobs-crawler-actor/.env.example`

Key variables:

- `CRAWLEE_LOG_LEVEL`
- `JOB_COMPASS_DB_PREFIX`
- `MONGODB_DB_NAME`
- `MONGODB_URI`
- `MONGODB_JOBS_COLLECTION`
- `ENABLE_MONGO_RUN_SUMMARY_WRITE`
- `MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION`
- `LOCAL_SHARED_SCRAPED_JOBS_DIR`
- `ENABLE_INGESTION_TRIGGER`
- `INGESTION_TRIGGER_URL`
- `INGESTION_TRIGGER_TIMEOUT_MS`
- `CRAWL_INACTIVE_GUARD_MIN_ACTIVE_COUNT`
- `CRAWL_INACTIVE_GUARD_MIN_SEEN_RATIO`

## Key Files

- `src/main.ts`
  - crawl orchestration
- `src/search-space.ts`
  - search-space loading, CLI parsing, DB derivation
- `src/normalized-jobs-repository.ts`
  - phase-one reconciliation against normalized docs
- `src/detail-rendering.ts`
  - detail-page readiness heuristics
- `src/listing-card-parser.ts`
  - list-card extraction
- `src/local-shared-output.ts`
  - shared artifact writes
- `search-spaces/*.json`
  - operator-maintained crawl definitions

## Commands

```bash
pnpm -C apps/jobs-crawler-actor build
pnpm -C apps/jobs-crawler-actor lint
pnpm -C apps/jobs-crawler-actor check-types
pnpm -C apps/jobs-crawler-actor start -- --search-space default --max-items 20
```
