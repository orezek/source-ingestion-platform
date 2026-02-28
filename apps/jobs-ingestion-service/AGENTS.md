# Scoped Agent Notes: `apps/jobs-ingestion-service`

This app is the asynchronous ingestion and extraction service behind the crawler.

## What this app owns

- detail HTML loading and completeness validation
- text cleaning LLM step
- structured extraction LLM step
- writing `normalized_job_ads`
- writing `ingestion_run_summaries`
- writing `ingestion_trigger_requests`
- idempotent Fastify trigger handling

## Trusted state model

Do not create placeholder normalized docs.

Rules:

- a document in `normalized_job_ads` means ingestion succeeded at least once
- absence from `normalized_job_ads` means the crawler should still consider the job unprocessed
- ingestion is idempotent by job identity and trigger identity

## Trigger endpoints

- `POST /ingestion/item`
  - primary live production path
- `POST /ingestion/start`
  - manual/bulk backfill path

## Normalized document requirements

New normalized docs must include:

- `searchSpaceId`
- `isActive`
- `firstSeenAt`
- `lastSeenAt`
- `firstSeenRunId`
- `lastSeenRunId`

For newly ingested docs those values come from the crawler listing record and crawl run context.

## Files that matter most

- `src/app.ts`
- `src/server.ts`
- `src/job-parsing-graph.ts`
- `src/html-detail-loader.ts`
- `src/repository.ts`
- `src/input-provider.ts`

## Operational invariant

The ingestion boundary is:

- HTML artifact persisted
- trigger accepted

The crawler does not wait for ingestion completion.
