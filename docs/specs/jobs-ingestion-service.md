# Spec: `jobs-ingestion-service`

## Goal

Transform crawler artifacts into trusted normalized job documents and record ingestion observability, while supporting both live per-item ingestion and manual bulk backfill ingestion.

## Trusted state

Persistent truth collection:

- `normalized_job_ads`

Rules:

- document exists => ingestion succeeded at least once
- no placeholder docs
- crawler phase one owns later activity updates on existing normalized docs

## Inputs

### Live item ingestion

Endpoint:

- `POST /ingestion/item`

Required payload:

- `source`
- `crawlRunId`
- `searchSpaceId`
- `mongoDbName`
- `listingRecord`
- `detailHtmlPath`
- `datasetFileName`
- `datasetRecordIndex`

### Manual bulk ingestion

Endpoint:

- `POST /ingestion/start`

Required payload:

- `source`
- `crawlRunId`
- `searchSpaceId`
- `mongoDbName`

Manual direct app execution may also use local env plus artifact folder discovery.

## Runtime env

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
- `INGESTION_API_HOST`
- `INGESTION_API_PORT`
- LLM prompt/model settings

## Document ownership

Newly created normalized docs must include:

- `searchSpaceId`
- `isActive = true`
- `firstSeenAt`
- `lastSeenAt`
- `firstSeenRunId`
- `lastSeenRunId`

Those are seeded from the crawler listing record and crawl context during first successful ingestion.

## Pipeline

1. load detail HTML
2. perform deterministic completeness validation
3. run text cleaner prompt
4. run structured extractor prompt
5. merge listing + extracted detail + ingestion metadata
6. upsert trusted normalized doc
7. write ingestion run summary

## Raw text snapshots

Persist in `normalized_job_ads.rawDetailPage`:

- `loadDetailPageText`
- `cleanDetailText`

Both snapshots must include:

- `text`
- `charCount`
- `tokenCountApprox`
- `tokenCountMethod`

## Idempotency

- trigger lifecycle is persisted in `ingestion_trigger_requests`
- live item triggers are keyed per item and crawl run
- duplicate accepted triggers must be safe
- normalized upserts are keyed by document `id`

## Collections

Default collections:

- `normalized_job_ads`
- `ingestion_run_summaries`
- `ingestion_trigger_requests`

## Non-goals

This app does not:

- decide list visibility
- mark jobs inactive from list absence on its own
- maintain a separate crawl-state collection
