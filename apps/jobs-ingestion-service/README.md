# Jobs Ingestion Service

`jobs-ingestion-service` reads crawler artifacts, cleans raw job-ad text, extracts structured job data with Gemini via LangGraph, writes normalized documents to MongoDB, records run summaries, and exposes idempotent Fastify trigger endpoints for crawler-driven ingestion.

## Purpose

This app owns:

- loading crawler artifacts
- deterministic HTML parsing and completeness checks
- LLM text cleaning
- LLM structured extraction
- normalized output writes
- ingestion summaries
- trigger lifecycle persistence
- asynchronous item ingestion
- manual/bulk backfill ingestion

This app does not own:

- list crawling
- detail-page fetching
- list reconciliation and inactive marking

## Trusted State Model

Trusted persistent state is:

- `normalized_job_ads`

Rules:

- a normalized document exists only after successful ingestion
- ingestion does not create placeholder state
- crawler phase one updates activity on existing normalized docs
- missing normalized docs are retried by the crawler on later runs

## Trigger Modes

### Live item ingestion

Endpoint:

- `POST /ingestion/item`

Used by the crawler after a detail HTML artifact is durably written.

This is the primary production path.

### Manual/bulk ingestion

Endpoint:

- `POST /ingestion/start`

Used for backfills, local testing, or reprocessing an existing crawl-run artifact folder.

## Operator Flow

1. configure runtime and infrastructure in `apps/jobs-ingestion-service/.env`
2. start the ingestion API if crawler-triggered ingestion is enabled
3. run the crawler for a selected search space
4. let the crawler trigger ingestion per artifact, or run manual bulk ingestion

## Input Contract

Crawler artifacts are expected under:

```text
scrapped_jobs/
  runs/
    <crawlRunId>/
      dataset.json
      records/
        job-html-<sourceId>.html
```

## Trigger Contracts

### `POST /ingestion/item`

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
  "detailHtmlPath": "/abs/path/to/job-html-2001077729.html",
  "datasetFileName": "dataset.json",
  "datasetRecordIndex": 0
}
```

### `POST /ingestion/start`

```json
{
  "source": "jobs.cz",
  "crawlRunId": "<crawl-run-id>",
  "searchSpaceId": "prague-tech-jobs",
  "mongoDbName": "omni-crawl-prague-tech-jobs"
}
```

## Database Naming

Manual runs derive the DB name as:

- `<JOB_COMPASS_DB_PREFIX>-<SEARCH_SPACE_ID>`

Triggered runs can override this with explicit `mongoDbName` supplied by the crawler.

## Pipeline

The LangGraph flow is:

1. `loadDetailPage`
   - reads raw HTML
   - parses DOM with Cheerio
   - extracts deterministic text
   - validates completeness
2. `cleanDetailText`
   - runs prompt `jobcompass-job-ad-text-cleaner`
   - removes UI/GDPR/cookie/legal noise
3. `extractDetail`
   - runs prompt `jobcompass-job-ad-structured-extractor`
   - produces structured output using the canonical local schema
4. merge into unified normalized document

## Persisted Raw Text Snapshots

The service stores:

- raw HTML on disk in crawler artifacts
- `rawDetailPage.loadDetailPageText`
  - deterministic step-1 extraction
- `rawDetailPage.cleanDetailText`
  - step-2 LLM cleaner output

This supports:

- reproducibility from raw HTML
- cheaper reprocessing from clean text
- better token control for later workflows

## Normalized Document Ownership

`normalized_job_ads` now also owns activity state for the search space:

- `searchSpaceId`
- `isActive`
- `firstSeenAt`
- `lastSeenAt`
- `firstSeenRunId`
- `lastSeenRunId`

Ingestion sets those fields for newly created documents.

Later crawler phase-one runs update them for existing documents.

## Mongo Collections

Default collection names:

- `normalized_job_ads`
- `ingestion_run_summaries`
- `ingestion_trigger_requests`

Lineage keys:

- `normalized_job_ads.crawlRunId -> crawl_run_summaries.crawlRunId`
- `normalized_job_ads.ingestion.runId -> ingestion_run_summaries.runId`
- `ingestion_run_summaries.crawlRunId -> crawl_run_summaries.crawlRunId`
- `ingestion_trigger_requests.ingestionRunId -> ingestion_run_summaries.runId`

## Ingestion Run Summaries

Run summaries include:

- `crawlRunId`
- `searchSpaceId`
- `mongoDbName`
- totals and rates
- skipped/failed audit arrays
- cleaner/extractor/total LLM stats
- timing percentiles

## Environment

Copy:

- `apps/jobs-ingestion-service/.env.example`

Key variables:

- `JOB_COMPASS_DB_PREFIX`
- `SEARCH_SPACE_ID`
- `MONGODB_DB_NAME`
- `ENABLE_MONGO_WRITE`
- `MONGODB_URI`
- `MONGODB_JOBS_COLLECTION`
- `MONGODB_RUN_SUMMARIES_COLLECTION`
- `MONGODB_INGESTION_TRIGGERS_COLLECTION`
- `INPUT_ROOT_DIR`
- `INPUT_RECORDS_DIR_NAME`
- `CRAWL_RUNS_SUBDIR`
- `INGESTION_SAMPLE_SIZE`
- `INGESTION_CONCURRENCY`
- `INGESTION_PARSER_BACKEND`
- `GEMINI_API_KEY`
- `LANGSMITH_API_KEY`
- `INGESTION_API_HOST`
- `INGESTION_API_PORT`

`INGESTION_PARSER_BACKEND=gemini` is the default production-like path and requires both Gemini and
LangSmith credentials. `INGESTION_PARSER_BACKEND=fixture` is available for deterministic local
worker validation without external LLM calls.

## Commands

```bash
pnpm -C apps/jobs-ingestion-service build
pnpm -C apps/jobs-ingestion-service lint
pnpm -C apps/jobs-ingestion-service check-types
pnpm -C apps/jobs-ingestion-service start
pnpm -C apps/jobs-ingestion-service start-server
```

## Key Files

- `src/app.ts`
  - ingestion workflow entrypoints and run summaries
- `src/server.ts`
  - Fastify trigger API and idempotent trigger lifecycle
- `src/job-parsing-graph.ts`
  - LangGraph workflow
- `src/html-detail-loader.ts`
  - deterministic HTML load and completeness validation
- `src/repository.ts`
  - Mongo/file writes
- `src/input-provider.ts`
  - local dataset + record loading
