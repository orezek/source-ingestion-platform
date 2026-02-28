# Jobs Crawler Actor

`jobs-crawler-actor` crawls `jobs.cz` list pages, reconciles listing state in MongoDB, fetches detail HTML only for selected jobs, writes local handoff artifacts for ingestion, and can trigger `jobs-ingestion-service` after the crawl finishes.

## Purpose

This app owns:

- list-page crawling and pagination
- listing-card extraction
- crawl-state reconciliation in `crawl_job_states`
- inactive marking for full/allowed runs
- detail-page HTML snapshot capture
- crawl run summaries
- local handoff to ingestion
- optional ingestion trigger

This app does not own:

- text cleaning
- LLM extraction
- normalized job document generation
- writes to `normalized_job_ads`

## Operator Flow

Use this app in the following order:

1. configure runtime and infrastructure in `apps/jobs-crawler-actor/.env`
2. define crawl behavior in `apps/jobs-crawler-actor/search-spaces/*.json`
3. generate Apify-compatible `INPUT.json`
4. run the crawler
5. let the crawler trigger ingestion or start ingestion separately

The important separation is:

- `.env` = runtime, secrets, paths, Mongo, trigger URL
- `search-spaces/*.json` = what to crawl and how that search space behaves
- `storage/key_value_stores/default/INPUT.json` = generated runtime artifact, not the human-maintained config source

## Search Spaces

The crawler is generic for any `jobs.cz` search URL, but local operator workflow is based on **search spaces**.

A search space is a checked-in JSON config under:

- `apps/jobs-crawler-actor/search-spaces/*.json`

Each search space defines:

- `searchSpaceId`
- `description`
- `startUrls`
- crawl defaults
- reconciliation policy
- optional ingestion default

Current search spaces:

- `default`
- `prague-tech-jobs`

### Why search spaces exist

They give you:

- a human-maintained config source
- stable operational naming
- automatic MongoDB database derivation
- Apify-compatible runtime input generation

## Database Naming

By default, the crawler derives the MongoDB database name as:

- `<JOB_COMPASS_DB_PREFIX>-<searchSpaceId>`

Example:

- `JOB_COMPASS_DB_PREFIX=job-compass`
- `searchSpaceId=prague-tech-jobs`
- resolved DB: `job-compass-prague-tech-jobs`

You can still override this explicitly with:

- `MONGODB_DB_NAME`

That override should be used rarely.

## Reconciliation Safety Rule

Search spaces explicitly control whether a **partial run** may mark unseen jobs inactive.

Config field:

- `reconciliation.allowInactiveMarkingOnPartialRuns`

Recommended default:

- `false`

Meaning:

- full run: inactive marking is allowed
- partial run: unseen jobs are **not** marked inactive

This is the key safety rule that prevents sample runs from corrupting crawl state.

## Runtime Input

The crawler runtime still uses standard Apify/Crawlee actor input.

Runtime `INPUT.json` now contains:

- `searchSpaceId`
- `startUrls`
- `maxItems`
- `maxConcurrency`
- `maxRequestsPerMinute`
- `proxyConfiguration`
- `debugLog`
- `allowInactiveMarkingOnPartialRuns`

### Local workflow

Humans should not edit `storage/key_value_stores/default/INPUT.json` directly.

Instead:

1. maintain search-space JSON files
2. generate `INPUT.json`
3. run the actor

Generate local input:

```bash
pnpm -C apps/jobs-crawler-actor prepare:input -- --search-space prague-tech-jobs
```

Generate with overrides:

```bash
pnpm -C apps/jobs-crawler-actor prepare:input -- \
  --search-space prague-tech-jobs \
  --max-items 100 \
  --max-concurrency 1 \
  --max-requests-per-minute 10
```

Run locally from a search space:

```bash
pnpm -C apps/jobs-crawler-actor start:local -- --search-space prague-tech-jobs --max-items 100
```

## Apify Compatibility

Apify compatibility is preserved.

The runtime contract is still actor input.

That means:

- local mode generates Apify-compatible `INPUT.json`
- Apify platform can receive the same input shape directly

So `INPUT.json` remains the runtime artifact, but search-space JSON is the human-maintained config source.

## Local Handoff to Ingestion

When a run finishes, the crawler writes:

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

- `POST /ingestion/start`

Payload:

```json
{
  "source": "jobs.cz",
  "crawlRunId": "<crawl-run-id>",
  "searchSpaceId": "prague-tech-jobs",
  "mongoDbName": "job-compass-prague-tech-jobs"
}
```

This makes ingestion deterministic and removes hidden DB assumptions.

## Environment

Copy:

- `apps/jobs-crawler-actor/.env.example`

Key variables:

- `CRAWLEE_LOG_LEVEL`
- `JOB_COMPASS_DB_PREFIX`
- `MONGODB_DB_NAME`
- `MONGODB_URI`
- `MONGODB_CRAWL_JOBS_COLLECTION`
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
  - search-space loading, local input generation, DB derivation
- `src/prepare-local-input.ts`
  - writes Apify-compatible local `INPUT.json`
- `src/run-local.ts`
  - generates input then runs the actor locally
- `src/crawl-state.ts`
  - Mongo reconciliation and crawl-state updates
- `src/detail-rendering.ts`
  - detail-page readiness heuristics
- `src/listing-card-parser.ts`
  - list-card extraction
- `src/local-shared-output.ts`
  - local handoff artifact writing
- `search-spaces/*.json`
  - operator-maintained crawl definitions

## Commands

```bash
pnpm -C apps/jobs-crawler-actor build
pnpm -C apps/jobs-crawler-actor lint
pnpm -C apps/jobs-crawler-actor check-types
pnpm -C apps/jobs-crawler-actor prepare:input -- --search-space default
pnpm -C apps/jobs-crawler-actor start:local -- --search-space default --max-items 20
```
