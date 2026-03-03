# Spec Draft: Control Plane Domain Model and API v1

## Status

- draft
- implementation-facing follow-up to `crawler-ingestion-control-plane-v1.md`

## Purpose

Define the concrete v1 domain objects and operator-facing API for the centralized control plane.

This document is intentionally scoped to the imminent implementation.

## Scope Boundaries

V1 assumptions:

- one source: `jobs.cz`
- one control-plane application: Next.js
- local execution for control plane and workers
- current crawler logic is preserved
- search spaces stay aligned with the current list-page-oriented crawler model
- runs are manual or API-triggered
- raw HTML artifacts are always persisted
- structured output uses one canonical normalized document shape
- MongoDB-backed persistent storage keeps the current per-search-space database topology
- MongoDB-backed persistent storage keeps the current collection names

Deferred from this spec:

- direct detail-URL runs
- mixed list/detail search-space inputs
- scheduled runs
- output-template selection

## Domain Model

### SearchSpace

Represents the canonical crawl definition.

V1 semantics:

- equivalent in intent to the current checked-in search-space JSON files
- list/search-page oriented
- source-specific to `jobs.cz`

Required fields:

- `id`
- `name`
- `description`
- `sourceType`
- `startUrls`
- `maxItemsDefault`
- `allowInactiveMarkingOnPartialRuns`
- `status`
- `version`
- `createdAt`
- `updatedAt`

Field notes:

- `sourceType` is `jobs_cz` in v1
- `startUrls` represent list/search pages in v1
- `maxItemsDefault` is a source-level breadth cap
- concurrency and requests-per-minute belong to `RuntimeProfile`, not `SearchSpace`
- `status` is one of:
  - `draft`
  - `active`
  - `archived`

### RuntimeProfile

Represents reusable worker runtime settings.

Required fields:

- `id`
- `name`
- `crawlerMaxConcurrency`
- `crawlerMaxRequestsPerMinute`
- `ingestionConcurrency`
- `ingestionEnabled`
- `debugLog`
- `status`
- `createdAt`
- `updatedAt`

Field notes:

- `status` is one of:
  - `active`
  - `archived`

### ManagedArtifactStorage

Represents the platform-managed HTML artifact backend.

V1 semantics:

- not an operator-managed CRUD resource
- selected by environment and platform setup
- may use local filesystem in local development
- may use GCS in cloud-backed environments
- always exposed to operators through dashboard browse/download flows

#### HTML artifact layout rule

Managed artifact storage in v1 changes only the storage root or prefix.

It does not change the logical crawler artifact layout.

Required logical layout:

```text
runs/<crawlRunId>/
  dataset.json
  records/
    job-html-<sourceId>.html
```

That means:

- artifacts are grouped per run
- HTML filename remains `job-html-<sourceId>.html`
- the dataset file remains `dataset.json`

Examples:

- local filesystem backend:
  - `<basePath>/runs/<crawlRunId>/records/job-html-<sourceId>.html`
- GCS backend:
  - `gs://<bucket>/<prefix>/runs/<crawlRunId>/records/job-html-<sourceId>.html`

### StructuredOutputDestination

Represents where canonical normalized JSON is written.

Required fields:

- `id`
- `name`
- `type`
- `config`
- `status`
- `createdAt`
- `updatedAt`

Supported `type` values in v1:

- `downloadable_json`
- `mongodb`

`config` examples:

- `downloadable_json`
  - no operator-facing storage config
- `mongodb`
  - `connectionUri`

#### MongoDB compatibility rule

If `type = mongodb`, v1 should preserve the current database layout.

Required behavior:

- one database per search space
- database name derived as `<JOB_COMPASS_DB_PREFIX>-<searchSpaceId>`
- collection names remain unchanged

Required collection names:

- `normalized_job_ads`
- `crawl_run_summaries`
- `ingestion_run_summaries`
- `ingestion_trigger_requests`

Summary compatibility rule:

- `crawl_run_summaries` remains the crawler summary collection
- `ingestion_run_summaries` remains the ingestion summary collection
- the current summary document shape is preserved as the v1 baseline
- any new fields added in v1 should be additive only

The control plane may select whether MongoDB is used.

If MongoDB is used, it should not redesign the schema topology in v1.

#### Downloadable JSON rule

If `type = downloadable_json`, v1 should treat the storage backend as a platform-managed detail.

Required behavior:

- operators do not configure base paths, buckets, or prefixes
- normalized JSON remains browsable and downloadable through the dashboard
- the backend may be local filesystem or GCS depending on environment
- the canonical JSON file naming remains deterministic per run and source item

### Pipeline

Represents an operator-managed runnable configuration.

Required fields:

- `id`
- `name`
- `searchSpaceId`
- `runtimeProfileId`
- `structuredOutputDestinationIds`
- `mode`
- `status`
- `version`
- `createdAt`
- `updatedAt`

`mode` values in v1:

- `crawl_only`
- `crawl_and_ingest`

`status` values:

- `draft`
- `active`
- `archived`

V1 notes:

- `crawl_only` still persists HTML artifacts
- `crawl_and_ingest` persists HTML and publishes events for ingestion
- `structuredOutputDestinationIds` may be empty only when `mode = crawl_only`
- the artifact store is platform-managed and is not selected per pipeline in v1

### RunManifest

Represents the immutable runtime snapshot published to workers.

Required fields:

- `runId`
- `pipelineId`
- `pipelineVersion`
- `searchSpaceSnapshot`
- `runtimeProfileSnapshot`
- `artifactStorageSnapshot`
- `structuredOutputDestinationSnapshots`
- `mode`
- `sourceType`
- `createdAt`
- `createdBy`

Run manifests must be immutable after creation.

#### Apify projection rule

V1 should support generating an Apify-compatible crawler input from the immutable `RunManifest`.

That means:

- `RunManifest` is the canonical control-plane object
- Apify `INPUT.json` is a derived runtime projection
- the generated `INPUT.json` should preserve compatibility with the current crawler's actor-style execution model

The control plane may optionally persist the generated projection for debugging or execution handoff.

### Run

Represents control-plane run lifecycle state.

Required fields:

- `runId`
- `pipelineId`
- `pipelineVersion`
- `status`
- `requestedAt`
- `startedAt`
- `finishedAt`
- `stopReason`
- `summary`

`status` values in v1:

- `queued`
- `running`
- `succeeded`
- `completed_with_errors`
- `failed`
- `stopped`

V1 run history is control-plane history for the local operator.

It is not a user-personal history model and should not depend on user spaces or profiles.

### RunItem

Represents item-level tracking for artifact and ingestion processing.

Required fields:

- `runItemId`
- `runId`
- `source`
- `sourceId`
- `artifactStatus`
- `ingestionStatus`
- `artifactRef`
- `error`
- `createdAt`
- `updatedAt`

`artifactStatus` values:

- `not_started`
- `stored`
- `failed`

`ingestionStatus` values:

- `not_requested`
- `queued`
- `running`
- `succeeded`
- `completed_with_errors`
- `failed`
- `rejected`

## Domain Relationships

- one `SearchSpace` can be used by many `Pipeline` records
- one `RuntimeProfile` can be used by many `Pipeline` records
- one `Pipeline` may reference zero or many `StructuredOutputDestination` records
- one `Pipeline` produces many `Run` records
- one `Run` owns one immutable `RunManifest`
- one `Run` may produce many `RunItem` records

## Validation Rules

### SearchSpace validation

V1 rules:

- `sourceType` must be `jobs_cz`
- `startUrls` must be non-empty
- each `startUrl` must be a valid URL
- search-space IDs must be unique
- `maxItemsDefault` remains on the search space
- concurrency and requests-per-minute remain on the runtime profile

### Pipeline validation

V1 rules:

- `searchSpaceId` must reference an active search space
- `runtimeProfileId` must reference an active runtime profile
- `crawl_only` pipelines must not require structured output destinations
- `crawl_and_ingest` pipelines must reference at least one structured output destination
- only one active run per pipeline is allowed by default
- active means `queued` or `running`
- start requests must be idempotent while an active run already exists

## Operator-Facing API

This section defines the intended v1 API shape.

### Search spaces

#### `POST /api/search-spaces`

Create a search space.

Request body:

```json
{
  "id": "prague-tech-jobs",
  "name": "Prague Tech Jobs",
  "description": "Main Prague tech search space on jobs.cz",
  "sourceType": "jobs_cz",
  "startUrls": ["https://www.jobs.cz/prace/praha/?q=developer"],
  "maxItemsDefault": 100,
  "allowInactiveMarkingOnPartialRuns": false
}
```

#### `GET /api/search-spaces`

List search spaces.

#### `GET /api/search-spaces/:id`

Get one search space.

#### `PATCH /api/search-spaces/:id`

Update a search space and create a new versioned state.

#### `POST /api/search-spaces/:id/validate`

Validate search-space configuration without starting a run.

#### `POST /api/search-spaces/:id/archive`

Archive a search space.

### Runtime profiles

#### `POST /api/runtime-profiles`

Create a runtime profile.

#### `GET /api/runtime-profiles`

List runtime profiles.

#### `GET /api/runtime-profiles/:id`

Get one runtime profile.

#### `PATCH /api/runtime-profiles/:id`

Update a runtime profile.

### Structured output destinations

#### `POST /api/structured-output-destinations`

Create a structured output destination.

#### `GET /api/structured-output-destinations`

List structured output destinations.

#### `GET /api/structured-output-destinations/:id`

Get one structured output destination.

#### `PATCH /api/structured-output-destinations/:id`

Update a structured output destination.

#### `POST /api/structured-output-destinations/:id/validate`

Validate structured output destination connectivity and write capability.

### Pipelines

#### `POST /api/pipelines`

Create a pipeline.

Request body:

```json
{
  "name": "Prague Jobs Crawl And Ingest",
  "searchSpaceId": "prague-tech-jobs",
  "runtimeProfileId": "default-local-runtime",
  "structuredOutputDestinationIds": ["downloadable-json", "mongo-primary"],
  "mode": "crawl_and_ingest"
}
```

#### `GET /api/pipelines`

List pipelines.

#### `GET /api/pipelines/:id`

Get one pipeline.

#### `PATCH /api/pipelines/:id`

Update a pipeline and create a new versioned state.

#### `POST /api/pipelines/:id/validate`

Validate pipeline wiring before activation.

#### `POST /api/pipelines/:id/activate`

Mark a pipeline active and available for runs.

### Runs

#### `POST /api/runs`

Create a run request from a pipeline.

Request body:

```json
{
  "pipelineId": "pipeline_prague_jobs_main"
}
```

Response shape:

```json
{
  "runId": "run_01",
  "pipelineId": "pipeline_prague_jobs_main",
  "status": "queued"
}
```

Run-start rule:

- if the pipeline already has an active run, the control plane must return that existing run or
  reject the request with a clear conflict
- normal repeated clicks must not create duplicate concurrent runs for the same pipeline

#### `POST /api/runs/:id/start`

Create the immutable manifest and publish the run command.

This operation must be idempotent for a given run.

#### `POST /api/runs/:id/stop`

Request that the run stop.

#### `GET /api/runs`

List runs.

#### `GET /api/runs/:id`

Get one run with summary state.

#### `GET /api/runs/:id/items`

List item-level run state.

#### `GET /api/runs/:id/events`

List control-plane-visible events for the run.

## API Design Rules

- all operator writes go through the control plane API
- workers do not own the public product API
- a run is created from an active pipeline
- a run manifest is immutable once published
- responses should expose version and status fields explicitly
- artifact browse/download is the operator-facing access path for raw HTML in v1
- backend storage paths, buckets, and prefixes are internal implementation details in v1

## Versioning Rules

- `SearchSpace` and `Pipeline` are versioned domain objects
- `RunManifest` snapshots exact versions used at run start
- updates do not mutate the meaning of already-started runs

## Recommended Follow-Up Specs

This spec should be paired with:

1. `docs/specs/pipeline-events-sinks-v1.md`
2. crawler worker adaptation spec
3. ingestion worker adaptation spec
