# Job Compass Actor Agent Instructions

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

- Preserve the current runtime entrypoint unless explicitly requested to refactor:
  - `build` -> `tsc`
  - `start` -> `node ./dist/main.js`
  - `dev` -> `tsx watch src/main.ts`
- Keep Apify actor metadata in `.actor/**` consistent with app behavior when changing scripts, Dockerfile, or README.
- Keep dependency style aligned with repo standards: internal packages as `workspace:*`.
- Keep dependency style aligned with repo standards: external shared dependencies as `catalog:`.
- Maintain TypeScript config inheritance via `@repo/typescript-config/node-lib.json`.
- Keep ESLint flat config extending `@repo/eslint-config`.
- Keep env loading type-safe through `@repo/env-config` + schema validation.

## Runtime Note

- This app is designed for Apify actor images and currently targets a Node 20 runtime there.
- Do not change the runtime image or Node compatibility level unless explicitly requested.

## App Purpose & Boundaries (MVP)

- This app is the crawler/orchestrator for the jobs.cz MVP pipeline.
- It is responsible for:
  - crawling list pages,
  - reconciling against `crawl_job_states` in MongoDB,
  - fetching detail pages only for selected jobs,
  - writing shared local crawl artifacts for ingestion,
  - optionally triggering `jobs-ingestion-service` via Fastify.
- It is **not** responsible for LLM parsing/normalization of job ads (that belongs to `jobs-ingestion-service`).

## Fixed MVP Crawl Scope (Important)

- MVP uses a **fixed jobs.cz start URL** (Praha + selected categories + 0 km radius).
- This is intentional and forms the stable dataset for ETL reliability, analytics, RAG/CAG experiments, and UI/dashboard development.
- The fixed scope currently means:
  - locality: Praha
  - radius: `0 km`
  - categories:
    - `IS/IT: Správa systémů a HW`
    - `IS/IT: Vývoj aplikací a systémů`
    - `IS/IT: Konzultace, analýzy a projektové řízení`
    - `Technika a vývoj`
- The actor now supports enforcing this scope with env vars:
  - `MVP_ENFORCE_FIXED_START_URL_SCOPE=true`
  - `MVP_FIXED_START_URL=<fixed jobs.cz URL>`
- Do not relax or replace this behavior unless explicitly requested.

## Incremental Crawl State Semantics

- Crawl-state collection: `crawl_job_states` (configurable name via env)
- DB name is configurable via `MONGODB_DB_NAME`.
- Detail scraping selection is based on **existence of `(source, sourceId)` in `crawl_job_states`**, not `isActive`.
- `isActive` is currently used for active/inactive bookkeeping and reporting, not for detail-fetch dedupe.

## Production vs Dev Run Policy (Critical)

- Partial/sample runs can corrupt production crawl state when inactive marking is enabled.
- For this reason, the actor now supports a guard that blocks partial list scans from reconciling into the production crawl-state DB:
  - `ENFORCE_FULL_SCAN_FOR_PROD_CRAWL_STATE=true`
  - `PROD_CRAWL_STATE_DB_NAME=jobCompass`
- If a run stops early at list-collection time because `maxItems` was reached (`maxItemsEnqueueGuardTriggered=true`), the actor **fails before reconciliation** when using the production crawl-state DB.

### Named Run Profiles (MVP Convention)

- `prod_full`
  - `MONGODB_DB_NAME=jobCompass`
  - full list scan only (no `maxItems`-limited partial runs)
  - `ENABLE_INGESTION_TRIGGER=true` when running the end-to-end local pipeline
- `dev_sample`
  - `MONGODB_DB_NAME=job-compass-dev`
  - sample/partial runs allowed for debugging (`maxItems` in actor input)
  - `ENABLE_INGESTION_TRIGGER=false` unless explicitly testing handoff/ingestion

### Operational Rule (MVP)

- Production state runs (`prod_full`) must be full scans.
- Sample/dev runs (`dev_sample`) must use a separate DB (same collection names are fine).

## Local Shared Output Contract (Crawler -> Ingestion)

- The actor writes crawl artifacts to a local shared directory for ingestion:
  - `LOCAL_SHARED_SCRAPED_JOBS_DIR` (default: `../jobs-ingestion-service/scrapped_jobs`)
- Per-run outputs are written under:
  - `.../runs/<crawlRunId>/`
- Each run folder contains:
  - `dataset.json` (listing records)
  - `records/*.html` (detail page HTML dumps)

## Ingestion Trigger Contract (Optional)

- When enabled, the actor calls `jobs-ingestion-service` after crawl finalization:
  - `ENABLE_INGESTION_TRIGGER=true`
  - `INGESTION_TRIGGER_URL=http://127.0.0.1:<port>/ingestion/start`
- Trigger payload is minimal:
  - `{ source: "jobs.cz", crawlRunId: "<uuid>" }`
- The ingestion service is expected to be idempotent.

## Run Summary Expectations

- `RUN_SUMMARY` and Mongo crawl summaries are operational artifacts and must reflect:
  - list phase / detail phase completion,
  - whether partial-scan guard was triggered,
  - crawl-state DB/collection actually used,
  - parsed list-page total (observational only, not control logic).
- `parsedListingResultsCountTotal` is page-reported and should not be treated as a crawler correctness metric.

## Testing Guidance (Local)

- Preserve local Apify `INPUT.json` for developer runs:
  - `storage/key_value_stores/default/INPUT.json`
- For automated tests / ad-hoc verification:
  - prefer `CRAWLEE_STORAGE_DIR=$(mktemp -d ...)`
  - disable ingestion trigger unless needed
  - use a temporary/dev DB (`MONGODB_DB_NAME=job-compass-dev-*`)
- Avoid running sample tests against production crawl-state DB (`jobCompass`).
