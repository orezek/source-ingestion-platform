# Spec Draft: Crawler + Ingestion Control Plane v2

## Status

- draft
- follow-up scope after v1 implementation, review, and testing
- promoted planning target: v2.0 architecture and platform hardening

## Purpose

Capture the features intentionally deferred from v1 so they stay visible without destabilizing the first implementation.

For v2.0, this document also defines the target production architecture and delivery sequence.

## V2 Themes

- scheduling and recurring automation
- production cloud deployment for workers
- richer orchestration and replay
- broader source support
- more advanced stateful pipeline capabilities
- naming and configuration cleanup
- published machine-readable API contracts
- persistence convergence and explicit domain boundaries
- standalone deployability of control UI, control service, crawler worker, and ingestion worker

## Core Terms

- pipeline = stable definition and production boundary
- run = one execution instance of that pipeline

Examples:

- one pipeline can produce many runs over time
- worker-facing `StartRun` creates one run
- `control_plane_pipelines` stores pipeline definitions
- `control_plane_runs` stores run-state projections for those executions

## V2.0 Target Architecture

### Core Direction

v2.0 should move from local process/file coupling to explicit service contracts:

- `control-center-v2` runs as a standalone Next.js app (for example on Vercel)
- `control-center-v2` is UI-only and submits operator commands to `control-service`
- `control-service` owns synchronous command handling, worker orchestration, runtime event
  ingestion, and read-model maintenance
- crawler and ingestion run as standalone worker services
- services communicate through broker events and durable shared storage contracts
- local filesystem state is dev-only and not production system-of-record

platform decision (canonical for v2.0):

- worker HTTP APIs use Fastify for low-overhead, schema-driven contracts
- production infrastructure runs on Google Cloud Platform (GCP)
- event transport uses GCP Pub/Sub
- artifact/output blob storage uses GCP Cloud Storage buckets
- services run as containerized workloads on GCP runtime services

### Service Boundaries

#### 1. Control Center UI

- scope: operator-facing Next.js app only
- owns pipeline-centric forms, lists, detail pages, and operator workflows
- submits pipeline and run commands to `control-service`
- reads live data from `control-service` only
- does not talk to workers directly
- does not consume Pub/Sub subscriptions
- should be designed mobile-first
- should follow `docs/specs/control-center-v2-screen-map-brief.md` for screen-map and UI behavior
  requirements

#### 2. Control Service

- canonical backend boundary for the control plane
- exposes the API used by `control-center-v2`
- owns pipeline-centric CRUD and run creation/cancel flows
- writes initial run-ledger state (`control_plane_runs`, `control_plane_run_manifests`)
- issues worker `StartRun` commands over REST
- subscribes to Pub/Sub
- validates event contracts
- writes `control_plane_run_event_index`
- reduces runtime events into `control_plane_runs`
- exposes live read APIs backed by MongoDB, including SSE or WebSocket streams
- is a long-lived service and must not depend on Vercel request lifecycles

canonical v2 control-plane rule:

- the pipeline is the primary production boundary
- live execution config is pipeline-owned and immutable after create except for naming, scheduling,
  and operational state
- see `docs/specs/control-plane-v2-pipeline-first.md`

#### 3. Crawler Worker Service

- accepts crawler `StartRun` over REST
- executes crawl workload
- writes crawler artifacts + crawler telemetry
- emits crawler lifecycle and capture events

#### 4. Ingestion Worker Service

- accepts ingestion `StartRun` over REST
- consumes crawler runtime events for handoff/finalization
- executes normalization/output routing workload
- writes ingestion telemetry + production output payloads
- emits ingestion lifecycle events

### Integration Contract

- command path: `control-center-v2` -> `control-service` REST API -> worker REST `StartRun`
- async runtime path: broker topics/queues for lifecycle and handoff events
- live read path: `control-service` -> `control-center-v2` via REST plus SSE or WebSocket
- all services must be able to operate without monorepo-relative filesystem assumptions

current implementation note:

- the existing `ops-control-plane` run detail page still reads event history from archived broker
  event JSON files under `CONTROL_PLANE_BROKER_DIR`
- that file-backed archive is a current implementation detail, not the target v2 control-plane
  event model
- the current transitional `ops-control-plane` wiring can issue standalone worker `StartRun`
  commands over HTTP (`worker_http` mode), but the target v2 model is a dedicated
  `control-service` that owns both worker orchestration and run/event projection

projection architecture note:

- the detailed V2 control-service design is specified in
  `docs/specs/control-service-v2-architecture.md`

## v2.0 Data Domain Model

v2.0 MVP keeps four first-class data domains.

### Domain 1: Operational Telemetry

purpose:

- observability, dashboarding, KPIs, SLOs, anomaly detection

collections:

- `crawl_run_summaries`
- `ingestion_run_summaries`

### Domain 2: Control-Plane Configuration (Desired State)

purpose:

- operator-managed pipeline definitions and execution policies

collections:

- `control_plane_pipelines`

v2 control-plane rule:

- pipeline documents own embedded execution config snapshots
- `source`, `searchSpace`, `runtimeProfile`, and `structuredOutput` are pipeline-owned and immutable
  after create
- standalone editable search-space/runtime-profile/structured-output collections are not the
  authoritative runtime model in v2
- see `docs/specs/control-plane-v2-pipeline-first.md`

### Domain 3: Execution State (Run Ledger)

purpose:

- canonical transaction state for each run execution

collections:

- `control_plane_runs`
- `control_plane_run_manifests`
- `control_plane_run_event_index`

notes:

- these are MongoDB collections in the control-plane database
- `control_plane_runs` stores one projected run-state document per run
- `control_plane_run_event_index` stores indexed event-history documents for runs
- this is distinct from telemetry summaries
- this is distinct from static configuration

### Domain 4: Production Output Data

purpose:

- durable business/result payloads and lineage evidence

storage:

- `normalized_job_ads` (Mongo collection or equivalent canonical store)
- downloadable JSON objects (object storage backend)
- captured HTML artifacts (object storage backend)

Deferred from MVP:

- `control_plane_bootstrap_profiles`
- bootstrap/config-pack workflows

## v2.0 Persistence Rules

1. Configuration and execution metadata must not depend on local JSON files.
2. MongoDB (or selected primary DB) is mandatory in production profiles.
3. Local file persistence is permitted only in explicit dev profile mode.
4. Artifact/output blobs may stay in object storage, but metadata and references belong in DB collections.
5. Every collection used for operator history must have documented retention and index policy.

## v2.0 API Contract Shape

Control-service API should expose:

- service endpoints:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /heartbeat`
- pipeline resources:
  - `POST /v1/pipelines`
  - `GET /v1/pipelines`
  - `GET /v1/pipelines/{pipelineId}`
  - `PATCH /v1/pipelines/{pipelineId}`
- execution resources:
  - `POST /v1/pipelines/{pipelineId}/runs`
  - `POST /v1/runs/{runId}/cancel`
  - `GET /v1/runs`
  - `GET /v1/runs/{runId}`
  - `GET /v1/runs/{runId}/events`

All writes should be control-service-owned and idempotency-aware.

v2 control-plane rule:

- the primary configuration API is pipeline-first
- source/search-space/runtime/output config for live pipelines is created inside pipeline creation,
  not as globally mutable runtime resources
- pipeline-level pause, resume, and delete endpoints are deferred from V2 MVP
- dedicated artifact and output read endpoints are deferred from V2 MVP
- bootstrap/config-pack APIs are deferred from V2 MVP

Control-service API detail note:

- the canonical control-service REST contract lives in
  `docs/specs/control-service-v2-architecture.md`
- V2 MVP payload simplicity rule:
  - `POST /v1/pipelines` carries the full pipeline snapshot
  - `PATCH /v1/pipelines/{pipelineId}` carries `name` only
  - `POST /v1/pipelines/{pipelineId}/runs` uses an empty body
  - `POST /v1/runs/{runId}/cancel` uses an empty body

## v2.0 Worker Bootstrap And Runtime Contracts

### Crawler Service `.env` Bootstrap (Minimal)

- `PORT`
- `SERVICE_NAME=crawler-worker`
- `SERVICE_VERSION`
- `CONTROL_AUTH_MODE=token`
- `CONTROL_SHARED_TOKEN`
- `GCP_PROJECT_ID`
- `PUBSUB_EVENTS_TOPIC` (crawler publish topic)
- `MONGODB_URI`
- `LOG_LEVEL`
- `LOG_PRETTY`
- `MAX_CONCURRENT_RUNS`

Not part of crawler bootstrap env:

- artifact bucket/path settings

reason:

- crawler artifact storage is provided per run via `artifactSink`

### Ingestion Service `.env` Bootstrap (Minimal)

- `PORT`
- `SERVICE_NAME=ingestion-worker`
- `SERVICE_VERSION`
- `CONTROL_AUTH_MODE=token`
- `CONTROL_SHARED_TOKEN`
- `GCP_PROJECT_ID`
- `PUBSUB_EVENTS_TOPIC`
- `OUTPUTS_BUCKET`
- `OUTPUTS_PREFIX` (optional)
- `MONGODB_URI`
- `LOG_LEVEL`
- `LOG_PRETTY`
- `MAX_CONCURRENT_RUNS`

implementation note:

- crawler and ingestion REST APIs should be implemented with Fastify and JSON schema validation
- V2 MVP standardizes deployment auth on one shared bearer token

### Crawler REST Endpoints

- `GET /healthz`
- `GET /readyz`
- `POST /v1/runs` (accepts `StartRun` snapshot)
- `POST /v1/runs/{runId}/cancel`

### Ingestion REST Endpoints

- `GET /healthz`
- `GET /readyz`
- `POST /v1/runs` (accepts event-driven `StartRun` registration snapshot)
- `POST /v1/runs/{runId}/cancel`
- `GET /v1/runs/{runId}/outputs` (metadata/index)

### `POST /v1/runs` (`StartRun`) Required Payload Shape

- `runId`, `idempotencyKey`
- crawler `StartRun` only:
  - `runtimeSnapshot` (`crawlerMaxConcurrency`, `crawlerMaxRequestsPerMinute`)
  - `inputRef`
  - `inputRef.source`
  - `inputRef.searchSpaceId`
  - `inputRef.searchSpaceSnapshot` (`name`, `description`, `startUrls`, `maxItems`,
    `allowInactiveMarking`)
  - `inputRef.emitDetailCapturedEvents`
  - `artifactSink`
  - `persistenceTargets.dbName`
  - optional `timeouts`
- ingestion `StartRun` only:
  - `runtimeSnapshot` (`ingestionConcurrency`)
  - `inputRef`
  - `inputRef.crawlRunId`
  - `inputRef.searchSpaceId`
  - optional `outputSinks` (`[{ "type": "downloadable_json" }]` only)
  - `persistenceTargets.dbName`
  - optional `timeouts`

control-plane note:

- control-plane can keep full `pipelineSnapshot` in its own run ledger for audit/replay
- worker-facing `StartRun` payload is intentionally minimal and must not include unused config blobs
- worker-facing `StartRun` excludes `workerType`, `requestedAt`, and `correlationId`
- see `docs/specs/crawler-worker-v2.md`
- MongoDB writes to canonical collections are implicit worker behavior; `outputSinks` only toggles
  optional downloadable JSON output

execution mode:

- ingestion `StartRun` registers one event-driven ingestion run
- ingestion worker waits for `crawler.detail.captured` events
- run finalization requires `crawler.run.finished` plus drained queue/active items
- without `crawler.run.finished`, run remains `running`

concurrency semantics (current runtime behavior):

- worker can accept multiple `StartRun` requests and keep multiple runs in `running` state
- scheduling is controlled by one global worker pool via `MAX_CONCURRENT_RUNS`
- `runtimeSnapshot.ingestionConcurrency` is currently telemetry/projection metadata, not a scheduling
  throttle
- item execution order is from a shared queue across runs; there is no per-run isolated worker pool

event correlation constraint:

- each active ingestion run must have a unique `inputRef.crawlRunId`
- if multiple running runs match the same crawler event by `crawlRunId`, ingestion worker skips that
  event as ambiguous
- control plane/orchestrator must generate unique crawl run identifiers per run start

security constraint:

- `StartRun` must not include database credentials or secret material
- workers receive credentials from bootstrap env/secrets only
- control plane sends only logical routing targets required for execution, not secrets

database routing constraint (canonical for v2):

- `persistenceTargets.dbName` is required in worker-facing `StartRun`
- control plane/orchestrator owns db name creation and mapping
- mapping rule: one logical database per pipeline
- db identity must be based on stable pipeline id (not mutable pipeline display name)
- db name generation must be deterministic and length-bounded (current safety target: max 38 chars)
- workers must treat `dbName` as an input contract and must not synthesize fallback DB names from env
- worker bootstrap env keeps only `MONGODB_URI` for credentials/connectivity
- canonical collection names are fixed by the platform and must not be sent in worker-facing
  `StartRun`
- pipeline execution identity must remain stable:
  - `source` is immutable after pipeline creation
  - `searchSpace` is immutable after pipeline creation
  - if source/search scope changes, a new pipeline must be created

### Data Flow (Execution Runtime)

- Pub/Sub: event stream (`crawler.run.started`, `crawler.detail.captured`,
  `ingestion.item.succeeded`, etc.)
- Buckets: HTML dumps + downloadable JSON payloads
- MongoDB: control config + execution ledger + telemetry projections (source of truth), not
  Pub/Sub alone

Pub/Sub topology for V2 MVP:

- one shared runtime topic:
  - `PUBSUB_EVENTS_TOPIC`
- two publishers:
  - `crawler-worker-v2`
  - `ingestion-worker-v2`
- two subscribers:
  - `ingestion-worker-v2`
  - `control-service`

Role rule:

- crawler publishes only and does not subscribe
- ingestion subscribes for crawler handoff/finalization and publishes ingestion runtime events
- `control-service` subscribes to the full runtime stream for projections

gcp mapping (canonical):

- Pub/Sub = Google Cloud Pub/Sub topics/subscriptions
- Buckets = Google Cloud Storage buckets for artifacts/outputs
- Service runtime = GCP-managed container runtime
- MongoDB can be hosted on Atlas or self-managed on GCP, but remains the persistence layer

## v2.0 Event Contract Shape

Canonical contract source:

- V2 runtime broker event schemas live in `packages/control-plane-contracts/src/v2.ts`
- `packages/control-plane-contracts/src/index.ts` remains legacy/v1 compatibility surface only

minimum event families:

- `crawler.run.started`
- `crawler.detail.captured`
- `crawler.run.finished`
- `ingestion.run.started`
- `ingestion.item.started`
- `ingestion.item.succeeded`
- `ingestion.item.failed`
- `ingestion.item.rejected`
- `ingestion.run.finished`

Each event should include:

- `eventId`
- `eventType`
- `occurredAt`
- `runId`
- `correlationId`
- `producer`
- payload with versioned schema

control-service subscriber note:

- `control-service` consumes the full `runtimeBrokerEventV2Schema` union from
  `packages/control-plane-contracts/src/v2.ts`
- the detailed control-service Pub/Sub consumer contract lives in
  `docs/specs/control-service-v2-architecture.md`

`crawler.run.finished` v2 payload should stay minimal:

- `crawlRunId`
- `source`
- `searchSpaceId`
- `status`
- `stopReason`

Detailed crawler counters and reconciliation telemetry must be read from `crawl_run_summaries`,
not duplicated into the runtime event payload.

`crawler.detail.captured` remains the rich handoff event and should contain:

- `crawlRunId`
- `searchSpaceId`
- `source`
- `sourceId`
- `dedupeKey`
- `listingRecord`
- `artifact`

Ingestion item lifecycle events should stay lean:

- `ingestion.item.started`
  - `crawlRunId`, `source`, `sourceId`, `dedupeKey`
- `ingestion.item.succeeded`
  - `crawlRunId`, `source`, `sourceId`, `dedupeKey`, `documentId`
- `ingestion.item.failed`
  - `crawlRunId`, `source`, `sourceId`, `dedupeKey`, `error`
- `ingestion.item.rejected`
  - `crawlRunId`, `source`, `sourceId`, `dedupeKey`, `reason`

Do not put sink routing or large telemetry blobs into ingestion item events. Those belong in worker
summaries, output derivation from the manifest, or storage adapters.

## v2.0 Detailed Event And Persistence Map

This section maps current v1 event types to the v2.0 target routing model.

Design rule:

- Pub/Sub is transport for cross-service workflow.
- MongoDB is persistent read-model/projection state.
- Buckets are for large blobs (HTML artifacts and downloadable JSON outputs), not control metadata.
- workers write operational telemetry and production outputs directly to MongoDB collections using
  `StartRun` persistence targets.
- worker command ingress is REST; broker events are runtime signals, not the canonical v2 command
  path

### Current Event Types (as implemented today)

- `crawler.detail.captured`
- `crawler.run.finished`
- `ingestion.item.started`
- `ingestion.item.succeeded`
- `ingestion.item.failed`
- `ingestion.item.rejected`

### Event Routing Matrix

| Event Type                 | Produced By      | Publish To                 | Primary Consumers                      | Persistent Projections (Mongo)                                                                  | Blob/Bucket Side Effects                                              |
| -------------------------- | ---------------- | -------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `crawler.detail.captured`  | Crawler worker   | Pub/Sub `run-events` topic | Ingestion worker, Control service      | `control_plane_run_event_index`, `control_plane_runs` artifact counters                         | Crawler already wrote HTML dump + dataset metadata to artifact bucket |
| `crawler.run.finished`     | Crawler worker   | Pub/Sub `run-events` topic | Control service, Ingestion worker gate | `crawl_run_summaries`, `control_plane_runs`, `control_plane_run_event_index`                    | None (summary references bucket/object paths as metadata)             |
| `ingestion.item.started`   | Ingestion worker | Pub/Sub `run-events` topic | Control service                        | `control_plane_run_event_index`, optional in-flight counters projection on `control_plane_runs` | None                                                                  |
| `ingestion.item.succeeded` | Ingestion worker | Pub/Sub `run-events` topic | Control service                        | `ingestion_run_summaries`, `control_plane_run_event_index`, `control_plane_runs`                | Ingestion writes normalized JSON object to output bucket (if enabled) |
| `ingestion.item.failed`    | Ingestion worker | Pub/Sub `run-events` topic | Control service                        | `ingestion_run_summaries`, `control_plane_run_event_index`, `control_plane_runs`                | None direct; failure metadata persisted                               |
| `ingestion.item.rejected`  | Ingestion worker | Pub/Sub `run-events` topic | Control service                        | `ingestion_run_summaries`, `control_plane_run_event_index`, `control_plane_runs`                | None direct; rejection metadata persisted                             |

### Crawler-To-Ingestion Handoff

For v2.0, ingestion should subscribe to run events and process:

- required trigger: `crawler.detail.captured`
- completion gate signal: `crawler.run.finished`

Behavior:

- each `crawler.detail.captured` event becomes one ingestion item command unit
- ingestion idempotency key is `dedupeKey`
- ingestion finalization for a run waits for:
  - crawler finished signal received
  - in-flight captured-item queue drained

### Persistence Responsibilities By Service

#### Control Service

- owns `control_plane_pipelines`, `control_plane_runs`, `control_plane_run_manifests`, and
  run-state transitions
- owns control-plane configuration and execution collections only
- owns authoritative event-index write policy (`control_plane_run_event_index`)
- exposes the read APIs consumed by the UI
- target v2 read path:
  - the UI reads run/event data through `control-service`
  - `control-service` reads MongoDB projections
  - filesystem broker archives are optional diagnostics only, not the primary operator read model
- must not write pipeline-local telemetry or business-data collections:
  - `crawl_run_summaries`
  - `ingestion_run_summaries`
  - `normalized_job_ads`

#### Crawler Worker

- emits crawler lifecycle/capture events
- writes artifact blobs and dataset metadata
- writes crawler telemetry summary to `crawl_run_summaries`
- reconciles inactive jobs against the pipeline-owned `normalized_job_ads` collection when enabled
- must not mutate control-plane configuration collections
- must rely on pipeline-stable database boundaries for reconciliation correctness

crawler execution semantics:

- phase 1 collects list visibility and reconciles existing `normalized_job_ads`
- phase 1 may refresh seen existing records and mark unseen existing records inactive
- phase 2 captures detail HTML only for listings not yet present in `normalized_job_ads`
- phase-2 capture or ingestion failure does not invalidate inactive marking already decided from a
  trustworthy phase 1
- inactive marking must be skipped when the phase-1 seen set is incomplete or untrustworthy

#### Ingestion Worker

- emits ingestion item lifecycle events
- writes production output payloads (`normalized_job_ads`, downloadable JSON blobs)
- writes ingestion telemetry to:
  - `ingestion_run_summaries`
  - `normalized_job_ads`

### Canonical Naming Contract (v2.0)

Collection and database naming remains unchanged in v2.0 routing:

- database naming contract stays as currently defined
- collection names stay:
  - `crawl_run_summaries`
  - `ingestion_run_summaries`
  - `normalized_job_ads`

## v2.0 Deployment Topology

recommended production topology:

- Control UI: Vercel (or equivalent web runtime)
- Control service: GCP Cloud Run
- Crawler worker service: GCP Cloud Run (job or service shape)
- Ingestion worker service: GCP Cloud Run (event/service shape)
- Broker: GCP Pub/Sub
- DB: managed MongoDB (initially)
- Object storage: GCP Cloud Storage buckets

non-goal for v2.0 production:

- direct process spawning of worker apps from UI runtime
- monorepo-relative runtime directory coupling

## v2.0 Migration Plan

### Phase A: Contract and Repository Refactor

- introduce persistence abstraction for configuration and execution state
- implement Mongo-backed repositories for Domains 2/3/4
- keep file-backed repository only as dev adapter

### Phase B: Control-Service Introduction

- keep `control-center-v2` UI-only
- separate UI handlers from orchestration logic
- expose explicit REST/OpenAPI endpoints
- move run-start, pipeline writes, and lifecycle mutations behind the `control-service` boundary

### Phase C: Worker Decoupling

- add remote execution adapter using broker contracts
- disable local spawn in production profiles
- ensure workers resolve manifests/artifact metadata from shared stores

### Phase D: Hardening

- add retention/index policies
- add replay, repair, and audit queries
- enforce bootstrap profile workflows (import/export/apply)
- add live read APIs for the UI, preferably SSE first

## v2.0 Definition of Done

- UI can run independently of worker code directories
- control-plane config and run ledger no longer rely on local file storage
- crawler/ingestion workers operate as standalone services via broker + shared persistence
- OpenAPI contract published and validated in CI
- documented bootstrap profile workflow available for environment bring-up
- production deployment can run with `control-center-v2` on Vercel plus `control-service` and
  worker services
- pipeline-first controller model documented and adopted as the canonical v2 write model
- crawler worker contract updated to assume immutable pipeline identity and one-db-per-pipeline

## Deferred Features

### 1. Scheduled Runs

V2 should add:

- cron-based run scheduling
- recurring pipeline execution
- schedule pause and resume
- misfire handling
- per-schedule audit trail

This is deferred from v1 because:

- v1 already has enough scope in the control plane, workers, broker, artifact storage, and output routing
- manual and API-triggered runs are enough for initial validation

### 2. Production Worker Deployment

V2 should define the production deployment target for workers.

Current preferred direction:

- `control-center-v2` on Vercel backed by `control-service`
- crawler and ingestion workers on Google Cloud managed container runtime

Cloud Run is a strong candidate for workers.

Areas to finalize in v2:

- whether crawler runs best as a service, a job, or a hybrid model
- whether ingestion runs best as an event-driven service, a job, or separate item/batch forms
- worker scaling and concurrency policy
- VPC, secrets, and service-account model

Current working recommendation:

- crawler is more naturally modeled as a job-style runtime
- ingestion may need two runtime shapes:
  - event-driven item ingestion
  - batch reingestion job execution

### 3. Richer Orchestration

V2 may add an orchestration layer on top of direct worker subscriptions.

Potential additions:

- orchestrator topic or workflow layer
- pipeline branching
- richer dependency management
- explicit replay orchestration
- operator-driven requeue policies

V2 MVP should avoid this complexity and keep one `control-service` plus direct worker event
subscriptions.

### 4. Advanced Replay And Recovery

V2 should add:

- replay from run manifest
- replay from artifact store
- selective item reprocessing
- sink repair workflows
- batch rebuild of normalized outputs

### 5. Multi-Source Expansion

V2 should add real support for additional websites through the source-adapter contract introduced in v1.

Potential additions:

- adapter registry
- per-source UI forms
- source-specific validation and preview
- source-specific anti-blocking runtime policies

### 6. Extended Crawl Input Modes

V2 should add:

- direct detail-URL runs
- mixed list/detail input support where useful
- explicit URL classification in the operator model
- clearly specified list-page behavior when Mongo-backed reconciliation is not used

V1 should keep the crawler aligned with the current list-page-driven implementation.

### 7. Extended Output Templates

V2 may add:

- operator-selectable predefined output shapes
- schema-versioned output templates owned by the platform
- template editor for internal admins
- template compatibility matrix per sink
- per-template validation preview
- user-selectable download packaging

V1 should keep one canonical normalized document shape with no template selection.

### 8. Additional Persistent State Models

V2 may explore alternatives or additions to MongoDB-backed normalized state for reconciliation and cross-run intelligence.

Examples:

- state store abstraction beyond MongoDB
- search-space run baselines
- crawl history indexes for non-ingesting pipelines

V1 should keep reconciliation tied to persistent normalized state availability.

### 9. Result Reuse And Token Optimization

V2 or later should add a mechanism to reuse previously successful processing results.

The goal is:

- if the same job ad or effectively identical artifact appears again
- the platform can reuse the prior successful normalized result
- unnecessary LLM calls and token spend are avoided

Potential building blocks:

- HTML checksum-based lookup
- canonical artifact fingerprinting
- normalized-result cache keyed by source and artifact fingerprint
- explicit cache hit and cache miss observability

This is intentionally deferred until the v1 pipeline contracts are stable.

### 10. Artifact And Output Access APIs

V2 may add public API access for artifact and output downloads.

Examples:

- authenticated artifact download endpoints
- run-scoped output download endpoints
- bulk run export packaging

V1 should prioritize dashboard-first browsing and download, with raw storage paths treated as an
implementation detail.

### 11. OpenAPI And Swagger

V2 should publish the control-plane API in a machine-readable and developer-friendly form.

Recommended scope:

- formal OpenAPI contract
- Swagger UI or equivalent API explorer
- typed client generation where useful
- improved developer and operator testing flows

Recommended sequencing:

- v1 keeps the API contract clean and implementation-ready
- v2 publishes the OpenAPI contract and Swagger UI

Reasoning:

- agent and MCP use later will benefit from a stable machine-readable API
- the contract should exist before the agent-facing layer is introduced
- Swagger is useful earlier than the full agent platform roadmap

### 12. Naming And Configuration Cleanup

V2 should clean up legacy naming that no longer matches the product boundary.

Priority cleanup items:

- replace `JOB_COMPASS_DB_PREFIX` with a crawler/ingestion-neutral setting name
- define a short canonical default database prefix owned by the platform
- remove legacy `job-compass` terminology from operational env defaults where the app is no longer
  actually "Job Compass"
- separate product naming from storage naming so database prefixes do not inherit stale branding
- document and enforce one migration path for old env vars, including deprecation behavior and
  removal timing

Specific V2 requirement:

- `JOB_COMPASS_DB_PREFIX` should be treated as compatibility debt, not as the long-term contract

Reasoning:

- the current env var name leaks old product language into crawler and ingestion runtime behavior
- operational naming is part of the external contract for MongoDB persistence and should be cleaned
  up deliberately, not piecemeal
- future storage migrations will be harder if naming debt stays embedded in env vars, docs, and
  defaults

### 13. Persistence Convergence Backlog

V2 should remove split-brain persistence where some run/control-plane state is local filesystem and
some is in MongoDB collections.

Backlog items:

- `CP-PERSIST-001` Control-plane state persistence in managed storage
- `CP-PERSIST-002` Unified run history persistence source of truth

#### CP-PERSIST-001 Control-plane state persistence in managed storage

Problem:

- control-plane resources (pipelines, runtime profiles, search spaces, run records, manifests) are
  currently persisted in local files under `storage/control-plane/**`
- this is not suitable for production durability, multi-instance deployment, or operator audit

Scope:

- move control-plane domain records to managed persistence (MongoDB collections or equivalent
  managed database)
- define collections for:
  - `control_plane_search_spaces`
  - `control_plane_runtime_profiles`
  - `control_plane_structured_output_destinations`
  - `control_plane_pipelines`
  - `control_plane_runs`
  - `control_plane_run_manifests`
- keep filesystem only for large blobs/logs/artifacts when appropriate; metadata must be in DB

Acceptance criteria:

- control-plane CRUD and run lifecycle no longer require local JSON files as the primary store
- all control-plane list/detail pages read from the managed store
- deletion/update constraints currently enforced in service logic remain intact
- a migration path exists for existing local state into DB collections
- docs and env configuration clearly describe the storage contract

#### CP-PERSIST-002 Unified run history persistence source of truth

Problem:

- run history is currently split:
  - dashboard summaries come from Mongo collections (`crawl_run_summaries`,
    `ingestion_run_summaries`) or fixtures
  - control-plane run records/history come from local `storage/control-plane/runs/**`
- this creates inconsistency and makes traceability harder

Scope:

- define one canonical run-history model and serving path for operator history
- ensure dashboard and control-plane history views are backed by persistent collections with clear
  ownership boundaries
- support consistent joins between:
  - run metadata
  - broker event history metadata
  - artifact/output references

Acceptance criteria:

- dashboard and control-plane history cannot drift due to split persistence backends
- run detail pages load history from persistent collections without requiring local-only run files
- local fixture mode remains only for tests/dev simulation, not production history source
- explicit retention policy and indexing plan is documented for run-history collections

## Later-Phase Roadmap Beyond V2

These ideas are important but should not shape the immediate v1 or early v2 implementation too aggressively.

### V3 Candidate: Execution Sessions And Shared Worker Pools

V3 should add an execution model based on run execution sessions rather than browser or user
sessions.

Recommended direction:

- a run creates a `RunExecutionSession`
- shared worker pools are the default execution model
- queue-based scaling is preferred over provisioning dedicated workers for every run
- dedicated per-run workers remain an exception for selected workloads

Potential scope:

- execution sessions
- worker leases and heartbeats
- run concurrency budgets
- cancellation and expiry
- shared-pool quotas
- autoscaling policies

The guiding rule is:

- execution is run-based, not user-session-based

### V3 Candidate: Provider/Model-Independent Ingestion

V3 should decouple ingestion parsing from any single model provider and model name.

Recommended direction:

- keep worker bootstrap minimal and provider-neutral
- introduce a parser provider interface (adapter contract) in ingestion worker runtime
- move provider/model selection to control-plane managed runtime config (passed via `StartRun`)
- allow multiple providers behind one contract (for example Gemini, OpenAI-compatible, local models)
- make model routing explicit per pipeline/runtime profile without changing worker code

Contract implications:

- keep `StartRun` stable while adding a provider-agnostic parser config section
- avoid provider-specific env variables as worker hard requirements in the long-term contract
- keep secrets in runtime secret stores; pass only logical provider/model identifiers in `StartRun`

Transition rule:

- v2 can continue with current Gemini-first implementation
- v3 introduces adapter-based provider independence without changing persistence schemas

### V3-V4 Candidate: Deeper Persistence Decoupling

Later versions may decouple ingestion from direct ownership of persistent writes even further.

Possible direction:

- ingestion focuses on canonical normalization only
- a downstream writer or delivery stage owns sink writes
- sink routing becomes a dedicated pipeline stage

Potential motivations:

- stronger separation of concerns
- easier fan-out to many sinks
- independent retry behavior for normalization vs sink delivery
- better support for more complex output routing

V1 should not do this.

V1 should keep sink writes inside the ingestion worker.

### V5 Candidate: User Spaces And Profiles

V5 should introduce a real multi-user operating model.

Potential scope:

- users
- spaces or workspaces
- memberships and ownership
- profile settings
- pipeline ownership boundaries
- run visibility boundaries by space

This should come only after the platform model is stable enough to justify tenancy and ownership rules.

### V6 Candidate: Agent-First Platform Usage

V6 should make the platform a first-class system for API and agent usage.

Potential scope:

- MCP server
- API keys for programmatic access
- key scopes and permissions
- agent-oriented automation flows
- stronger machine-consumable contracts

### V6 Candidate: Unified Usage Attribution And Tracing

V6 should add a usage model that can trace both GUI and API activity.

This should be principal-based, not API-key-only.

That means:

- GUI activity is attributed to a user or session principal
- API activity is attributed to an API key and its owning principal
- later agent activity is attributed to an agent principal or delegated credential

Potential scope:

- API keys
- usage attribution
- audit logs
- quotas and rate limits
- per-principal usage views
- per-key usage views
- cross-channel tracing for GUI, API, and agents

## V1 To V2 Handoff Questions

These questions should be revisited only after v1 is working in practice:

- Is direct worker subscription still sufficient?
- Do operators need scheduling urgently enough to justify a scheduler service?
- Is Cloud Run the right production runtime for both workers?
- Do we need separate runtime shapes for long list crawls versus event-driven ingestion?
- Are the predefined output templates sufficient?
- Do we need richer replay and repair tooling?
