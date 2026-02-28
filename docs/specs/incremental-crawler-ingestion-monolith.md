# Spec: Search-Space Crawler + Async Ingestion Contract

## Purpose

Define the agreed MVP architecture between:

- `jobs-crawler-actor`
- `jobs-ingestion-service`

## Core principle

There is one trusted persistent state collection:

- `normalized_job_ads`

Everything else is runtime input, artifact storage, or observability.

## Search spaces

A search space is the canonical crawl definition.

It owns:

- `searchSpaceId`
- start URLs
- crawl defaults
- reconciliation policy

It also determines the default database name:

- `<JOB_COMPASS_DB_PREFIX>-<searchSpaceId>`

## Phase model

### Phase 1: list reconciliation

The crawler scans the selected search space and builds the current listing set.

Against existing `normalized_job_ads` in the search-space database:

- seen docs:
  - `isActive = true`
  - `lastSeenAt = <observedAt>`
  - `lastSeenRunId = <crawlRunId>`
- unseen docs:
  - `isActive = false` only for full allowed reconciliation
- seen jobs missing from `normalized_job_ads`:
  - move to phase two

### Phase 2: detail artifacts + async ingestion

For each missing job:

1. fetch detail page
2. persist HTML artifact
3. append listing record to crawl-run dataset output
4. send `POST /ingestion/item`

The crawler does not wait for ingestion completion.

## Partial-run rule

On a partial run:

- seen existing normalized docs may be refreshed
- unseen existing normalized docs must not be marked inactive

This preserves truth.

## Ingestion rule

Ingestion creates normalized docs only after successful processing.

That means:

- doc exists => processed successfully at least once
- doc missing => crawler should still consider it eligible for detail fetch on later runs

## Handoff boundary

The crawler-to-ingestion handoff boundary is:

- HTML artifact written successfully
- item trigger accepted successfully

## Why this design

This removes the old trust gap where crawler-only state could say a job was already handled even when ingestion never completed.

With the new design:

- crawler failure after some item triggers is acceptable
- successfully ingested jobs exist in `normalized_job_ads`
- not-yet-ingested jobs do not exist there and are naturally retried later

## Collections

Per search-space database:

- `normalized_job_ads`
- `crawl_run_summaries`
- `ingestion_run_summaries`
- `ingestion_trigger_requests`

No separate `crawl_job_states` collection.
