# Jobs Ingestion Service

`jobs-ingestion-service` reads crawler artifacts, cleans raw job-ad text, extracts structured job data with Gemini via LangGraph, writes normalized documents to MongoDB, records run summaries, and exposes an idempotent Fastify trigger API for crawler-driven ingestion.

## Purpose

This app owns:

- loading crawler handoff artifacts
- deterministic HTML parsing and completeness checks
- LLM text cleaning
- LLM structured extraction
- normalized output writes
- ingestion summaries
- trigger lifecycle persistence
- pruning non-success jobs from `crawl_job_states`

This app does not own:

- list crawling
- detail-page fetching
- crawl-state reconciliation on list coverage

## Operator Flow

Use this app in the following order:

1. configure runtime and infrastructure in `apps/jobs-ingestion-service/.env`
2. start the ingestion API if crawler-triggered ingestion is enabled
3. run the crawler for a chosen search space
4. let the crawler trigger ingestion, or run ingestion manually for the selected crawl run

The important separation is:

- crawler search spaces define the crawl scope
- ingestion `.env` defines runtime, model, paths, Mongo, and API settings
- trigger payload carries `crawlRunId`, `searchSpaceId`, and `mongoDbName`, so ingestion follows the crawler run instead of redefining scope

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

## Trigger Contract

Endpoint:

- `POST /ingestion/start`

Request body:

```json
{
  "source": "jobs.cz",
  "crawlRunId": "<crawl-run-id>",
  "searchSpaceId": "prague-tech-jobs",
  "mongoDbName": "job-compass-prague-tech-jobs"
}
```

This payload is intentionally explicit:

- `crawlRunId` selects the artifact folder
- `searchSpaceId` makes the run operationally traceable
- `mongoDbName` removes ambiguity about which database this ingestion belongs to

## Database Naming

By default, the service derives the DB name as:

- `<JOB_COMPASS_DB_PREFIX>-<SEARCH_SPACE_ID>`

Example:

- `JOB_COMPASS_DB_PREFIX=job-compass`
- `SEARCH_SPACE_ID=default`
- resolved DB: `job-compass-default`

Trigger-driven runs can override this with the explicit `mongoDbName` sent by the crawler.

## Pipeline

The LangGraph flow is:

1. `loadDetailPage`
   - reads raw HTML
   - handles compressed/plain HTML
   - parses DOM with Cheerio
   - extracts static text
   - validates completeness

2. `cleanDetailText`
   - runs prompt `jobcompass-job-ad-text-cleaner`
   - removes UI/GDPR/cookie/legal noise
   - outputs the clean text used by extraction

3. `extractDetail`
   - runs prompt `jobcompass-job-ad-structured-extractor`
   - uses structured output with the local canonical schema

4. `merge`
   - combines listing + extracted detail + ingestion metadata
   - validates final unified output

## Persisted Raw Text Snapshots

The service stores:

- raw HTML on disk in crawler artifacts
- `rawDetailPage.loadDetailPageText`
  - step-1 deterministic text extraction
- `rawDetailPage.cleanDetailText`
  - step-2 LLM-cleaned text used by extraction

This gives you:

- reproducibility from raw HTML
- a cheap deterministic intermediate
- a token-saving clean text snapshot for future reprocessing

## Completeness Gate

The completeness gate is structural-first.

It prefers known job-content containers and accepts the **best** candidate rather than the first match.

Fallback keyword/noise heuristics are retained only for unknown templates.

This reduces false negatives on custom employer pages while still filtering cookie/legal-only captures.

## Mongo Collections

Default collection names:

- `normalized_job_ads`
- `crawl_job_states`
- `ingestion_run_summaries`
- `ingestion_trigger_requests`

### Why `crawl_job_states` is modified here

If ingestion skips or fails a job, the service removes that job from `crawl_job_states`.

That means the next crawler run can fetch it again.

This keeps crawl state aligned with practically usable normalized output without introducing extra ingestion-state fields into crawl state.

## Ingestion Run Summaries

Run summaries now include:

- `searchSpaceId`
- `mongoDbName`
- totals and rates
- skipped/failed audit arrays
- cleaner/extractor/total LLM stats
- timing percentiles

That makes summaries queryable without unpacking nested context elsewhere.

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
- `MONGODB_CRAWL_JOBS_COLLECTION`
- `MONGODB_RUN_SUMMARIES_COLLECTION`
- `MONGODB_INGESTION_TRIGGERS_COLLECTION`
- `INPUT_ROOT_DIR`
- `INPUT_RECORDS_DIR_NAME`
- `CRAWL_RUNS_SUBDIR`
- `INGESTION_SAMPLE_SIZE`
- `INGESTION_CONCURRENCY`
- `INGESTION_API_HOST`
- `INGESTION_API_PORT`

## Commands

```bash
pnpm -C apps/jobs-ingestion-service build
pnpm -C apps/jobs-ingestion-service lint
pnpm -C apps/jobs-ingestion-service check-types
pnpm -C apps/jobs-ingestion-service start
pnpm -C apps/jobs-ingestion-service start-server
pnpm -C apps/jobs-ingestion-service align-crawl-state
```

## Key Files

- `src/app.ts`
  - workflow entrypoint, env resolution, run summary creation
- `src/server.ts`
  - Fastify trigger API and idempotent trigger lifecycle
- `src/job-parsing-graph.ts`
  - LangGraph workflow
- `src/html-detail-loader.ts`
  - deterministic HTML load + completeness validation
- `src/repository.ts`
  - Mongo writes and crawl-state prune/alignment
- `src/input-provider.ts`
  - local dataset + HTML record loading
