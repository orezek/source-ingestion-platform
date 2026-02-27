# Jobs Ingestion Service

`jobs-ingestion-service` converts crawler outputs (listing JSON + detail HTML snapshots) into normalized job documents (`normalized_job_ads`) using a LangGraph pipeline and Gemini structured extraction.

It supports two execution modes:

- batch CLI ingestion (`src/app.ts`)
- Fastify trigger API for idempotent crawl-run ingestion (`src/server.ts`)

## What This App Does

For each listing record + detail HTML snapshot pair, the service:

1. loads and validates the detail HTML page
2. builds cleaned plain-text content with Cheerio
3. runs Gemini text-cleaning prompt (`jobcompass-job-ad-text-cleaner`) to remove UI/GDPR/cookie noise
4. runs Gemini structured extraction using a LangSmith Hub prompt (`jobcompass-job-ad-structured-extractor`)
5. writes normalized output to JSON and optionally MongoDB (`normalized_job_ads`)
6. records run summaries and ingestion trigger state for observability

## Input Contract (Local MVP Handoff)

Current MVP integration expects local crawler artifacts under a run-specific folder:

```text
scrapped_jobs/
  runs/
    <crawlRunId>/
      dataset.json
      records/
        job-html-<sourceId>.html
```

The ingestion trigger API receives only:

```json
{
  "source": "jobs.cz",
  "crawlRunId": "<crawl-run-id>"
}
```

The service resolves the actual local folder using:

- `INPUT_ROOT_DIR`
- `CRAWL_RUNS_SUBDIR`
- `crawlRunId`

## Pipeline Architecture (LangGraph)

Defined in `src/job-parsing-graph.ts`.

Current graph nodes:

1. `loadDetailPage`
   - reads detail HTML from disk
   - handles plain HTML and gzip-compressed HTML
   - parses HTML with Cheerio
   - extracts plain text and validates completeness
   - returns metadata (hash, bytes, text content)

2. `cleanDetailText`
   - pulls LangSmith prompt `jobcompass-job-ad-text-cleaner`
   - cleans `textContent` (UI/GDPR/cookie/legal noise removal)
   - feeds cleaned text to extraction node
   - cleaned text is persisted to `rawDetailPage.cleanDetailText` in final document

3. `extractDetail`
   - pulls LangSmith prompt `jobcompass-job-ad-structured-extractor`
   - calls Gemini structured output with Zod schema
   - validates model output against the local canonical schema
   - applies normalization only (no deterministic field overrides)

4. `merge`
   - merges listing + extracted detail + ingestion metadata
   - validates final `unifiedJobAdSchema`

## Completeness Gate (Important)

The service skips pages that look incomplete or non-job pages.

Current strategy (stabilized for custom employer templates):

- **Structural-first validation**:
  - if a primary job-content container exists (for example `.cp-detail__content` or `#capybara-position-detail`) and contains enough text, the page is considered complete
- **Fallback heuristic**:
  - older keyword/noise signal heuristics are retained for unknown templates

This avoids false negatives on Alma Career / Capybara custom employer pages where valid content exists but page-wide cookie/legal/footer text previously dominated the heuristic.

Skipped pages are recorded in run summaries with listing metadata and quality signals.

## Output: Normalized Job Document

Final schema is `unifiedJobAdSchema` in `src/schema.ts`.

Key top-level sections:

- `crawlRunId`: crawler run identifier for traceability (`null` when unknown in generic CLI batch mode)
- `listing`: list-page snapshot
- `detail`: normalized extracted detail fields
- `rawDetailPage`: both step outputs with metadata per text snapshot:
  - `loadDetailPageText` (step 1 output)
  - `cleanDetailText` (step 2 output, extractor input)
- `ingestion`: run metadata, HTML hash/path, timing, token usage, costs, parser version

### Text Transformation Steps & Field Mapping

1. Step 1 (`loadDetailPage`)
   - input: raw HTML dump file
   - output: static-cleaned extracted text (`loadedDetailPage.textContent`)
2. Step 2 (`cleanDetailText`)
   - input: `loadedDetailPage.textContent`
   - output: LLM-cleaned text (`cleanedDetailText`)
3. Step 3 (`extractDetail`)
   - input: `cleanedDetailText`
   - output: structured `detail`

Persistence mapping:

- raw HTML source of truth:
  - file in `scrapped_jobs/runs/<crawlRunId>/records/*.html`
- static-cleaned text (step 1):
  - persisted to `normalized_job_ads.rawDetailPage.loadDetailPageText`
- LLM-cleaned text (step 2):
  - persisted to `normalized_job_ads.rawDetailPage.cleanDetailText`
- structured extraction result (step 3):
  - persisted to `normalized_job_ads.detail`

Primary Mongo collection (default):

- `normalized_job_ads`

## MongoDB Collections (Current Defaults)

Configured in `src/app.ts` / `src/server.ts` and `.env`.

- `normalized_job_ads`
  - normalized structured output documents
- `ingestion_run_summaries`
  - one document per ingestion run
- `ingestion_trigger_requests`
  - idempotent trigger lifecycle (`source + crawlRunId`)
- `crawl_job_states`
  - crawler state collection (used here only for cleanup/pruning non-success ingestion records)

### Why `crawl_job_states` is touched here

MVP consistency fix:

- if ingestion skips or fails a job, this service removes that job from `crawl_job_states`
- next crawler run can then re-fetch and retry it

This keeps crawler state aligned with practically usable normalized output, without adding ingestion lifecycle state to `crawl_job_states`.

## Run Summaries (Observability)

`ingestion_run_summaries` now includes:

- totals and rates:
  - `jobsTotal`
  - `jobsProcessed`
  - `jobsSkippedIncomplete`
  - `jobsFailed`
  - `jobsNonSuccess`
  - success/non-success/skipped/failed rates
- audit arrays:
  - `skippedIncompleteJobs[]`
  - `failedJobs[]`
- LLM telemetry blocks:
  - `llmCleanerStats`
  - `llmExtractorStats`
  - `llmTotalStats`

These arrays include listing metadata (title/company/url/etc.) so skipped/failed jobs can be investigated without relying on logs.

## Idempotent Ingestion Trigger API

Implemented in `src/server.ts`.

### Endpoint

- `POST /ingestion/start`

Request body:

```json
{
  "source": "jobs.cz",
  "crawlRunId": "<crawlRunId>"
}
```

Behavior:

- idempotent by `source + crawlRunId`
- duplicate requests do not start duplicate runs
- trigger request state persisted in `ingestion_trigger_requests`
- run executes in background after acceptance

Statuses:

- `pending`
- `running`
- `succeeded`
- `completed_with_errors`
- `failed`

### Health Endpoint

- `GET /health`

## Environment (`.env`)

Copy `apps/jobs-ingestion-service/.env.example` to `.env`.

Core runtime/env groups:

### Logging

- `LOG_LEVEL`
- `LOG_PRETTY`
- `LOG_TEXT_TRANSFORM_CONTENT` (set `true` to log text previews at each stage)
- `LOG_TEXT_TRANSFORM_PREVIEW_CHARS` (max chars for each preview log entry)

### Input / local handoff

- `INPUT_ROOT_DIR` (default `scrapped_jobs`)
- `INPUT_RECORDS_DIR_NAME` (default `records`)
- `CRAWL_RUNS_SUBDIR` (default `runs`)

### Ingestion execution controls

- `INGESTION_SAMPLE_SIZE` (integer, `all`, or unset)
- `INGESTION_CONCURRENCY`

### LLM / extraction

- `GEMINI_API_KEY`
- `LANGSMITH_API_KEY`
- `LLM_EXTRACTOR_PROMPT_NAME` (default `jobcompass-job-ad-structured-extractor`)
- `LLM_CLEANER_PROMPT_NAME` (default `jobcompass-job-ad-text-cleaner`)
- `GEMINI_MODEL`
- `GEMINI_TEMPERATURE`
- `GEMINI_THINKING_LEVEL`
- `DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS`
- token pricing envs for cost estimation

### Ingestion API server

- `INGESTION_API_HOST`
- `INGESTION_API_PORT`

### MongoDB

- `ENABLE_MONGO_WRITE`
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `MONGODB_JOBS_COLLECTION` (default `normalized_job_ads`)
- `MONGODB_CRAWL_JOBS_COLLECTION` (default `crawl_job_states`)
- `MONGODB_RUN_SUMMARIES_COLLECTION` (default `ingestion_run_summaries`)
- `MONGODB_INGESTION_TRIGGERS_COLLECTION` (default `ingestion_trigger_requests`)

### Run profile convention (MVP)

Use the same collection names in different databases.

- `prod_full`
  - `MONGODB_DB_NAME=jobCompass`
  - `ENABLE_MONGO_WRITE=true`
  - crawler-triggered runs from full crawler scans only
- `dev_sample`
  - `MONGODB_DB_NAME=job-compass-dev`
  - use for sample/debug runs and integration tests
  - same collection names, isolated DB state

### Parser metadata

- `PARSER_VERSION` (current default `jobs-ingestion-service-v0.9.0`)

## Run Modes

### 1. Batch CLI Ingestion (direct)

```bash
pnpm -C apps/jobs-ingestion-service build
pnpm -C apps/jobs-ingestion-service start
```

This runs ingestion from the configured `INPUT_ROOT_DIR` and writes JSON output.

### 2. Fastify Trigger API (recommended for crawler handoff)

```bash
pnpm -C apps/jobs-ingestion-service build
pnpm -C apps/jobs-ingestion-service start-server
```

Then trigger with:

```bash
curl -X POST http://127.0.0.1:3010/ingestion/start \
  -H 'content-type: application/json' \
  -d '{"source":"jobs.cz","crawlRunId":"<crawlRunId>"}'
```

## One-off Maintenance Command

Align crawler state with normalized output (removes orphaned crawler-state docs):

```bash
pnpm -C apps/jobs-ingestion-service build
pnpm -C apps/jobs-ingestion-service run align-crawl-state
```

## Local Pipeline Run Order (MVP)

1. Start ingestion API server
2. Run crawler actor
3. Crawler writes local shared run artifacts
4. Crawler triggers `/ingestion/start`
5. Ingestion processes that exact crawl run folder idempotently

## Validation Commands

```bash
pnpm -C apps/jobs-ingestion-service lint
pnpm -C apps/jobs-ingestion-service check-types
pnpm -C apps/jobs-ingestion-service build
```

## Troubleshooting

### `EADDRINUSE` on ingestion API startup

Port is already in use.

- Change `INGESTION_API_PORT`, or
- stop the existing process (`lsof -nP -iTCP:<port> -sTCP:LISTEN`)

Startup now fails fast on port conflicts.

### Trigger accepted but no ingestion result appears

Check:

- ingestion server logs (`start-server` process)
- `ingestion_trigger_requests` status for the `crawlRunId`
- local run directory exists under `scrapped_jobs/runs/<crawlRunId>/`

### High `jobsSkippedIncomplete`

Inspect:

- `ingestion_run_summaries.skippedIncompleteJobs[]`
- `detailHtmlPath` and `qualitySignals`

This usually indicates a completeness-gate false negative or a new page template pattern.

## Related Docs

- Detailed ingestion spec: `docs/specs/jobs-ingestion-service.md`
- Crawler/ingestion MVP design: `docs/specs/incremental-crawler-ingestion-monolith.md`
- App changelog: `apps/jobs-ingestion-service/CHANGELOG.md`
