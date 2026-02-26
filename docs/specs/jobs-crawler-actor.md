# Spec: `jobs-crawler-actor`

## Status

- Owner: JobCompass (crawler pipeline)
- Scope: Current implementation in `apps/jobs-crawler-actor`
- Mode: MVP local-monolith integration (crawler + local handoff + optional ingestion trigger)

## Purpose

`jobs-crawler-actor` is responsible for discovering jobs from Jobs.cz list pages, fetching rendered detail-page HTML snapshots, and producing crawl artifacts for downstream ingestion.

It is optimized for:

- incremental crawling (avoid re-fetching known details)
- resilient rendering waits for Jobs.cz and custom employer `*.jobs.cz` pages
- observability via run summaries and detail render metadata
- local handoff to `jobs-ingestion-service`

## Fixed MVP Crawl Scope (Current Product Dataset)

The current MVP intentionally targets a fixed Jobs.cz scope to create a stable dataset for ETL reliability, analytics, RAG/CAG experimentation, and UI/dashboard development.

Current fixed scope:

- locality: Praha
- radius: `0 km`
- categories:
  - `IS/IT: Správa systémů a HW`
  - `IS/IT: Vývoj aplikací a systémů`
  - `IS/IT: Konzultace, analýzy a projektové řízení`
  - `Technika a vývoj`

The actor supports enforcing this via:

- `MVP_ENFORCE_FIXED_START_URL_SCOPE=true`
- `MVP_FIXED_START_URL=<fixed jobs.cz URL>`

## Non-goals (Current Spec)

- LLM extraction / semantic parsing of job content
- Maintaining normalized job schema outputs (`normalized_job_ads`)
- Remote artifact storage abstraction (bucket/object store) for the MVP
- Multi-service distributed queue orchestration

## Runtime Environment

- Node.js runtime target: Node 20+ (kept for Apify actor compatibility)
- Frameworks: Apify + Crawlee + Playwright
- Storage:
  - Crawlee dataset / key-value store / request queue
  - MongoDB for incremental crawl state and optional run summaries
  - local filesystem handoff directory (`jobs-ingestion-service/scrapped_jobs`) in MVP local mode

## Inputs

### Actor Input (primary run input)

Defined in `.actor/input_schema.json`.

Fields:

- `startUrls[]` (optional)
- `maxItems` (required)
- `proxyConfiguration` (optional)
- `debugLog` (optional)

### Runtime environment (process env / `.env`)

Defined in `src/env-setup.ts`.

Key settings:

- `CRAWLEE_LOG_LEVEL`
- `LOCAL_SHARED_SCRAPED_JOBS_DIR`
- `ENABLE_INGESTION_TRIGGER`
- `INGESTION_TRIGGER_URL`
- `INGESTION_TRIGGER_TIMEOUT_MS`
- `MONGODB_URI`, `MONGODB_DB_NAME`
- `MONGODB_CRAWL_JOBS_COLLECTION`
- `ENABLE_MONGO_RUN_SUMMARY_WRITE`
- `MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION`
- inactive marking guards:
  - `CRAWL_INACTIVE_GUARD_MIN_ACTIVE_COUNT`
  - `CRAWL_INACTIVE_GUARD_MIN_SEEN_RATIO`

### Named Run Profiles (MVP Convention)

- `prod_full`
  - `MONGODB_DB_NAME=jobCompass`
  - full list scan only
  - optional ingestion trigger enabled for end-to-end runs
- `dev_sample`
  - `MONGODB_DB_NAME=job-compass-dev`
  - sample/partial runs allowed (`maxItems`)
  - same collection names, isolated DB state

## High-Level Flow

### Phase 1: Initialization

1. `Actor.init()`
2. Read and validate actor input
3. Configure logging and proxy
4. Initialize Mongo integrations (crawler state, optional summary sink)
5. Generate `crawlRunId`

### Phase 2: List Crawl (`LIST` handler)

For each list page:

1. Wait for list page readiness
2. Extract job cards (`article.SearchResultCard` and fallbacks)
3. Build normalized list-page records (title, company, location, salary, sourceId, canonical ad URL)
4. Enqueue detail requests (subject to `maxItems` / dedupe)
5. Follow pagination (`next` link) until exhausted or capped

Recorded metrics include:

- list pages visited
- total job cards seen
- unique details enqueued
- duplicates/already-handled detail requests
- parsed page-reported listing total (`Našli jsme X nabídek`) on seed page(s)

### Phase 3: Reconciliation (Incremental Crawl)

Reconciliation is driven by `crawl_job_states`.

Current MVP behavior:

- `new`: `sourceId` not found in crawler state -> eligible for detail fetch
- `existing`: `sourceId` exists -> detail fetch skipped for now
- `missing from current list`: marked inactive immediately after successful list scan, with guard rails

Important consistency behavior (implemented in ingestion service):

- `jobs-ingestion-service` removes skipped/failed jobs from `crawl_job_states`
- This allows future crawler runs to re-fetch and retry them without storing ingestion lifecycle state in crawl state

## Phase 4: Detail Crawl (`DETAILS` handler)

For each selected detail job:

1. Navigate to canonical Jobs.cz detail URL (`requestedDetailUrl`)
2. Detect redirects to custom `*.jobs.cz` domains
3. Wait for page to render using template-specific readiness checks
4. Capture rendered HTML with `page.content()`
5. Compute detail snapshot metadata (bytes, SHA-256)
6. Save HTML snapshot (`job-html-<sourceId>.html`)
7. Push dataset record with listing + detail render metadata

### Detail rendering patterns (current support)

- `jobscz-template`
- `widget` / capybara pages (`#widget_container`, `#capybara-position-detail`)
- `vacancy-detail` pages (`#vacancy-detail`, `.cp-detail__content`)

Known design point:

- readiness checks are structural and template-specific (not only `load` event), because many employer pages render content asynchronously

## Phase 5: Local Artifact Handoff (MVP)

The crawler writes a run-scoped local artifact directory for ingestion:

```text
<LOCAL_SHARED_SCRAPED_JOBS_DIR>/runs/<crawlRunId>/
  dataset.json
  records/
    job-html-<sourceId>.html
```

This is the current contract consumed by `jobs-ingestion-service`.

## Phase 6: Run Summary and Optional Trigger

### Run summary

Always written to Crawlee KV store as `RUN_SUMMARY`.

Optional Mongo summary write:

- collection: `crawl_run_summaries`

### Ingestion trigger (optional, best effort)

If `ENABLE_INGESTION_TRIGGER=true`:

- POST to `INGESTION_TRIGGER_URL`
- body: `{ source, crawlRunId }`

This trigger is best-effort and does not invalidate an otherwise successful crawl.

## Data Products

### Dataset record (per detail snapshot)

Key fields:

- listing metadata (`sourceId`, `jobTitle`, `companyName`, `location`, `salary`, `publishedInfoText`)
- `adUrl` (canonical jobs.cz listing detail URL)
- `requestedDetailUrl`
- `finalDetailUrl`, `finalDetailHost`, `detailRedirected`
- `detailRenderType`, `detailRenderSignal`, `detailRenderTextChars`, `detailRenderWaitMs`, `detailRenderComplete`
- `htmlDetailPageKey`, `detailHtmlByteSize`, `detailHtmlSha256`

### `crawl_run_summaries` (optional Mongo sink)

Fields include:

- `crawlRunId`
- input snapshot (`startUrls`, `maxItems`, pacing)
- `status`, `stopReason`
- list-page counters and parsed seed-page totals
- detail rendering breakdowns
- failed request URL list

### `crawl_job_states` (Mongo state collection)

Purpose:

- crawler memory for incremental crawl decisions
- active/inactive state tracking
- does **not** store ingestion lifecycle state in current MVP

Note:

- production crawl state should only be mutated by `prod_full` runs
- sample/debug runs should use `dev_sample` (separate DB)

## Correctness Rules

1. `crawl_job_states` must not remain polluted with jobs that failed/skipped ingestion.
   - Enforced by `jobs-ingestion-service` pruning non-success outcomes.
2. Inactive marking runs only after a successful list-scan phase and guard-rail checks.
3. Detail HTML snapshots are considered source-of-truth crawl artifacts for downstream parsing.

## Operational Constraints / Failure Modes

### Blocking / rate limiting

Mitigations:

- `maxConcurrency` and `maxRequestsPerMinute` input controls
- proxy support (`proxyConfiguration`)
- retry handling in Crawlee

### Dynamic render timeouts

If readiness checks fail:

- request is retried by Crawlee
- if retries exhausted, request ends in failed requests summary
- no dataset record / no HTML snapshot is stored for that detail

### Local handoff path mismatch

If the shared directory is wrong, crawler still crawls but ingestion trigger may fail or ingestion won’t find artifacts.

## Observability

Primary observability sources:

- Crawlee logs (LIST / DETAILS handlers)
- `RUN_SUMMARY` KV record
- optional Mongo `crawl_run_summaries`
- `detailRender*` metadata in dataset records

## Security / Safety Notes

- Prefer Apify proxy or other proxy strategy for non-local runs
- Keep crawl pacing conservative during template exploration
- Do not log sensitive tokens/secrets

## Evolution Path (Intentional Future Modularity)

Current design keeps crawler monolithic for speed of iteration, but can be split later into:

- list discovery
- reconciliation service
- detail fetch worker
- artifact publisher

The `crawlRunId` + local run-folder contract is the current boundary to preserve.
