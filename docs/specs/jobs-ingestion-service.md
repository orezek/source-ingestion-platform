# Spec: `jobs-ingestion-service`

## Status

- Owner: JobCompass ingestion / normalization pipeline
- Scope: Current implementation in `apps/jobs-ingestion-service`
- Mode: Local-monolith MVP (Fastify trigger + local crawl artifact consumption)

## Purpose

`jobs-ingestion-service` transforms crawler artifacts into normalized structured job documents using a combination of:

- deterministic HTML loading / validation (Cheerio)
- LLM-based text cleanup (Gemini + LangSmith Hub prompt)
- LLM-based structured extraction (Gemini + LangSmith Hub prompt)
- deterministic normalization and schema validation
- persistence to JSON and MongoDB

## Non-goals (Current Spec)

- Crawling list pages or fetching detail pages directly
- Remote artifact transport abstraction (bucket/object storage) for the MVP
- Long-running queue workers (trigger API starts in-process background runs)

## Runtime Environment

- Node.js 24+
- `fastify` (trigger API)
- `@langchain/langgraph`
- `@langchain/google-genai`
- `langchain` (LangSmith hub prompt pull)
- `cheerio`
- `mongodb`
- `zod`

## Inputs

### A. Batch CLI mode

Input source is filesystem under:

- `INPUT_ROOT_DIR`
- records dir `INPUT_RECORDS_DIR_NAME`

### B. Trigger API mode (recommended with crawler)

API request body:

```json
{
  "source": "jobs.cz",
  "crawlRunId": "<crawlRunId>"
}
```

The service resolves local run folder:

```text
<INPUT_ROOT_DIR>/<CRAWL_RUNS_SUBDIR>/<crawlRunId>/
```

Required files in run folder:

- `dataset.json`
- `records/*.html`

## Core Pipeline (Per Record)

Implemented via `JobParsingGraph`.

### Node 1: `loadDetailPage`

Responsibilities:

- resolve `htmlDetailPageKey` to local file path
- read file (plain HTML or gzip-compressed HTML)
- parse with Cheerio
- prune non-content DOM nodes
- extract cleaned plain-text content
- run completeness validation
- compute metadata (hash, bytes, gzip flag)

Outputs include:

- `rawHtml`
- `textContent`
- `textContent` prefers the best primary job-content container text when available (single cleaned text copy)
- detail HTML metadata (`sha256`, bytes, gzip)
- quality signals (when skipped)

### Node 2: `cleanDetailText`

Responsibilities:

- pull LangSmith Hub prompt (`LLM_CLEANER_PROMPT_NAME`, default `jobcompass-job-ad-text-cleaner`)
- pass `textContent` as prompt input
- return cleaned text output used for LLM extraction input and persisted to output

### Node 3: `extractDetail`

Responsibilities:

- pull LangSmith Hub prompt (`LLM_EXTRACTOR_PROMPT_NAME`, default `jobcompass-job-ad-structured-extractor`)
- provide prompt variables from listing + detail page text
- invoke Gemini structured output using Zod schema
- normalize extracted output
- no deterministic field overrides (model output is trusted, then normalized/validated)

### Node 4: `merge`

Responsibilities:

- merge listing snapshot + extracted detail + ingestion metadata
- attach `rawDetailPage` snapshots:
  - step-1 static-cleaned text + metadata
  - step-2 LLM-cleaned text + metadata
- validate final `unifiedJobAdSchema`

## Text Transformation Mapping (Source -> Stored Fields)

1. Step 1 (`loadDetailPage`)
   - source: raw HTML dump (`records/*.html`)
   - output: static-cleaned text (`loadedDetailPage.textContent`)
2. Step 2 (`cleanDetailText`)
   - source: step-1 text
   - output: LLM-cleaned text (`cleanedDetailText`)
3. Step 3 (`extractDetail`)
   - source: step-2 text
   - output: structured detail object (`detail`)

Persistence contract:

- Raw HTML dump remains the audit/reprocessing source of truth in filesystem artifacts.
- `normalized_job_ads.rawDetailPage.loadDetailPageText` stores step-1 static-cleaned text.
- `normalized_job_ads.rawDetailPage.cleanDetailText` stores step-2 LLM-cleaned text.
- `normalized_job_ads.detail` stores step-3 structured extraction output.

## Completeness Gate (Current Strategy)

This is a critical quality control step in `loadDetailPage`.

### Problem it solves

Avoid sending clearly incomplete / non-job pages to the LLM.

### Current strategy

1. Structural-first validation
   - detect known primary job-content containers (for Alma/Capybara templates)
   - if container exists and container text passes min chars/words, page is accepted

2. Fallback heuristic validation
   - use broader keyword/noise heuristics on unknown templates when no known container is found

### Why this matters

This avoids false negatives on custom employer pages where valid job content exists but cookie/legal/footer content distorts whole-page heuristics.

## Run Modes

### 1. Batch CLI (`src/app.ts`)

Use when you want to process a local folder directly.

Outputs:

- JSON file (`OUTPUT_JSON_PATH`)
- optional Mongo writes
- run summary (optional Mongo)

### 2. Fastify trigger API (`src/server.ts`)

Use when crawler should hand off a completed `crawlRunId`.

Properties:

- idempotent by `source + crawlRunId`
- trigger request lifecycle persisted in Mongo (`ingestion_trigger_requests`)
- background run execution
- `/health` endpoint for readiness checks

## MongoDB Responsibilities

### `normalized_job_ads`

Stores normalized structured job documents (`UnifiedJobAd`).

Traceability:

- top-level `crawlRunId` is stored when known (trigger mode or inferred from local run-folder path)
- `crawlRunId` may be `null` in generic CLI batch mode

### `ingestion_run_summaries`

Stores one summary doc per ingestion run with:

- counts and rates
- token/cost metrics
- skipped and failed job audit arrays
- parser/model metadata

### `ingestion_trigger_requests`

Stores idempotent trigger state:

- `pending`, `running`, `succeeded`, `completed_with_errors`, `failed`
- attempts, timestamps, compact result metrics

### `crawl_job_states` (cleanup responsibility only)

Current MVP consistency rule:

- if a job is skipped/failed during ingestion, remove it from `crawl_job_states`
- also supports one-off alignment command to remove orphaned crawl-state docs not present in `normalized_job_ads`

This ensures future crawler runs retry jobs that did not become usable normalized documents.

## Named Run Profiles (MVP Convention)

Use the same collection names in different Mongo databases.

- `prod_full`
  - `MONGODB_DB_NAME=jobCompass`
  - used with crawler-triggered full runs
- `dev_sample`
  - `MONGODB_DB_NAME=job-compass-dev`
  - used for sample/debug runs and integration tests

## Run Summary Semantics (`ingestion_run_summaries`)

Important fields:

- `jobsTotal = jobsProcessed + jobsSkippedIncomplete + jobsFailed`
- `jobsNonSuccess = jobsSkippedIncomplete + jobsFailed`
- rate fields in `[0, 1]`
- `llmCleanerStats`, `llmExtractorStats`, `llmTotalStats` provide per-node and overall token/cost/duration metrics
- `skippedIncompleteJobs[]` and `failedJobs[]` are audit payloads, not just counts

### `skippedIncompleteJobs[]`

Contains:

- listing metadata (`listing`)
- `sourceId`, source
- file references (`htmlDetailPageKey`, `detailHtmlPath`)
- skip reason
- quality signals (including structural completeness signals)

### `failedJobs[]`

Contains:

- listing metadata (`listing`)
- file references
- `errorName`, `errorMessage`

## Idempotency Rules (Trigger API)

Key: `source + crawlRunId`

Expected behavior:

- first request: claim and start run
- duplicate while running: return existing running state (deduplicated)
- duplicate after completion: return existing trigger doc (deduplicated)
- failed trigger doc can be retried by calling the same endpoint again

## Environment Variables

Defined in `src/app.ts` (`envSchema`).

Key groups:

- logging (`LOG_LEVEL`, `LOG_PRETTY`)
- local input/handoff (`INPUT_ROOT_DIR`, `CRAWL_RUNS_SUBDIR`, `INPUT_RECORDS_DIR_NAME`)
- concurrency/sampling (`INGESTION_CONCURRENCY`, `INGESTION_SAMPLE_SIZE`)
- LLM provider + prompt config (`GEMINI_*`, `LLM_*`; legacy `LANGSMITH_*` aliases remain supported)
- completeness tuning (`DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS`)
- costs (`GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS`, `GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS`)
- Fastify host/port (`INGESTION_API_HOST`, `INGESTION_API_PORT`)
- Mongo (`MONGODB_*` collections)
- parser metadata (`PARSER_VERSION`)

## Operational Constraints / Failure Modes

### Port already in use (`EADDRINUSE`)

- server startup now fails fast
- operator should change `INGESTION_API_PORT` or stop existing listener

### Missing crawl run directory

Trigger API marks request as failed if the resolved local run folder does not exist.

### Incomplete page false negatives

Handled by structural-first completeness gate; still possible on unknown templates. Diagnose via:

- `ingestion_run_summaries.skippedIncompleteJobs[]`
- `detailHtmlPath`
- `qualitySignals`

### LLM dependency failures

Examples:

- missing `GEMINI_API_KEY`
- missing `LANGSMITH_API_KEY`
- prompt pull errors
- model invocation errors

These appear in:

- trigger request status (`ingestion_trigger_requests`)
- run summary (`jobsFailed`, `failedJobs[]`)
- logs

## Maintenance / Recovery Commands

### Align crawler state with normalized output

```bash
pnpm -C apps/jobs-ingestion-service build
pnpm -C apps/jobs-ingestion-service run align-crawl-state
```

Use when historical runs left `crawl_job_states` out of sync with `normalized_job_ads`.

## Evolution Path (Intentional Simplicity First)

Current MVP uses local filesystem handoff for speed and simplicity.

Future evolution (not implemented here) can replace local run-folder resolution with an artifact manifest / bucket URI while preserving the trigger contract (`source + crawlRunId`).
