# Spec Draft: Control Service v2 Architecture

## Status

- draft
- recommended V2 MVP backend architecture
- intended companion to:
  - `docs/specs/control-plane-v2-pipeline-first.md`
  - `docs/specs/crawler-ingestion-control-plane-v2.md`

## Purpose

Define how `control-center-v2` talks to one backend service that owns command orchestration, runtime
event ingestion, MongoDB projections, and live read APIs.

This document exists to make one V2 runtime boundary explicit:

- the UI sends commands to `control-service`
- the UI reads live data from `control-service`
- workers emit Pub/Sub runtime events
- `control-service` persists and projects those events into MongoDB
- the UI never reads Pub/Sub, worker APIs, or pipeline-owned databases directly

## Problem To Solve

V2 moves crawler and ingestion into standalone services. That creates two runtime problems:

1. `control-center-v2` is expected to run as a stateless web app, for example on Vercel.
2. each pipeline owns its own production database.

Known constraints:

- Pub/Sub subscriptions require a long-lived consumer and are not a good fit for Vercel request
  handlers
- pipeline-owned telemetry lives in many pipeline databases
- pipeline-local collections like `crawl_run_summaries` and `ingestion_run_summaries` are useful
  deep telemetry, but they are not a good primary source for one cross-pipeline operator UI
- the operator experience still needs one logical surface for:
  - pipeline management
  - run start/stop/cancel
  - run status and history
  - artifact and output browsing

Without one backend control boundary, the UI would be forced to:

- talk to workers directly
- read Pub/Sub directly
- read many pipeline databases directly
- or rebuild filesystem/archive coupling

That is the wrong direction for V2.

## Core Decision

V2 should use one dedicated backend control service.

Canonical rule:

- `control-center-v2` is the operator UI only
- `control-service` owns commands, orchestration, projection, and live read APIs
- workers stay dumb and only execute work plus emit events
- the UI reads control-plane MongoDB projections through `control-service` only

This keeps the UI simple while preserving the event-driven worker model.

## Design Principles

1. The UI talks only to `control-service`.
2. The UI never talks directly to workers, Pub/Sub, or pipeline-owned databases.
3. Workers never write cross-pipeline control-plane read models directly.
4. Control-plane read models live in one control-plane database.
5. Projection writes must be idempotent.
6. Pipeline-owned telemetry stays in pipeline-owned databases.
7. Artifact and output browsing should be derived from events plus deterministic storage rules
   unless a dedicated index is proven necessary later.
8. Keep the MVP model small and add fields only when a real UI needs them.

## Service Ownership

### `control-center-v2`

Responsibilities:

- operator-facing UI
- pipeline create and rename flows
- run start/cancel interactions
- rendering dashboards, lists, detail pages, and live run views
- mobile-first responsive operator experience
- trusted server-side session/auth boundary for calls into `control-service`

Not responsible for:

- direct worker orchestration
- consuming Pub/Sub subscriptions
- writing MongoDB projections directly
- reading worker APIs or pipeline databases directly
- holding the shared backend bearer token in the browser

Design brief note:

- the canonical screen-map brief lives in `docs/specs/control-center-v2-screen-map-brief.md`

### `control-service`

Responsibilities:

- expose the API used by `control-center-v2`
- own pipeline-centric CRUD and run command handling
- write initial run-ledger state:
  - `control_plane_runs`
  - `control_plane_run_manifests`
- send worker `StartRun` and stop/cancel commands
- subscribe to the runtime Pub/Sub topic
- validate runtime events against `@repo/control-plane-contracts`
- persist event history into `control_plane_run_event_index`
- reduce runtime events into `control_plane_runs`
- expose read APIs backed by control-plane MongoDB
- expose live update streams to the UI via SSE or WebSocket
- own writes to control-plane collections only

Not responsible for:

- doing crawl work
- doing ingestion work
- storing large blob payloads directly in MongoDB
- writing pipeline-owned telemetry or business-data collections

### `crawler-worker-v2`

Responsibilities:

- accept `POST /v1/runs`
- execute crawl workload
- write crawler artifacts and crawler telemetry to the pipeline-owned database/storage
- emit runtime events

### `ingestion-worker-v2`

Responsibilities:

- accept `POST /v1/runs`
- consume crawler runtime events needed for handoff/finalization
- execute normalization/output routing workload
- write ingestion telemetry and production output payloads to the pipeline-owned database/storage
- emit runtime events

## Recommended V2 MVP Deployment

- `control-center-v2`: Vercel or another stateless web runtime
- `control-service`: Cloud Run or another long-lived container runtime
- crawler worker: Cloud Run or another container runtime
- ingestion worker: Cloud Run or another container runtime
- MongoDB Atlas: authoritative DB for control-plane state and pipeline-owned data
- GCP Pub/Sub: runtime event transport
- GCP Cloud Storage: artifact and downloadable output blob storage

## Pub/Sub Topology

V2 MVP keeps Pub/Sub intentionally simple.

- one shared runtime topic:
  - `PUBSUB_EVENTS_TOPIC`
- two publishers:
  - `crawler-worker-v2`
  - `ingestion-worker-v2`
- two subscribers:
  - `ingestion-worker-v2`
  - `control-service`

Canonical runtime roles:

- `crawler-worker-v2` publishes runtime facts only and does not subscribe
- `ingestion-worker-v2` subscribes to crawler runtime events needed for handoff/finalization and
  publishes ingestion runtime events
- `control-service` subscribes to the full runtime event stream and projects it into
  `control_plane_run_event_index` and `control_plane_runs`

Reason:

- one topic is enough for the current runtime event family
- the event volume and ownership model do not yet justify splitting topics
- topic splitting should be deferred until a real need appears, such as throughput, security, or
  retention pressure

## `control-service` Pub/Sub Contract

`control-service` is a subscriber only in V2 MVP. It does not need to publish Pub/Sub messages.

### Contract Source

- the canonical runtime event contract lives in `packages/control-plane-contracts/src/v2.ts`
- `control-service` must validate every broker message with `runtimeBrokerEventV2Schema`
- `control-service` must not define a forked event schema or tolerate undocumented event shapes
- any new runtime event type must be added to `@repo/control-plane-contracts` before
  `control-service` consumes it

### Subscription Ownership

- `control-service` owns one dedicated subscription on `PUBSUB_EVENTS_TOPIC`
- the subscription must not be shared with `ingestion-worker-v2`
- one logical deployment environment should have one logical control-service subscription
- if `control-service` is scaled horizontally, replicas may share that subscription for
  load-balanced consumption

Pub/Sub env subset:

- `GCP_PROJECT_ID`
- `PUBSUB_EVENTS_TOPIC`
- `PUBSUB_EVENTS_SUBSCRIPTION`
- `PUBSUB_AUTO_CREATE_SUBSCRIPTION`
- `ENABLE_PUBSUB_CONSUMER`

The full `control-service` env contract is defined below in `Operational Contract`.

Recommended default subscription naming rule:

- `${SERVICE_NAME}-events-subscription`

### Delivery Semantics

- Pub/Sub delivery is at-least-once
- `eventId` is the idempotency key for projection writes
- `control_plane_run_event_index` must enforce a unique index on `eventId`
- duplicate delivery must be treated as a no-op, not as a new event

### Consumed Event Types

For V2 MVP, `control-service` consumes the full runtime event stream:

- `crawler.run.started`
- `crawler.detail.captured`
- `crawler.run.finished`
- `ingestion.run.started`
- `ingestion.item.started`
- `ingestion.item.succeeded`
- `ingestion.item.failed`
- `ingestion.item.rejected`
- `ingestion.run.finished`

### Envelope Requirements

Every valid Pub/Sub message consumed by `control-service` must contain:

- `eventId`
- `eventType`
- `eventVersion`
- `occurredAt`
- `runId`
- `correlationId`
- `producer`
- `payload`

The payload shape is selected by the discriminated `eventType` union in
`runtimeBrokerEventV2Schema`.

### Processing Rules

Recommended handling for each Pub/Sub message:

1. receive the message from the control-service subscription
2. parse the message body as UTF-8 JSON
3. validate the parsed payload with `runtimeBrokerEventV2Schema`
4. begin a MongoDB transaction
5. check whether `eventId` already exists in `control_plane_run_event_index`
6. if it already exists:
   - commit no-op
   - ack message
7. if it does not exist:
   - insert the indexed event document
   - load the `control_plane_runs` document for `runId`
   - if the run exists, apply the reducer and upsert the run projection
   - if the run does not exist, keep the event with `projectionStatus = orphaned`
   - commit
8. ack only after the transaction commits successfully

### Failure Handling

- malformed JSON or contract-invalid messages are poison messages:
  - log them with enough metadata to trace the producer
  - increment error metrics / alerts
  - ack them so they do not create infinite redelivery loops
- duplicate `eventId` deliveries are expected under at-least-once delivery:
  - treat them as no-op
  - ack them
- unknown-run events are anomalous but valid:
  - persist them in `control_plane_run_event_index`
  - set `projectionStatus = orphaned`
  - do not synthesize a `control_plane_runs` document
  - ack them
- transient infrastructure failures are retryable:
  - examples: MongoDB transaction failure, connection loss, temporary Pub/Sub client errors
  - nack the message so Pub/Sub can redeliver it

### Consumer Health Surface

`control-service` readiness and heartbeat endpoints should expose subscriber state.

Minimum expectations:

- `GET /readyz`
  - returns not ready when MongoDB is unavailable
  - returns not ready when the Pub/Sub consumer is enabled but not initialized
- `GET /heartbeat`
  - returns `subscriptionEnabled`
  - returns `consumerReady`
  - returns `subscriptionName`
  - returns `lastMessageReceivedAt`
  - returns `lastMessageAppliedAt`
  - returns `lastErrorAt`

### Minimal `control-service` Pub/Sub Consumer Config

For V2 MVP, `control-service` should parse one minimal Pub/Sub consumer config object.

Required fields:

- `gcpProjectId`
- `eventsTopic`
- `eventsSubscription`
- `autoCreateSubscription`
- `consumerEnabled`

This config should be mapped from service env at bootstrap time.
It should not become a larger shared infra abstraction until duplication across services is real.

## `control-service` REST Contract

V2 should make `control-service` the only HTTP API used by `control-center-v2`.

### REST Design Rules

- all control-service routes should be versioned under `/v1`
- request and response bodies should be JSON
- `control-center-v2` should never call worker REST APIs directly
- `control-service` owns all command writes into control-plane MongoDB
- all run and pipeline reads should come from control-plane MongoDB read models
- live updates are a separate SSE contract and are not part of the REST surface below

### Service Endpoints

- `GET /healthz`
  - liveness only
  - returns process metadata such as `serviceName` and `serviceVersion`
- `GET /readyz`
  - readiness for load balancers and container runtime probes
  - must fail if MongoDB is unavailable
  - must fail if the Pub/Sub consumer is enabled but not initialized
- `GET /heartbeat`
  - lightweight UI-facing runtime status
  - should expose subscriber and Mongo readiness fields

### Pipeline Endpoints

- `POST /v1/pipelines`
  - creates one pipeline aggregate in `control_plane_pipelines`
  - request body must contain the full pipeline-owned execution snapshot:
    - `name`
    - `source`
    - `mode`
    - `searchSpace`
    - `runtimeProfile`
    - `structuredOutput`
  - request body must not contain control-plane managed fields such as:
    - `pipelineId`
    - `dbName`
    - `version`
    - `status`
    - `createdAt`
    - `updatedAt`
  - response should return the persisted pipeline aggregate
- `GET /v1/pipelines`
  - lists pipeline summaries for the operator UI
  - reads from `control_plane_pipelines`
- `GET /v1/pipelines/{pipelineId}`
  - returns one pipeline aggregate
  - reads from `control_plane_pipelines`
- `PATCH /v1/pipelines/{pipelineId}`
  - request body should contain `name` only
  - must reject attempts to mutate `source`, `searchSpace`, `runtimeProfile`,
    `structuredOutput`, `dbName`, or `schedule`
  - response should return the updated pipeline aggregate

Deferred from V2 MVP:

- pipeline-level pause and resume endpoints
- pipeline deletion semantics are deferred from V2 MVP
- V2 MVP should not expose:
  - `POST /v1/pipelines/{pipelineId}/pause`
  - `POST /v1/pipelines/{pipelineId}/resume`
  - `DELETE /v1/pipelines/{pipelineId}`
- if deletion is added later, it should be defined explicitly as a non-destructive control-plane
  state transition rather than assumed filesystem or database removal

### Run Command Endpoints

- `POST /v1/pipelines/{pipelineId}/runs`
  - starts one new run for the pipeline
  - request body should be empty in V2 MVP
  - V2 MVP should not accept per-run overrides for:
    - `searchSpace`
    - `runtimeProfile`
    - `structuredOutput`
    - `artifactSink`
    - `outputSinks`
    - worker concurrency
    - pipeline database routing
  - `control-service` must:
    - resolve the pipeline aggregate into immutable worker command snapshots
    - write `control_plane_runs`
    - write `control_plane_run_manifests`
    - if pipeline mode is `crawl_and_ingest`:
      - dispatch ingestion `StartRun` first using minimal run context only
      - then dispatch crawler `StartRun`
    - if pipeline mode is `crawl_only`:
      - dispatch crawler `StartRun` only
  - response should return `202 Accepted` with the queued run identity and current control-plane
    status
- `POST /v1/runs/{runId}/cancel`
  - requests cancellation or stop of one run
  - request body should be empty in V2 MVP
  - should be idempotent from the operator perspective
  - response should return `202 Accepted` for an accepted cancellation request

### Run Read Endpoints

- `GET /v1/runs`
  - lists runs from `control_plane_runs`
  - should support simple filters such as:
    - `pipelineId`
    - `status`
    - `source`
    - `limit`
    - `cursor`
- `GET /v1/runs/{runId}`
  - returns one run projection from `control_plane_runs`
- `GET /v1/runs/{runId}/events`
  - returns indexed run events from `control_plane_run_event_index`
  - should support pagination by `cursor` and `limit` in V2 MVP
  - event-time filters can be added later if a real UI need appears

### Not Part Of The V2 REST Surface

- standalone CRUD for live search spaces
- standalone CRUD for live runtime profiles
- standalone CRUD for live structured output destinations
- bootstrap/config-pack APIs
- `GET /v1/runs/{runId}/artifacts`
- `GET /v1/runs/{runId}/outputs`

These are intentionally excluded to preserve the pipeline-first ownership model.

Reason:

- the first UI can derive artifact and output views from `GET /v1/runs/{runId}` plus
  `GET /v1/runs/{runId}/events`
- dedicated artifact and output endpoints can be added later as convenience read APIs if the UI
  needs them

## Control-Plane Collections

The control-plane database should contain these collections:

- `control_plane_pipelines`
- `control_plane_runs`
- `control_plane_run_manifests`
- `control_plane_run_event_index`

For V2 MVP, these are enough.

Not introduced in MVP:

- `control_plane_bootstrap_profiles`
- `control_plane_artifact_index`
- `control_plane_output_index`

Reason:

- artifact listing can be derived from `crawler.detail.captured`
- downloadable JSON listing can be derived from `ingestion.item.succeeded` plus the run manifest
  and deterministic storage-path rules

If those reads later become too expensive or awkward, dedicated index collections can be added as
derived projections without changing worker contracts.

## Canonical Ownership Rule

This rule should stay hard in V2 MVP.

- workers own execution and pipeline-local persistence
- workers write pipeline-owned collections only:
  - `crawl_run_summaries`
  - `ingestion_run_summaries`
  - `normalized_job_ads`
- `control-service` owns the control-plane database only
- `control-service` writes control-plane collections only:
  - `control_plane_pipelines`
  - `control_plane_runs`
  - `control_plane_run_manifests`
  - `control_plane_run_event_index`
- `control-center-v2` never reads pipeline-owned databases directly
- pipeline-local collections are not the primary source for the cross-pipeline UI

## Why `control_plane_runs` Must Exist

Each pipeline owns a separate production database.

That means pipeline-owned collections like:

- `crawl_run_summaries`
- `ingestion_run_summaries`
- `normalized_job_ads`

are not a good primary source for a cross-pipeline dashboard.

`control_plane_runs` exists to solve that:

- one document per run
- one control-plane database
- enough denormalized fields to render run lists, run status, and overview dashboards without
  scanning many pipeline databases

The authoritative deep telemetry remains in pipeline-owned summary collections. The control-plane
run projection stores only the subset needed by the UI.

## Collection Roles

### `control_plane_pipelines`

Authoritative control-plane desired state, one document per pipeline.

Purpose:

- pipeline create/update/delete flows
- stable operator-owned pipeline definition
- immutable execution identity:
  - source
  - search space
  - runtime profile
  - structured output
  - pipeline-owned `dbName`

This is not a projection. It is the control-plane source of truth for pipeline configuration.

### `control_plane_run_manifests`

Authoritative command snapshot written when a run is created.

Purpose:

- replay
- audit
- artifact/output path resolution
- preserving the pipeline-owned execution snapshot

This is not a projection. It is an immutable execution snapshot.

### `control_plane_run_event_index`

Append-style event history, one document per runtime event.

Purpose:

- event history UI
- artifact listing derivation
- downloadable JSON listing derivation
- debugging and audit

This is a projection/index of runtime events shaped for queries.

### `control_plane_runs`

One current-state projection document per run.

Purpose:

- run list UI
- run detail header/status
- overview dashboards
- current phase status without replaying the full event stream on every request

This is the primary cross-pipeline UI read model.

## Recommended Document Shapes

### `control_plane_run_event_index`

Recommended shape:

```json
{
  "_id": "evt-123",
  "eventId": "evt-123",
  "runId": "crawl-run-test-vyvoj-002",
  "eventType": "crawler.detail.captured",
  "eventVersion": "v2",
  "producer": "crawler-worker",
  "occurredAt": "2026-03-07T07:30:10.000Z",
  "correlationId": "jobs.cz:test-vyvoj:crawl-run-test-vyvoj-002:2001063102",
  "crawlRunId": "crawl-run-test-vyvoj-002",
  "searchSpaceId": "test-vyvoj",
  "source": "jobs.cz",
  "sourceId": "2001063102",
  "dedupeKey": "jobs.cz:test-vyvoj:crawl-run-test-vyvoj-002:2001063102",
  "payload": {},
  "projectionStatus": "applied",
  "ingestedAt": "2026-03-07T07:30:10.300Z"
}
```

Important indexes:

- unique `{ eventId: 1 }`
- `{ runId: 1, occurredAt: 1 }`
- optional later `{ runId: 1, eventType: 1, occurredAt: 1 }` if dedicated artifact/output
  endpoints become hot enough to justify it

### `control_plane_runs`

Recommended shape:

```json
{
  "_id": "crawl-run-test-vyvoj-002",
  "runId": "crawl-run-test-vyvoj-002",
  "pipelineId": "test-vyvoj",
  "pipelineName": "test-vyvoj",
  "mode": "crawl_and_ingest",
  "dbName": "test-vyvoj",
  "source": "jobs.cz",
  "searchSpaceId": "test-vyvoj",
  "status": "running",
  "requestedAt": "2026-03-07T07:29:59.000Z",
  "startedAt": "2026-03-07T07:30:01.000Z",
  "finishedAt": null,
  "lastEventAt": "2026-03-07T07:30:10.000Z",
  "stopReason": null,
  "crawler": {
    "status": "running",
    "startedAt": "2026-03-07T07:30:01.000Z",
    "finishedAt": null,
    "detailPagesCaptured": 1
  },
  "ingestion": {
    "enabled": true,
    "status": "running",
    "startedAt": "2026-03-07T07:29:59.500Z",
    "finishedAt": null,
    "jobsProcessed": 0,
    "jobsFailed": 0,
    "jobsSkippedIncomplete": 0
  },
  "artifacts": {
    "detailCapturedCount": 1
  },
  "outputs": {
    "downloadableJsonEnabled": true,
    "downloadableJsonCount": 0
  },
  "summary": {
    "newJobsCount": null,
    "existingJobsCount": null,
    "inactiveMarkedCount": null,
    "failedRequests": null,
    "totalTokens": null,
    "totalEstimatedCostUsd": null
  }
}
```

Important indexes:

- unique `{ runId: 1 }`
- `{ pipelineId: 1, requestedAt: -1 }`
- `{ status: 1, requestedAt: -1 }`

## Event Derivation Rules

`control-service` should not invent runtime facts. It should reduce what the workers emit.

### Events That Must Be Indexed

- `crawler.run.started`
- `crawler.detail.captured`
- `crawler.run.finished`
- `ingestion.run.started`
- `ingestion.item.started`
- `ingestion.item.succeeded`
- `ingestion.item.failed`
- `ingestion.item.rejected`
- `ingestion.run.finished`

### `control_plane_runs` Reducer Rules

#### Initial Run Creation

Written synchronously by `control-service` when the operator starts a run.

Purpose:

- the UI can show the run immediately
- runtime events always have a run record to land against

Initial state:

- `status = queued`
- `crawler.status = queued`
- `ingestion.status = queued` only if ingestion is enabled

#### `crawler.run.started`

- set `status = running`
- set `crawler.status = running`
- set `startedAt` if empty
- update `lastEventAt`

#### `crawler.detail.captured`

- increment `crawler.detailPagesCaptured`
- increment `artifacts.detailCapturedCount`
- update `lastEventAt`

Artifact listing for the UI should be derived by querying
`control_plane_run_event_index` for this event type.

#### `crawler.run.finished`

- set `crawler.status` to the terminal crawler status
- set `crawler.finishedAt`
- copy minimal terminal fields:
  - `stopReason`
  - `source`
  - `searchSpaceId`
- update `lastEventAt`

If the run is `crawl_only`, this event can finalize the overall run.

If ingestion is enabled, overall finalization waits for `ingestion.run.finished`.

#### `ingestion.run.started`

- set `status = running`
- set `ingestion.status = running`
- set `ingestion.startedAt`
- update `lastEventAt`

#### `ingestion.item.started`

- update `lastEventAt`

#### `ingestion.item.succeeded`

- increment `ingestion.jobsProcessed`
- increment `outputs.downloadableJsonCount` only if the run manifest enables downloadable JSON
- update `lastEventAt`

Downloadable JSON listing for the UI should be derived from:

- `ingestion.item.succeeded` events in `control_plane_run_event_index`
- `control_plane_run_manifests`
- deterministic storage-path rules

#### `ingestion.item.failed`

- increment `ingestion.jobsFailed`
- update `lastEventAt`

#### `ingestion.item.rejected`

- increment `ingestion.jobsSkippedIncomplete`
- update `lastEventAt`

#### `ingestion.run.finished`

- set `ingestion.status` to the terminal status
- set `ingestion.finishedAt`
- set overall `status` to the ingestion terminal status
- set `finishedAt`
- copy summary excerpt fields needed by the UI:
  - `totalTokens`
  - `totalEstimatedCostUsd`
  - `jobsProcessed`
  - `jobsFailed`
  - `jobsSkippedIncomplete`
- update `lastEventAt`

## Projection Algorithm

The transaction algorithm should follow the `control-service` Pub/Sub contract defined above.

Projection-specific rule:

1. insert the indexed event document if `eventId` is new
2. load `control_plane_runs` for `runId`
3. if the run exists:
   - apply the reducer
   - upsert the projection document
4. if the run does not exist:
   - keep the indexed event with `projectionStatus = orphaned`
   - do not synthesize a run projection
5. commit before ack

Reason:

- duplicates are harmless
- event index and run projection stay consistent
- retries remain safe

MongoDB Atlas supports transactions, so this should be the canonical V2 approach.

## Unknown-Run Event Handling

V2 contract intent is:

- `control-service` creates the run record before workers emit events

So unknown-run events should be treated as anomalies.

Recommended behavior:

- write the event into `control_plane_run_event_index` with `projectionStatus = orphaned`
- do not create a synthetic `control_plane_runs` document
- ack the message
- surface the anomaly in logs and alerts

This preserves the event without corrupting the run projection model.

## UI Read Model And Live Updates

The UI should not access MongoDB directly.

Normal read path:

- UI query -> `control-service` -> control-plane MongoDB

Normal write path:

- operator action -> `control-center-v2` -> `control-service` command API -> worker REST `StartRun`

Normal runtime path:

- worker event -> Pub/Sub -> `control-service` subscriber -> control-plane MongoDB

Recommended live-update approach for MVP:

- use SSE from `control-service`

Optional later upgrade:

- use WebSocket only if the operator UI needs richer bidirectional session behavior

The key rule does not change:

- the UI reads projected control-plane data only

## Why No Dedicated Artifact/Output Index In MVP

### Artifacts

`crawler.detail.captured` already carries:

- `sourceId`
- `dedupeKey`
- listing snapshot
- artifact storage reference

That is enough to build artifact browser views.

### Downloadable JSON Outputs

`ingestion.item.succeeded` plus the run manifest is enough because:

- the run manifest knows which downloadable destinations are enabled
- the output storage path is deterministic from `runId`, destination, and `sourceId`

That is enough to build output browser views without another collection.

## Tradeoff

This MVP keeps the number of control-plane collections low.

If later query patterns prove too expensive, add:

- `control_plane_artifact_index`
- `control_plane_output_index`

as derived projections only.

Do not add them before the actual read patterns justify them.

## V2 MVP Recommendation

Build V2 with these moving parts:

1. `control-center-v2`
2. `control-service`
3. `crawler-worker-v2`
4. `ingestion-worker-v2`

And these control-plane MongoDB collections:

1. `control_plane_pipelines`
2. `control_plane_runs`
3. `control_plane_run_manifests`
4. `control_plane_run_event_index`

Defer until a later version:

- `control_plane_bootstrap_profiles`

That is the simplest architecture that:

- works with Vercel
- preserves event-driven runtime behavior
- avoids polling workers
- avoids filesystem coupling
- gives the UI one authoritative backend and one authoritative control-plane database to read

## V2 Implementation Contracts

The core control-plane direction is fixed. The remaining work is mostly implementation, but the
following contracts are canonical for V2 MVP.

### 1. SSE Contract

Canonical V2 MVP shape:

- endpoint:
  - `GET /v1/stream`
- query params:
  - optional `pipelineId`
  - optional `runId`
- event names:
  - `stream.hello`
  - `run.upserted`
  - `run.event.appended`
  - `stream.heartbeat`

Payload rules:

- `stream.hello`
  - emitted once when the stream connects
  - includes accepted filters and heartbeat interval
- `run.upserted`
  - carries one `control_plane_runs` document shaped for the UI
- `run.event.appended`
  - carries one newly indexed `control_plane_run_event_index` document
- `stream.heartbeat`
  - carries the same shallow service status shape as `GET /heartbeat`

Reconnect rules:

- V2 MVP should use normal EventSource reconnect behavior
- V2 MVP should not promise durable SSE replay
- on reconnect, the UI should reopen the stream and re-fetch the relevant REST read model:
  - `GET /v1/runs`
  - `GET /v1/runs/{runId}`
  - `GET /v1/runs/{runId}/events`

Heartbeat policy:

- `stream.heartbeat` should be emitted on a fixed short interval
- recommended V2 MVP interval: 15 seconds

### 2. Worker Orchestration Contract

Canonical ingestion start rule:

- `control-service` starts ingestion before crawler for `crawl_and_ingest` pipelines
- ingestion `StartRun` is an event-driven run registration command, not a batch item command
- ingestion `StartRun` must not include `inputRef.records`
- ingestion receives work from `crawler.detail.captured` and finalization from
  `crawler.run.finished`

Canonical dispatch rule:

- `control-service` writes `control_plane_runs` and `control_plane_run_manifests` first
- `crawl_only` pipelines dispatch crawler only
- `crawl_and_ingest` pipelines dispatch ingestion first, then crawler
- worker command idempotency is keyed by the run-level idempotency key already carried in the
  manifest worker commands
- V2 MVP treats worker responses `accepted`, `queued`, and `deduplicated` as successful dispatch
- V2 MVP uses one synchronous dispatch attempt per worker command

Partial dispatch failure rule:

- if ingestion dispatch fails, `control-service` must not dispatch crawler
- if ingestion dispatch fails, overall run `status = failed`
- if ingestion dispatch fails, `stopReason = ingestion_dispatch_failed`
- if crawler dispatch fails after ingestion already accepted the run, `control-service` must send
  one best-effort `POST /v1/runs/{runId}/cancel` call to ingestion
- if crawler dispatch fails after ingestion already accepted the run, overall run `status = failed`
- if crawler dispatch fails after ingestion already accepted the run,
  `stopReason = crawler_dispatch_failed`
- if the best-effort ingestion cancel call also fails, `control-service` must log the anomaly and
  keep the run in terminal `failed`
- V2 MVP does not include an automatic retry queue or background replay worker

### 3. Run State Machine

V2 MVP keeps one small status enum for both the overall run and worker sub-states:

- `queued`
- `running`
- `succeeded`
- `completed_with_errors`
- `failed`
- `stopped`

Non-terminal statuses:

- `queued`
- `running`

Terminal statuses:

- `succeeded`
- `completed_with_errors`
- `failed`
- `stopped`

Initial state written synchronously by `control-service`:

- overall `status = queued`
- `crawler.status = queued`
- `ingestion.status = queued` only when pipeline mode is `crawl_and_ingest`
- `ingestion.status = null` when pipeline mode is `crawl_only`

Transition rules:

- `crawler.run.started`
  - `crawler.status = running`
  - overall `status = running`
  - set `startedAt` if empty
- `ingestion.run.started`
  - `ingestion.status = running`
  - overall `status = running`
  - set `startedAt` if empty
- `crawler.run.finished`
  - set `crawler.status` to the emitted terminal status
  - set `crawler.finishedAt`
  - if mode is `crawl_only`, finalize the overall run immediately from crawler terminal status
- `ingestion.run.finished`
  - set `ingestion.status` to the emitted terminal status
  - set `ingestion.finishedAt`
  - finalize the overall run for `crawl_and_ingest`

Overall terminal status rule for `crawl_and_ingest`:

- if either worker terminal status is `failed`, overall `status = failed`
- else if either worker terminal status is `stopped`, overall `status = stopped`
- else if either worker terminal status is `completed_with_errors`, overall
  `status = completed_with_errors`
- else overall `status = succeeded`

Dispatch failure precedence rule:

- synchronous worker dispatch failure is a terminal control-plane failure
- if `control-service` already marked the run `failed` because worker dispatch failed, later worker
  runtime events may update worker sub-state fields but must not downgrade overall status from
  `failed` to `stopped` or `succeeded`

Cancellation and stop semantics:

- operator intent uses one command only: `POST /v1/runs/{runId}/cancel`
- `cancel` is not a terminal state by itself
- `control-service` must not optimistically set overall `status = stopped`
- workers confirm operator stop intent by emitting their normal terminal runtime events with
  terminal status `stopped`

Failure summarization rule:

- `stopReason` stores one short terminal reason only
- prefer the terminal reason from the worker that determines the final overall terminal status
- V2 MVP does not synthesize a larger cross-worker error document

### 4. Auth Contract

V2 MVP should standardize on one shared bearer token.

Canonical deployment rule:

- `CONTROL_AUTH_MODE=token`
- `CONTROL_SHARED_TOKEN` is required for `control-service`, `crawler-worker-v2`, and
  `ingestion-worker-v2`
- V2 MVP should not require JWT issuance or public-key distribution
- existing worker JWT code paths may remain in implementation, but JWT is not the canonical V2
  deployment contract

Inbound auth:

- `control-center-v2` must call `control-service` with `Authorization: Bearer <CONTROL_SHARED_TOKEN>`
- the browser must not hold the shared token directly
- authenticated UI calls should go through trusted server-side code in `control-center-v2`

Outbound auth:

- `control-service` must call crawler and ingestion worker REST APIs with
  `Authorization: Bearer <CONTROL_SHARED_TOKEN>`

Auth-exempt endpoints:

- `GET /healthz`
- `GET /readyz`

Authenticated endpoints:

- `GET /heartbeat`
- all `/v1/*` REST endpoints
- `GET /v1/stream`

### 5. Operational Contract

Typed env schema should stay minimal.

Required env:

- `MONGODB_URI`
- `CONTROL_PLANE_DB_NAME`
- `CRAWLER_WORKER_BASE_URL`
- `INGESTION_WORKER_BASE_URL`
- `GCP_PROJECT_ID`
- `PUBSUB_EVENTS_TOPIC`
- `PUBSUB_EVENTS_SUBSCRIPTION`

Optional env with defaults:

- `PORT`
  - default `8080`
- `HOST`
  - default `0.0.0.0`
- `SERVICE_NAME`
  - default `control-service-v2`
- `SERVICE_VERSION`
  - default `dev`
- `LOG_LEVEL`
  - default `info`
- `LOG_PRETTY`
  - default `false`
- `ENABLE_PUBSUB_CONSUMER`
  - default `true`
- `PUBSUB_AUTO_CREATE_SUBSCRIPTION`
  - default `true`
- `SSE_HEARTBEAT_INTERVAL_MS`
  - default `15000`
- `CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND`
  - default `local_filesystem`
- `CONTROL_PLANE_ARTIFACT_STORAGE_LOCAL_BASE_PATH`
  - default `control-plane-artifacts`
- `CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET`
  - required when `CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND=gcs`
- `CONTROL_PLANE_ARTIFACT_STORAGE_GCS_PREFIX`
  - default `''`

Artifact sink rule:

- `control-service` owns crawler `artifactSink` selection because crawler requires it in
  `StartRun`
- V2 MVP should keep this small:
  - local development may use `local_filesystem`
  - GCP deployments should use `gcs`
- downloadable JSON output storage remains ingestion-worker bootstrap config and is not configured
  through `control-service`

Bootstrap order:

1. parse env
2. create Fastify logger
3. connect MongoDB
4. ensure MongoDB indexes
5. create Pub/Sub client and subscription if enabled
6. create in-memory service state for readiness and heartbeat
7. register auth hook and routes
8. start subscriber
9. close subscription and MongoDB on shutdown

Logging rule:

- Fastify should use Pino as the service logger
- when `LOG_PRETTY=true` and stdout is a TTY, Fastify should enable `pino-pretty` transport for
  console output
- when `LOG_PRETTY=false`, structured JSON logs should be emitted
- this should match the existing worker service pattern

Canonical MongoDB index contract:

- `control_plane_pipelines`
  - unique `{ pipelineId: 1 }`
  - unique `{ dbName: 1 }`
  - `{ status: 1, updatedAt: -1 }`
- `control_plane_run_manifests`
  - unique `{ runId: 1 }`
- `control_plane_runs`
  - unique `{ runId: 1 }`
  - `{ pipelineId: 1, requestedAt: -1 }`
  - `{ status: 1, requestedAt: -1 }`
- `control_plane_run_event_index`
  - unique `{ eventId: 1 }`
  - `{ runId: 1, occurredAt: 1 }`

Retention rule:

- V2 MVP should not use TTL indexes on control-plane collections
- retention and purge policy are deferred to a later version

Metrics and structured logging fields:

- `serviceName`
- `serviceVersion`
- `requestId`
- `pipelineId`
- `runId`
- `eventId`
- `eventType`
- `correlationId`
- `subscriptionName`

Container deployment expectations:

- `control-service` runs as one stateless containerized process
- the same process owns REST, SSE, and the Pub/Sub subscriber
- `GET /readyz` must fail when MongoDB is unavailable
- `GET /readyz` must also fail when `ENABLE_PUBSUB_CONSUMER=true` and the subscriber is not ready

### 6. Remaining Open Work

Still needed:

- control-service app-local env parsing and bootstrap wiring

## Non-Goals

Not part of this spec:

- scheduler service design
- control-center authentication
- artifact/output retention policy
- historical backfill from V1 archived broker files
- replacing pipeline-owned telemetry summaries as the deep telemetry authority
