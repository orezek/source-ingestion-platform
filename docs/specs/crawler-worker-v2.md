# Spec Draft: Crawler Worker v2

## Status

- draft
- worker-facing v2 implementation spec
- aligned with the pipeline-first control-plane model

## Purpose

Define `crawler-worker-v2` as a standalone execution service with a minimal bootstrap env, a REST
`StartRun` command, stable artifact/output behavior, and pipeline-safe reconciliation semantics.

## Inherited Assumptions

This spec assumes the v2 control plane uses the pipeline-first model.

Canonical rules inherited from that model:

- one pipeline owns one logical database
- `normalized_job_ads` in that database is the pipeline's canonical production dataset
- pipeline execution identity is immutable after create
- `source` and `searchSpace` must not change on an existing pipeline

These assumptions are what make inactive marking safe.

## Worker Role

`crawler-worker-v2` is an execution service.

It should:

- accept `StartRun` over REST
- execute one crawl run from a resolved immutable input snapshot
- write HTML artifacts to the configured artifact sink
- write crawler summary telemetry to `crawl_run_summaries`
- publish crawler lifecycle and detail-captured events
- act as a Pub/Sub publisher only in V2 MVP
- reconcile inactive jobs against the pipeline-owned `normalized_job_ads` collection when enabled

It should not:

- own operator-facing configuration CRUD
- infer crawl input by reading mutable control-plane resources
- know anything about ingestion parser/model configuration
- know anything about structured output routing beyond whether downstream events should be emitted
- subscribe to runtime Pub/Sub topics

## Bootstrap Environment

Minimal bootstrap env:

- `PORT`
- `SERVICE_NAME`
- `SERVICE_VERSION`
- `CONTROL_AUTH_MODE`
- `CONTROL_SHARED_TOKEN` or `CONTROL_JWT_PUBLIC_KEY`
- `GCP_PROJECT_ID`
- `PUBSUB_EVENTS_TOPIC`
- `MONGODB_URI`
- `LOG_LEVEL`
- `MAX_CONCURRENT_RUNS`

Not part of bootstrap env:

- artifact bucket/path settings

Reason:

- artifact storage is worker execution input and is carried per run in `artifactSink`

V3 candidate:

- proxy/bootstrap settings for Apify-compatible proxy support

Proxy support is intentionally deferred from this v2 worker contract.

## StartRun Contract

### Transport

The crawler worker accepts:

- `POST /v1/runs`

This is the crawler `StartRun` command.

Minimal worker HTTP surface:

- `GET /healthz`
- `GET /readyz`
- `POST /v1/runs`
- `POST /v1/runs/{runId}/cancel`

### Identity And Provenance

The command must contain:

- `runId`
- `idempotencyKey`
- crawler `runtimeSnapshot`
- `inputRef`
- `artifactSink`
- `persistenceTargets.dbName`

Semantics:

- `runId` identifies one concrete execution instance
- for crawler/integration purposes, `runId` is also the canonical `crawlRunId`
- pipeline provenance remains in the control-plane run ledger, not in the worker-facing command
- the worker-facing command excludes `workerType`, `requestedAt`, and `correlationId`

### Crawler `inputRef`

`crawlerStartRunRequestV2.inputRef` should be defined explicitly in v2.

Required shape:

- `source`
- `searchSpaceId`
- `searchSpaceSnapshot`
  - `name`
  - `description`
  - `startUrls`
  - `maxItems`
  - `allowInactiveMarking`
- `emitDetailCapturedEvents`

Rationale:

- the worker must receive a complete immutable crawl definition
- the worker must not re-read mutable search-space config during execution
- downstream handoff should be controlled by an explicit execution flag, not by leaking the full
  pipeline model into the worker

### Runtime Snapshot

Crawler `runtimeSnapshot` fields:

- `crawlerMaxConcurrency`
- `crawlerMaxRequestsPerMinute`

Not part of v2 runtime input:

- ingestion parser/model settings
- structured output destination details
- worker logging flags and other bootstrap behavior

Deferred to v3:

- proxy configuration reference

### Persistence Targets

Required worker-facing persistence inputs:

- `dbName`

Canonical rule:

- `dbName` is created by the control plane from stable pipeline identity
- the worker must not synthesize fallback database names from env
- collection names are canonical and must not be sent in crawler `StartRun`

### Artifact Sink

Required worker-facing artifact input:

- `artifactSink`

Supported types:

- `gcs`
- `local_filesystem` for explicit dev mode

### Safety Controls

Also accepted:

- `timeouts`

## What The Worker Must Know

The crawler must know:

- stable run identity
- immutable source/search-space snapshot
- crawler concurrency/rate settings
- whether detail-captured events should be emitted
- where artifacts should be written
- where crawler summaries and reconciliation state live

The crawler must not know:

- full pipeline document
- standalone structured output destinations
- ingestion worker internals
- control-plane CRUD semantics
- non-execution audit metadata

## Crawl Phases

Crawler execution has two distinct phases:

1. phase 1: list collection and reconciliation
2. phase 2: detail capture for listings not yet present in `normalized_job_ads`

Phase 1:

- crawls the configured list/search URLs
- builds the current seen listing set
- reconciles that seen set against existing `normalized_job_ads`
- refreshes existing seen records (`lastSeenAt`, `lastSeenRunId`, `isActive=true`)
- marks inactive only those existing active records not present in the current seen set
- determines which listings are new and must enter phase 2

Phase 2:

- captures detail HTML only for listings not yet represented in `normalized_job_ads`
- writes artifacts
- emits `crawler.detail.captured` when enabled
- does not participate in inactive marking decisions

## Reconciliation And Inactive Marking

Inactive marking remains a crawler responsibility in v2.

This is safe only because:

- one pipeline owns one database
- `normalized_job_ads` in that database belongs to that pipeline only
- `source` and `searchSpace` are immutable once the pipeline is created

If those conditions are violated, inactive marking becomes invalid and must not run.

Operational rule:

- inactive marking is governed by phase-1 list integrity, not by phase-2 detail capture or
  ingestion outcome
- inactive marking may execute only when `searchSpaceSnapshot.allowInactiveMarking=true` and the
  phase-1 seen set is trustworthy
- a trustworthy phase-1 seen set requires:
  - list collection completed
  - no failed list requests
  - no list-scope truncation/partial-list guard condition
  - reconciliation itself succeeded
- if phase 1 is incomplete or untrustworthy, inactive marking must be skipped
- phase-2 failure after a successful phase 1 does not invalidate already-applied inactive marking
- ingestion success/failure for newly discovered jobs does not affect inactive marking

Resulting semantics:

- existing jobs are reconciled from list visibility alone
- new jobs become active only after successful ingestion creates the normalized document
- if a run fails during phase 2, reconciled existing jobs remain correct and the next run can
  ingest any still-missing new jobs

## Artifact Rules

Crawler must write the HTML artifact before publishing `crawler.detail.captured`.

Required event publication boundary:

- HTML artifact write succeeded
- listing metadata is available
- artifact reference is durable

Artifact naming/layout rule should remain stable unless a dedicated migration is approved:

- run-scoped artifact grouping
- `job-html-<sourceId>.html` naming for detail pages

## Event Rules

Crawler publishes:

- `crawler.run.started`
- `crawler.detail.captured`
- `crawler.run.finished`

Publication rules:

- `crawler.detail.captured` only when `emitDetailCapturedEvents=true`
- `crawler.detail.captured` only after artifact write success
- `crawler.run.finished` is a minimal projection event, not a telemetry dump
- `crawler.run.finished` payload should contain only:
  - `crawlRunId`
  - `source`
  - `searchSpaceId`
  - `status`
  - `stopReason`
- detailed crawl counters, guard flags, and reconciliation telemetry belong in
  `crawl_run_summaries`, not on the event bus

## Summary Persistence

Crawler persists its telemetry summary to:

- `crawl_run_summaries`

Compatibility rule:

- preserve the existing summary shape as the v2 baseline unless there is an explicit migration

## Failure Handling

### Artifact Write Failure

- do not publish `crawler.detail.captured`
- count the item as failed in crawler telemetry
- continue the run when practical

### Event Publish Failure

- preserve the artifact if already written
- record the publish failure in crawler observability
- finalize the run as `completed_with_errors` if crawl execution otherwise succeeds

### Reconciliation Failure

- fail the run or mark it `completed_with_errors` based on reconciliation severity
- record the failure in `crawl_run_summaries`

## Control-Plane Handshake

Expected orchestration order:

1. control plane sends crawler `StartRun`
2. crawler worker accepts and registers the run
3. control plane receives acceptance
4. control plane allows crawl execution to proceed

The crawler worker is not the orchestrator.

The control plane remains the orchestrator.

## Non-Goals

Not part of this v2 worker spec:

- redesigning crawl strategy
- direct detail-URL crawling modes
- proxy orchestration contracts
- mutable search-space reassignment on an existing pipeline
- moving inactive marking into a separate service
