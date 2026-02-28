# Scoped Agent Notes: `apps/jobs-crawler-actor`

This app is the `jobs.cz` crawler and phase-one reconciliation service.

## What this app owns

- search-space resolution
- list-page crawling
- phase-one reconciliation against `normalized_job_ads`
- inactive marking for full/allowed runs
- detail HTML capture for jobs missing from normalized docs
- asynchronous per-item ingestion triggers
- crawl run summaries

## Trusted state model

Do not reintroduce a separate crawl-state collection.

Persistent truth is:

- `normalized_job_ads`

Rules:

- if a normalized document exists, the job was successfully ingested at least once
- phase one updates only existing normalized docs
- phase two only handles jobs missing from normalized docs
- partial runs must not mark unseen existing docs inactive

## Search-space rules

Search spaces are canonical operator config.

- human-maintained config lives in `search-spaces/*.json`
- runtime input selects `searchSpaceId` plus optional overrides
- DB name is derived from search space unless explicitly overridden

## Trigger contract

Primary live handoff endpoint:

- `POST /ingestion/item`

The crawler should trigger ingestion only after the HTML artifact is durably persisted.

## Files that matter most

- `src/main.ts`
- `src/search-space.ts`
- `src/normalized-jobs-repository.ts`
- `src/detail-rendering.ts`
- `src/listing-card-parser.ts`
- `src/local-shared-output.ts`

## Operational invariant

If a crawl crashes after some item triggers were accepted:

- successfully ingested items exist in `normalized_job_ads`
- missing items do not exist there and must be retried by later runs

That invariant must stay true.
