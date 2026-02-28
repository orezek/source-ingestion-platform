# Spec: `jobs-crawler-actor`

## Goal

Crawl a selected `jobs.cz` search space, reconcile current list visibility against trusted normalized documents, fetch detail HTML only for jobs missing from normalized state, and asynchronously hand off persisted artifacts to ingestion.

## Inputs

### Canonical operator input

- `searchSpaceId`
- optional overrides:
  - `maxItems`
  - `maxConcurrency`
  - `maxRequestsPerMinute`
  - `debugLog`
  - `proxyConfiguration`
  - `allowInactiveMarkingOnPartialRuns`

### Runtime env

- `JOB_COMPASS_DB_PREFIX`
- `MONGODB_DB_NAME`
- `MONGODB_URI`
- `MONGODB_JOBS_COLLECTION`
- `MONGODB_CRAWL_RUN_SUMMARIES_COLLECTION`
- `ENABLE_MONGO_RUN_SUMMARY_WRITE`
- `LOCAL_SHARED_SCRAPED_JOBS_DIR`
- `ENABLE_INGESTION_TRIGGER`
- `INGESTION_TRIGGER_URL`
- `INGESTION_TRIGGER_TIMEOUT_MS`
- `CRAWL_INACTIVE_GUARD_MIN_ACTIVE_COUNT`
- `CRAWL_INACTIVE_GUARD_MIN_SEEN_RATIO`

## Search-space model

Search spaces are checked-in JSON files under `search-spaces/*.json`.

They define:

- `searchSpaceId`
- `description`
- `startUrls`
- crawl defaults
- reconciliation policy
- optional ingestion defaults

## Database derivation

Default:

- `<JOB_COMPASS_DB_PREFIX>-<searchSpaceId>`

Explicit override:

- `MONGODB_DB_NAME`

## Trusted state

Persistent truth collection:

- `normalized_job_ads`

The crawler must not maintain a separate crawl-state collection.

## Two-phase flow

### Phase 1: listing reconciliation

1. crawl all list pages for the selected search space
2. build current seen `sourceId` set
3. reconcile against existing `normalized_job_ads`

For existing normalized docs that are seen:

- set `isActive = true`
- set `lastSeenAt = <observedAt>`
- set `lastSeenRunId = <crawlRunId>`
- refresh listing snapshot fields

For existing normalized docs that are not seen:

- set `isActive = false` only if inactive marking is allowed for this run

For seen jobs missing from `normalized_job_ads`:

- enqueue for phase-two detail processing

### Phase 2: detail artifacts + async ingestion

For each missing job:

1. fetch detail page
2. validate and persist detail HTML artifact
3. append listing metadata to `dataset.json`
4. trigger `POST /ingestion/item`

The crawler does not wait for ingestion completion.

## Partial-run safety rule

When a run is partial:

- seen existing normalized docs may still be refreshed
- unseen existing normalized docs must not be marked inactive

This is controlled by search-space reconciliation policy and guard rails.

## Shared output layout

```text
<LOCAL_SHARED_SCRAPED_JOBS_DIR>/
  runs/
    <crawlRunId>/
      dataset.json
      records/
        job-html-<sourceId>.html
```

## Trigger contract

Endpoint:

- `POST /ingestion/item`

Payload:

- `source`
- `crawlRunId`
- `searchSpaceId`
- `mongoDbName`
- `listingRecord`
- `detailHtmlPath`
- `datasetFileName`
- `datasetRecordIndex`

## Summaries

Crawler run summaries must include:

- search-space identity
- resolved DB name
- list-page counts
- reconciliation counts
- inactive-marking outcome
- detail rendering counts
- artifact write counts
- ingestion trigger counts
- failure samples

## Non-goals

This app does not:

- clean text
- extract structured job details
- create placeholder persistence for unseen jobs
- wait synchronously for ingestion to complete
