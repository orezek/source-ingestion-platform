# Jobs Ingestion Service Agent Instructions

These instructions are app-local extensions of the repository root rules.

## Inheritance (Mandatory)

- Always apply root `AGENTS.md` first.
- Always apply `.aiassistant/rules/monorepo.md`.
- This file may add stricter local constraints but must not weaken root rules.
- If this file conflicts with root rules, root rules win.

## Scope

- This file applies to the app directory that contains this file (`./**`).
- Do not treat these rules as global to other apps or packages.

## App-Specific Constraints

- Preserve script conventions in the local app `package.json`: `build` -> `tsc`.
- Preserve script conventions in the local app `package.json`: `start` -> `node dist/app.js`.
- Preserve script conventions in the local app `package.json`: `dev` -> `tsx watch src/app.ts`.
- Keep dependency style aligned with repo standards: internal packages as `workspace:*`.
- Keep dependency style aligned with repo standards: external shared dependencies as `catalog:`.
- Maintain TypeScript config inheritance via `@repo/typescript-config/node-lib.json`.
- Keep ESLint flat config extending `@repo/eslint-config`.
- Keep env loading type-safe through `@repo/env-config` + schema validation.

## App Purpose & Boundaries

- This app is the ingestion/parsing service for crawler outputs.
- It is responsible for:
  - receiving ingestion triggers via Fastify (`POST /ingestion/start`),
  - reading crawl artifacts from shared local storage,
  - running the LangGraph extraction pipeline,
  - writing normalized job documents to MongoDB (`normalized_job_ads`),
  - writing ingestion summaries / trigger tracking,
  - pruning non-success jobs from `crawl_job_states` so the crawler retries them next run.
- It is **not** responsible for crawling list/detail pages (that belongs to `jobs-crawler-actor`).

## Modes of Operation

### 1) Fastify Trigger Mode (MVP default integration path)

- Start the server (`start-server`) and let the crawler trigger ingestion.
- Trigger endpoint is idempotent and keyed by `{ source, crawlRunId }`.
- Trigger request tracking is stored in `ingestion_trigger_requests`.

### 2) CLI Batch Mode (maintenance/debug)

- The app can run directly in batch mode (`start`) against an input root.
- This is useful for local debugging/reprocessing, but it bypasses trigger idempotency tracking.

## Shared Local Handoff Contract (Crawler -> Ingestion)

- Crawler writes per-run artifacts into:
  - `apps/jobs-ingestion-service/scrapped_jobs/runs/<crawlRunId>/`
- This service reads:
  - `dataset.json`
  - `records/*.html`
- The trigger payload includes only `{ source, crawlRunId }`; HTML is not sent over HTTP.
- The crawler is expected to use a full production scan when writing into production collections; sample runs should use a dev DB (same collection names) to avoid corrupting `crawl_job_states`.

### Named Run Profiles (MVP Convention)

- `prod_full`
  - crawler uses `MONGODB_DB_NAME=jobCompass`
  - ingestion uses `MONGODB_DB_NAME=jobCompass`
  - crawler runs full list scan and triggers ingestion
- `dev_sample`
  - crawler uses `MONGODB_DB_NAME=job-compass-dev`
  - ingestion uses `MONGODB_DB_NAME=job-compass-dev`
  - sample/partial runs are allowed for debugging

## Parsing / Extraction Pipeline (Current Behavior)

- `loadDetailPage` is deterministic and performs:
  - file read + gzip detection/decompression
  - Cheerio DOM parsing + non-content pruning
  - completeness validation
  - text extraction for downstream LLM processing
- The structured extraction is performed downstream in the LangGraph pipeline.

## Detail Page Completeness Gate (Important)

- Completeness validation is **structural-first**:
  - it prefers known job content containers (e.g. `.cp-detail__content`, `#capybara-position-detail`, `.job-detail*`, `.m-detail*`)
  - selects the **best** candidate container (not first match)
- If a valid primary content container is found and passes min chars/words, the page is accepted.
- Keyword/noise heuristics are still retained as a fallback for unknown templates.

## Raw Text Quality Rule (Current MVP)

- Keep only one processed text copy in the pipeline output (`textContent`) plus raw HTML dump.
- When a valid primary job content container exists, `textContent` uses the primary container text (not whole-body merged text) to reduce cookie/legal/footer noise.
- `rawHtml` remains the audit/reprocessing source of truth.

## Mongo Collection Responsibilities (Current Naming)

- `normalized_job_ads`
  - parsed/normalized job documents (final ingestion output)
  - includes top-level `crawlRunId` when known (trigger mode or inferred from local run-folder path); `null` in generic CLI batch mode
- `ingestion_run_summaries`
  - run-level summaries, metrics, rates, and skipped/failed audit arrays
- `ingestion_trigger_requests`
  - idempotent trigger lifecycle tracking for `POST /ingestion/start`
- `crawl_job_states` (shared with crawler)
  - crawler state; this service may prune non-success jobs after ingestion

## Crawler State Alignment Behavior (Critical)

- To avoid jobs getting stuck in crawler state when ingestion skips/fails them:
  - non-success jobs (`skippedIncomplete`, `failed`) are removed from `crawl_job_states`
  - this ensures the next crawler run treats them as new and retries detail scraping
- This is an intentional MVP simplification (no ingestion status is stored in `crawl_job_states`).

## Ingestion Summary Expectations

- `ingestion_run_summaries` should preserve enough observability to debug non-success runs:
  - `jobsTotal`, `jobsProcessed`, `jobsSkippedIncomplete`, `jobsFailed`
  - success/non-success rates
  - `skippedIncompleteJobs[]`
  - `failedJobs[]`
- Timestamps are stored in UTC ISO 8601 (`...Z`) for consistency across services and environments.

## Local Operations / Troubleshooting

- API listen port is controlled by `INGESTION_API_PORT` (default `3010`).
- If the port is in use, startup now fails fast with a clear error (`EADDRINUSE` path).
- When testing locally, align the crawler trigger URL with the server port:
  - actor `INGESTION_TRIGGER_URL=http://127.0.0.1:<port>/ingestion/start`

## Testing Guidance

- Prefer isolated temp collections / dev DBs for integration tests.
- Preserve shared run artifacts only when needed for debugging; otherwise clean test artifacts after verification.
- When changing parser/completeness behavior, validate against a real saved run (not only synthetic HTML) and compare skipped counts before/after.
