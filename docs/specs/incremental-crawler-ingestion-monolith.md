# Incremental Crawler + Ingestion Trigger (Monolithic-First) Spec

## Status

Draft for review / agreement.

## Purpose

Reduce crawler cost and runtime by fetching detail pages only for new jobs, while keeping the implementation simple and compatible with future modularization.

This spec intentionally avoids Apify-specific architecture and focuses on a local/simple implementation first.

For MVP, crawler and ingestion remain two apps in the same monorepo and share local filesystem access.

## Goals

- Keep one crawler app/process (`jobs-crawler-actor`) with monolithic crawl flow.
- Crawl list pages first, then fetch detail pages only for new jobs.
- Persist crawler state across runs to support `new/existing/inactive` decisions.
- Trigger ingestion after crawler reaches a successful end state.
- Make ingestion start idempotent.
- Keep future split into multiple services possible without large refactor.

## Non-Goals (for this phase)

- No distributed queue between separate crawler services.
- No Fastify reconciliation endpoint for crawl reconciliation (reconciliation stays in crawler app).
- No bucket/object storage contract yet (local filesystem handoff for MVP).
- No refresh policy for changed jobs yet (only `new` jobs get detail fetch).
- No scope-based reconciliation complexity (single fixed start URL for now).

## Application Split (MVP)

### `apps/jobs-crawler-actor`

Owns:

- list crawl
- crawler state reconciliation (`new/existing/inactive`)
- detail fetch for `new` jobs only
- writing raw crawl artifacts (listing JSON + detail HTML dumps)
- crawl run summary
- triggering ingestion endpoint

### `apps/jobs-ingestion-service`

Owns:

- Fastify ingestion trigger endpoint (`POST /ingestion/start`)
- idempotent ingestion start behavior
- parsing/extraction pipeline
- normalized output persistence (`normalized_job_ads`)
- ingestion run summary

## High-Level Design

One `jobs-crawler-actor` run performs four phases:

1. List crawl (discover jobs and collect listing JSON records)
2. Reconciliation against crawler state collection
3. Detail fetch only for `new` jobs
4. Finalize run summary and trigger ingestion

## Local Artifact Handoff (MVP)

For MVP, the crawler writes artifacts directly into the ingestion app's local dataset directory so ingestion has immediate access without bucket integration.

Target directory (existing convention, default):

- `apps/jobs-ingestion-service/scrapped_jobs/`

MVP assumptions:

- both apps run on the same machine/environment
- both apps have read/write access to the shared monorepo workspace
- local path coupling is acceptable temporarily
- artifact base path is configured via environment variable (with a sensible default)

Artifacts written by crawler (MVP):

- listing dataset JSON (or equivalent listing snapshot file)
- detail HTML dumps referenced by `htmlDetailPageKey`

Future improvement (explicitly deferred):

- replace local filesystem handoff with bucket/object storage + URI references

## Why a Crawler State Collection Is Needed

The crawler needs persistent memory independent of ingestion/parser success.

If crawler dedupe used only `normalized_job_ads`, then jobs would be treated as `new` again when:

- crawl succeeded but ingestion has not run yet
- ingestion failed
- parser skipped a valid job temporarily
- parser behavior/schema changes

The crawler state collection is the crawler's own source of truth for:

- seen vs unseen jobs
- active vs inactive jobs
- last seen timestamps / run IDs
- detail snapshot metadata (when fetched)

## Collections

### 1) Crawler State Collection (new)

Proposed name: `crawl_job_states`

Purpose: incremental crawl state and crawl-owned metadata.

Minimal document shape (MVP):

```json
{
  "_id": "jobs.cz:2000769317",
  "source": "jobs.cz",
  "sourceId": "2000769317",
  "isActive": true,
  "firstSeenAt": "2026-02-25T10:00:00.000Z",
  "lastSeenAt": "2026-02-25T10:00:00.000Z",
  "firstSeenRunId": "crawl_20260225_100000_abcd",
  "lastSeenRunId": "crawl_20260225_100000_abcd",
  "listing": {
    "adUrl": "https://www.jobs.cz/rpd/2000769317/...",
    "jobTitle": "Vývojář ORACLE - senior/medior (m/ž)",
    "companyName": "ČSOB",
    "location": "Praha - Radlice",
    "salary": null,
    "publishedInfoText": "Aktualizováno dnes"
  },
  "detail": {
    "requestedDetailUrl": "https://www.jobs.cz/rpd/2000769317/...",
    "finalDetailUrl": "https://csob.jobs.cz/detail-pozice?...",
    "htmlDetailPageKey": "job-html-2000769317.html",
    "detailHtmlSha256": "sha256...",
    "detailHtmlByteSize": 123456,
    "detailRenderType": "vacancy-detail",
    "detailRenderSignal": "vacancy_primary_content",
    "detailRenderComplete": true
  }
}
```

Notes:

- `detail` fields can be absent until the first successful detail fetch.
- In current MVP, ingestion lifecycle state is kept out of `crawl_job_states`.
- `jobs-ingestion-service` prunes non-success jobs from `crawl_job_states` so crawler retries them later.

### 2) Existing Run Summary Collection (already implemented)

Keep using the existing crawl run summary collection (Mongo + KV summary).

This collection remains run-level, while `crawl_job_states` is job-level state.

## Required Indexes

For `crawl_job_states`:

- Unique index on `{ source: 1, sourceId: 1 }`
- Index on `{ source: 1, isActive: 1 }`
- Index on `{ lastSeenRunId: 1 }`

## Run Algorithm (MVP)

### Phase 0: Start Run

- Generate `crawlRunId`
- Initialize run summary counters
- Persist initial run summary status (`running`)

### Phase 1: List Crawl

- Crawl list pages (existing logic)
- Extract listing JSON records (existing list extraction)
- Build in-memory list of records for this run
- Build in-memory `seenSourceIds` set for this run

Output of this phase:

- `listingRecords[]`
- `seenSourceIds`

### Phase 2: Reconciliation (against `crawl_job_states`)

For each listing record:

- Lookup by `{ source, sourceId }`
- If not found:
  - classify as `new`
  - enqueue for detail fetch (internal queue in same run)
  - insert/update state doc with listing snapshot and active flags
- If found:
  - classify as `existing`
  - do not fetch details (for now)
  - update:
    - `isActive = true`
    - `lastSeenAt = now`
    - `lastSeenRunId = crawlRunId`
    - latest listing snapshot fields

Counters updated:

- `listSeenCount`
- `newCount`
- `existingCount`

### Phase 3: Detail Fetch (new jobs only)

- Consume internal queue of `new` jobs
- Run existing robust detail fetch/render logic
- Save HTML dump + detail metadata (existing behavior)
- Update `crawl_job_states` doc for that job with detail metadata

On success:

- `detailFetchedCount++`

On failure:

- keep state doc (job is still known and active if seen on list)
- record failure in run summary (`failedRequestUrls`, diagnostics)
- do not write partial detail metadata unless explicitly marked as partial

### Phase 4: Inactive Finalization (only after successful list crawl)

Precondition:

- List crawl completed successfully (not partial / not aborted before list completion)

Action:

- Mark inactive any `crawl_job_states` docs for `source = jobs.cz` where:
  - `isActive == true`
  - `lastSeenRunId != crawlRunId`

Update:

- `isActive = false`
- optional `inactiveAt = now`

Counter:

- `inactiveMarkedCount`

## Ingestion Trigger

### When Trigger Happens

After crawler finalizes:

- run summary persisted
- list reconciliation finished
- detail fetch phase finished (for all enqueued `new` jobs)

Trigger condition:

- crawler run status = `succeeded` or `completed_with_errors`

Rationale:

- detail fetch/render errors are expected during early page-variant discovery
- ingestion should still run on available successfully fetched details to preserve observability

### Trigger Contract (simple, local-first)

`POST /ingestion/start`

```json
{
  "source": "jobs.cz",
  "crawlRunId": "crawl_20260225_100000_abcd"
}
```

No artifact URI contract yet in MVP.

Ingestion service will read required records from Mongo (`crawl_job_states`) using `crawlRunId` and read raw files from the local shared directory (env-configurable base path, defaulting to `apps/jobs-ingestion-service/scrapped_jobs/`).

## Ingestion Idempotency Requirements

The ingestion start endpoint must be idempotent.

Expected behavior:

- First call for a new `crawlRunId`:
  - create ingestion run
  - start processing
  - return accepted/running
- Duplicate call for the same `crawlRunId` while running:
  - return current status (no duplicate processing)
- Duplicate call after completion:
  - return completed status (`deduplicated = true`)

Recommended unique key:

- `(source, crawlRunId)` for ingestion run records

Optional future extension:

- include `parserVersion` in dedupe key if reruns per parser version are needed

## Data Boundary Between Crawler and Ingestion (MVP)

Crawler (`jobs-crawler-actor`) owns:

- discovery (list pages)
- detail HTML dump capture
- crawl state (`crawl_job_states`)
- crawl run summary

Ingestion (`jobs-ingestion-service`) owns:

- parsing/extraction
- normalized schema docs
- ingestion run summary

Handoff keys:

- `crawlRunId`
- local artifact location convention (`apps/jobs-ingestion-service/scrapped_jobs/`) for MVP

## Named Run Profiles (MVP Convention)

Use the same collection names in different MongoDB databases.

- `prod_full`
  - `MONGODB_DB_NAME=jobCompass`
  - full crawler scan only (no sample `maxItems` runs)
  - safe to reconcile into production `crawl_job_states`
- `dev_sample`
  - `MONGODB_DB_NAME=job-compass-dev`
  - sample/debug runs allowed
  - same collection names, isolated DB state

## Future Modularity (without changing current MVP behavior)

This monolithic design should be implemented with clear internal module boundaries:

- `listExtractor`
- `reconciler`
- `detailFetcher`
- `stateRepository`
- `summaryWriter`
- `ingestionTrigger`

Future split can then move these into separate services with minimal contract changes.

Note:

- local filesystem artifact sharing is an MVP shortcut and not the long-term boundary
- the long-term boundary should be artifact references (e.g., bucket URIs), but this is intentionally deferred

## Failure Handling (MVP)

- If list crawl fails before completion:
  - do not mark inactive
  - do not trigger ingestion
  - persist run summary as failed

- If some detail fetches fail:
  - keep run summary with failures
  - still allow ingestion trigger (policy decision: only if useful)
  - failed detail URLs are auditable via run summary

Recommended initial policy:

- Trigger ingestion even with some detail fetch failures, as long as list crawl succeeded
- Ingestion processes only jobs with valid detail HTML available

## Pragmatic MVP Safeguards (Recommended)

These are low-complexity additions that materially improve reliability without changing architecture.

1. Mass-inactivation safety switch

- Before applying immediate inactive updates, compare counts against the previous successful run.
- If the run appears abnormally small (for example, a large sudden drop), skip inactive finalization and mark the run summary with `inactiveFinalizationSkipped = true`.

2. Single-run lock

- Prevent overlapping crawler runs for the same source (simple Mongo lock document with TTL/heartbeat or process-level lock if single deployment).
- This avoids race conditions on `lastSeenRunId` and inactive marking.

3. Startup path validation

- On actor startup, validate that the configured local artifact base path exists and is writable.
- Fail fast before crawling if not writable.

4. Stable file naming + atomic file writes

- Continue stable keys like `job-html-<jobId>.html`.
- Write to a temp file and rename on success to avoid ingestion seeing partial files in edge cases.

5. Reconciliation and update batching

- Use Mongo `bulkWrite` for list reconciliation updates to keep list phase fast and predictable.

6. Index creation on startup (idempotent)

- Ensure required `crawl_job_states` indexes exist automatically.
- This avoids hidden performance issues and duplicate-key surprises later.

## Open Questions (for agreement)

1. Resolved: keep ingestion state fully separate (no `ingestionStatus` subdocument in `crawl_job_states`); prune non-success jobs from crawler state instead.
2. Do we want to store `inactiveAt` now, or add it later?

## Proposed MVP Implementation Order

1. Add `crawl_job_states` repository and indexes
2. Implement list reconciliation + `new/existing` classification
3. Restrict detail fetch to `new` jobs only
4. Add inactive finalization (safe guard: only after successful list crawl)
5. Add idempotent ingestion trigger (`POST /ingestion/start`)
6. Extend run summary counters (`new`, `existing`, `inactive`, `detailFetched`)
7. Add MVP safeguards (at minimum: startup path validation, index creation, optional mass-inactivation switch)
