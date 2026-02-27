# Jobs Crawler Actor

`jobs-crawler-actor` crawls Jobs.cz list pages, extracts listing metadata, fetches detail-page HTML snapshots (for selected jobs), writes local crawl artifacts for ingestion, and can trigger `jobs-ingestion-service` after crawl finalization.

This app is the upstream producer in the JobCompass pipeline.

## What This App Does

At a high level, one run performs these phases:

1. Crawl list pages (`LIST`) and extract listing cards.
2. Reconcile the found jobs against Mongo crawler state (`crawl_job_states`) in incremental mode.
3. Fetch detail pages (`DETAILS`) only for jobs selected for detail scraping (currently new jobs).
4. Save rendered HTML snapshots and crawl metadata.
5. Write run summary (KV store and optional MongoDB summary collection).
6. Optionally trigger `jobs-ingestion-service` via Fastify (`POST /ingestion/start`).

## Responsibilities and Boundaries

Owned by this app:

- Jobs.cz list-page crawling and pagination
- Detail-page navigation and dynamic rendering waits
- Detail HTML snapshot generation (`page.content()` after render checks)
- Crawl state reconciliation (`crawl_job_states`)
- Crawl run summary generation (`RUN_SUMMARY` + optional Mongo summary)
- Local MVP handoff to `jobs-ingestion-service/scrapped_jobs`
- Optional ingestion trigger call

Not owned by this app:

- LLM extraction / structured parsing
- Unified normalized schema generation
- `normalized_job_ads` writes (done by `jobs-ingestion-service`)

## Runtime Modes

### 1. Apify Actor Mode (native actor behavior)

- Input comes from Apify actor input (`Actor.getInput()`)
- Storage uses Apify/Crawlee local/remote storages (dataset, key-value store, request queue)

### 2. Local Monorepo Mode (current MVP workflow)

- Input comes from local Apify-compatible file:
  - `apps/jobs-crawler-actor/storage/key_value_stores/default/INPUT.json`
- Crawl artifacts are written to a shared local directory used by `jobs-ingestion-service`
- Ingestion can be triggered automatically via Fastify

## Input (Actor Input / Local `INPUT.json`)

Defined by:

- `apps/jobs-crawler-actor/.actor/input_schema.json`

Required/optional fields:

- `startUrls` (optional): list of Jobs.cz search URLs. If omitted, defaults to `https://www.jobs.cz/prace/`
- `maxItems` (required): maximum number of job ads (detail pages) to target in the run
- `maxConcurrency` (optional, default `1`): crawler parallelism used for both list and detail phases
- `maxRequestsPerMinute` (optional, default `30`): crawler global request-rate limit used for both phases
- `proxyConfiguration` (optional): Apify proxy configuration object
- `debugLog` (optional): enables verbose crawl logging

### Local Input Example

```json
{
  "startUrls": [
    {
      "url": "https://www.jobs.cz/prace/praha/?field%5B%5D=200900012&field%5B%5D=200900013&field%5B%5D=200900011&field%5B%5D=200900033&locality%5Bradius%5D=0"
    }
  ],
  "maxItems": 50,
  "maxConcurrency": 1,
  "maxRequestsPerMinute": 10,
  "debugLog": false,
  "proxyConfiguration": {
    "useApifyProxy": false
  }
}
```

## Fixed MVP Crawl Scope (Current Product Dataset)

The current MVP intentionally uses a fixed Jobs.cz search scope as a stable working dataset for:

- ETL reliability and observability tuning
- RAG/CAG experiments
- enrichment and analytics workflows
- UI/dashboard prototyping

Scope (current default/expected start URL):

- location: Praha
- radius: `0 km`
- categories:
  - `IS/IT: Správa systémů a HW`
  - `IS/IT: Vývoj aplikací a systémů`
  - `IS/IT: Konzultace, analýzy a projektové řízení`
  - `Technika a vývoj`

Expected size varies, but is typically around ~1700 active jobs.

This scope can be enforced at runtime using:

- `MVP_ENFORCE_FIXED_START_URL_SCOPE=true`
- `MVP_FIXED_START_URL=<fixed jobs.cz URL>`

## Incremental Crawl Behavior (Current MVP)

This app uses Mongo crawler state (`crawl_job_states`) to avoid unnecessary detail-page fetching.

Current decision model:

- If `sourceId` is not in `crawl_job_states` -> enqueue for detail fetch (new)
- If `sourceId` exists in `crawl_job_states` -> treat as already known for detail-fetch decision (skip detail fetch for now)
- Jobs missing from the current list run are marked inactive immediately (guarded by safety thresholds)

Important interaction with ingestion:

- `jobs-ingestion-service` prunes non-success ingestion records from `crawl_job_states`
- This makes skipped/failed records eligible for re-fetch on future crawler runs without adding extra ingestion-state fields to crawl state

## Output Artifacts

### A. Crawlee Dataset Records

Each successfully processed detail page produces a dataset record with:

- list-page fields (`sourceId`, `jobTitle`, `companyName`, `location`, `salary`, `publishedInfoText`)
- canonical + redirected detail URL metadata
- render diagnostics (type/signal/text chars/wait ms)
- detail snapshot metadata (`htmlDetailPageKey`, `detailHtmlByteSize`, `detailHtmlSha256`)

Output schema metadata:

- `apps/jobs-crawler-actor/.actor/output_schema.json`

### B. Detail HTML Snapshots (Key-Value Store and Local Shared Folder)

Each fetched detail page HTML snapshot is stored under a key:

- `job-html-<sourceId>.html`

In local MVP handoff mode, the actor writes a run-scoped artifact folder under:

- `../jobs-ingestion-service/scrapped_jobs/runs/<crawlRunId>/`

Expected contents per run:

```text
scrapped_jobs/
  runs/
    <crawlRunId>/
      dataset.json
      records/
        job-html-<sourceId>.html
        ...
```

### C. Run Summary

The actor writes a crawl summary to the key-value store as:

- `RUN_SUMMARY`

Summary includes:

- input config snapshot
- stop reason
- list-page counters
- parsed page-reported listing totals (`Našli jsme X nabídek`)
- detail rendering breakdowns
- failed request URLs

Optional Mongo summary sink:

- `crawl_run_summaries`

## Dynamic Page Rendering (Why It Matters)

Many employer-hosted `*.jobs.cz` pages are client-rendered and require waiting after navigation before capturing HTML.

Implemented render patterns include:

- jobs.cz native template pages
- widget/capybara pages (`#widget_container` / `#capybara-position-detail`)
- vacancy-detail pages (`#vacancy-detail`) with template-specific loader handling

The crawler captures the HTML only after template-specific readiness signals are satisfied.

## Environment Variables (`.env`)

Documented example:

- `apps/jobs-crawler-actor/.env.example`

Key variables:

- `CRAWLEE_LOG_LEVEL`
- `LOCAL_SHARED_SCRAPED_JOBS_DIR`
- `ENABLE_INGESTION_TRIGGER`
- `INGESTION_TRIGGER_URL`
- `INGESTION_TRIGGER_TIMEOUT_MS`
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `MONGODB_CRAWL_JOBS_COLLECTION` (default `crawl_job_states`)
- `ENABLE_MONGO_RUN_SUMMARY_WRITE`
- `MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION` (default `crawl_run_summaries`)
- `CRAWL_INACTIVE_GUARD_MIN_ACTIVE_COUNT`
- `CRAWL_INACTIVE_GUARD_MIN_SEEN_RATIO`

### Run Profile Convention (MVP)

Use the same collection names in different databases.

- `prod_full`
  - `MONGODB_DB_NAME=jobCompass`
  - full list scan only (no `maxItems`-limited partial runs)
  - `ENABLE_INGESTION_TRIGGER=true` for end-to-end pipeline runs
- `dev_sample`
  - `MONGODB_DB_NAME=job-compass-dev`
  - sample runs allowed (`maxItems` in `INPUT.json`)
  - `ENABLE_INGESTION_TRIGGER=false` unless testing handoff/ingestion

The actor guard rails will refuse reconciling a `maxItems`-limited partial list scan into the production crawl-state DB when enabled.

## Local Development

### Build / Run

```bash
pnpm -C apps/jobs-crawler-actor build
pnpm -C apps/jobs-crawler-actor start
```

### Watch mode

```bash
pnpm -C apps/jobs-crawler-actor dev
```

### Required local input file

If local actor input is missing, the app now throws a clear error and points to:

- `apps/jobs-crawler-actor/storage/key_value_stores/default/INPUT.json`

## Local Pipeline (Crawler -> Ingestion)

When `ENABLE_INGESTION_TRIGGER=true`:

1. Crawler completes crawl + detail snapshot phase
2. Crawler writes shared local artifacts into `jobs-ingestion-service/scrapped_jobs/runs/<crawlRunId>/`
3. Crawler calls `POST /ingestion/start` on `jobs-ingestion-service`
4. `jobs-ingestion-service` processes the run idempotently by `source + crawlRunId`

## Validation Commands

```bash
pnpm -C apps/jobs-crawler-actor lint
pnpm -C apps/jobs-crawler-actor check-types
pnpm -C apps/jobs-crawler-actor build
```

## Troubleshooting

### `Input is missing!`

Create local Apify input file:

- `apps/jobs-crawler-actor/storage/key_value_stores/default/INPUT.json`

Or run with isolated temp storage using `CRAWLEE_STORAGE_DIR`.

### Ingestion trigger fails

Check:

- `ENABLE_INGESTION_TRIGGER=true`
- `INGESTION_TRIGGER_URL` matches ingestion API host/port
- `jobs-ingestion-service` server is running (`/health`)

### Detail pages appear loaded but ingestion skips them

This is usually an ingestion completeness-gate issue, not a crawler snapshot issue. Use:

- crawler detail HTML snapshots (`job-html-*.html`)
- `ingestion_run_summaries.skippedIncompleteJobs[]`

for diagnosis.

## Related Docs

- Detailed crawler spec: `docs/specs/jobs-crawler-actor.md`
- Incremental crawler + ingestion MVP design: `docs/specs/incremental-crawler-ingestion-monolith.md`
- App changelog: `apps/jobs-crawler-actor/CHANGELOG.md`
