# GCP Infrastructure Alignment v2.1

Status: Proposed  
Owner: Platform  
Date: 2026-03-08
Target Release: v2.1

## 1) Problem Statement

Current GCP-related ownership is inconsistent:

- `control-service-v2` owns crawler artifact sink routing (`CONTROL_PLANE_ARTIFACT_STORAGE_*`).
- `ingestion-worker-v2` owns downloadable JSON routing (`OUTPUTS_BUCKET`, `OUTPUTS_PREFIX`).
- `crawler-worker-v2` does not expose artifact sink routing in bootstrap env, but still writes artifacts based on run inputs.
- Pub/Sub consumption in ingestion can drop actionable messages when `StartRun` was not accepted/registered yet.
- `GCP_PROJECT_ID` and Pub/Sub envs are duplicated with uneven documentation across services.

This creates operational ambiguity, especially for managed deployments and future multi-tenant V4.

## 2) Goals

- Align ownership: control plane controls per-run storage routing.
- Keep workers operationally simple and mostly stateless.
- Prevent ingestion data loss when `crawler.detail.captured` arrives before run registration.
- Standardize and document GCP env groups across services.
- Keep a forward path for V4 user-owned resources.

## 3) Non-Goals

- Full identity/tenant isolation implementation (V4 scope).
- Replacing Pub/Sub with a different broker.
- Rewriting all V2 contracts in one release.

## 4) Decisions

### 4.1 Bucket Ownership and Routing

Decision:

- Bucket and prefix selection is owned by `control-service-v2` (control plane), not worker bootstrap env.
- Routing must be run-scoped and sent via `StartRun`.
- One bucket for all pipelines is acceptable in v2.1; enforce deterministic prefix partitioning:
  - `pipelines/{pipelineId}/runs/{runId}/...`

Implications:

- `crawler-worker-v2`: keeps consuming `artifactSink` from `StartRun` (already aligned).
- `ingestion-worker-v2`: `downloadable_json` delivery config is moved from bootstrap env to `StartRun`.

### 4.2 Ingestion Pub/Sub Start Ordering and Message Safety

Decision:

- `control-service-v2` must run preflight dependency checks before dispatching any `StartRun`:
  - crawler worker availability is required for `crawl_only` and `crawl_and_ingest`.
  - ingestion worker availability is required for `crawl_and_ingest` only.
- Worker availability check is defined as:
  - `GET /readyz` must return `200` with `{ ok: true }`,
  - request timeout 2 seconds,
  - 3 attempts with fixed 500ms backoff,
  - no stale readiness cache between attempts.
- If a required worker is unavailable, control service must fail fast and return a UI-visible dependency error.
- For `crawl_and_ingest`, after preflight passes:
  - control service dispatches ingestion `StartRun` first.
  - crawler `StartRun` can be dispatched only after ingestion `StartRun` is accepted (with retries and idempotency).
  - if crawler `StartRun` fails after retries, control service must cancel the accepted ingestion run with reason `startup_rollback`.
  - if ingestion cancel fails after retries, control service must mark the run failed with `startup_rollback_cancel_failed` and return an actionable error.
- Ingestion worker subscription must be created at worker startup.
- Ingestion worker consumer must stay paused (do not pull messages) until `StartRun` is accepted.
- After `StartRun` is accepted, ingestion worker starts pulling and processes messages with explicit outcome rules:
  - ACK only after successful processing and MongoDB persistence.
  - Artifact upload failures (for example downloadable JSON GCS upload) are best-effort and do not block ACK when Mongo persistence already succeeded.
  - transient failures (timeouts, temporary connectivity issues) use NACK or ack-deadline expiry for retry.
  - permanent failures (invalid payload, deterministic parser failure) must be recorded as failed in Mongo and then ACKed.
- Ingestion worker must auto-expire an accepted run if no detail events are received within 60 seconds.
- Dead-letter redrive workflow is deferred to V4.

Rationale:

- Dependency-gated startup is operationally clearer than best-effort partial startup.
- UI gets deterministic, actionable errors (for example: "ingestion worker unavailable").
- Subscription retention is the queue/backlog; no app-local backlog store is required in v2.1.
- Explicit transient vs permanent failure handling preserves throughput and avoids unbounded retry loops.
- Orphan run prevention (cancel + auto-expire) avoids stuck ingestion runs.

### 4.3 GCP Project and Pub/Sub Bootstrap Ownership

Decision:

- Keep `GCP_PROJECT_ID` and Pub/Sub connection envs in all services in v2.1.
- These remain bootstrap connectivity settings, not business routing settings.
- No extra control-plane bootstrap endpoint is required in v2.1.

Rationale:

- Minimizes contract and startup complexity now.
- Defers deeper dynamic bootstrap orchestration to V4.

## 5) Contract Changes (v2.1)

### 5.1 Ingestion StartRun

Current: `outputSinks` only toggles `downloadable_json` by type.

Proposed:

- Extend ingestion `StartRun.outputSinks` to allow run-scoped delivery config:
  - `type: "downloadable_json"`
  - `delivery`:
    - `storageType: "gcs" | "local_filesystem"`
    - `bucket` (required for gcs)
    - `prefix`
    - `basePath` (required for local filesystem)

Compatibility:

- None. v2.1 applies a strict contract cutover for ingestion downloadable JSON delivery config.
- If `outputSinks` includes `downloadable_json` and `delivery` is missing, `StartRun` must be rejected.
- Rollout policy: release control service + workers as one coordinated v2.1 update.

### 5.2 Crawler StartRun

- No structural change required: `artifactSink` already carries storage routing per run.

### 5.3 Ingestion CancelRun

Decision:

- Keep endpoint path unchanged: `POST /v1/runs/:runId/cancel`.
- `runId` in URL path identifies which run to cancel.
- Control service must send a typed cancel payload with one of these reasons:
  - `reason: "startup_rollback"`
  - `reason: "operator_request"`

Request schema (v2.1 scope):

```ts
{
  reason: "startup_rollback" | "operator_request";
  details?:
    | {
        failedWorker?: "crawler";
        failedAction?: "start_run";
        errorCode?: string;
        errorMessage?: string;
      }
    | {
        requestedBy?: "operator" | "control_service";
        requestedAt?: string; // ISO datetime
        note?: string;
      };
}
```

### 5.4 Operator Cancellation Semantics (v2.1 Behavior)

Decision:

- `operator_request` cancellation is graceful stop plus drain, not hard abort.
- Crawler behavior:
  - stop scheduling new list/detail work immediately,
  - finish in-flight work quickly,
  - stop emitting any new events once crawler processing is stopped,
  - publish `crawler.run.finished` with `status: "stopped"` and `stopReason: "cancelled_by_operator"`.
- Ingestion behavior:
  - continue consuming queued events for the run and drain already-published crawler detail events,
  - apply normal ACK/NACK rules per item outcome,
  - finalize only after `crawler.run.finished` is observed and ingestion queue/activity is drained.
- Data policy:
  - no rollback of already persisted records in v2.1,
  - run summaries remain partial and must explicitly show operator cancellation.

## 6) Env Var Alignment (v2.1)

Canonical shared connectivity group for services that touch Pub/Sub:

- `GCP_PROJECT_ID`
- `PUBSUB_EVENTS_TOPIC`
- `PUBSUB_EVENTS_SUBSCRIPTION` (consumer services)
- `PUBSUB_AUTO_CREATE_SUBSCRIPTION` (consumer services)
- `ENABLE_PUBSUB_CONSUMER` (consumer services)

Service-specific routing envs:

- Keep in control service:
  - `CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND`
  - `CONTROL_PLANE_ARTIFACT_STORAGE_LOCAL_BASE_PATH`
  - `CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET`
  - `CONTROL_PLANE_ARTIFACT_STORAGE_GCS_PREFIX`

Removed from ingestion worker bootstrap in v2.1:

- `OUTPUTS_BUCKET`
- `OUTPUTS_PREFIX`

## 7) Execution Flow (crawl_and_ingest)

1. Control service resolves pipeline + runtime profile + storage policy.
2. Control service runs dependency preflight:
   - crawler worker must be ready.
   - ingestion worker must be ready.
3. If dependency check fails, control service returns explicit failure to UI and does not start the run.
4. Control service calls ingestion `StartRun` (idempotent key).
5. Control service waits for accepted response (retry on timeout/transient failures).
6. Control service calls crawler `StartRun`.
7. Ingestion worker consumes live events.
8. Ingestion ACK/NACK policy is applied per message outcome (success, transient failure, permanent failure).
9. If crawler `StartRun` fails after retries, control service cancels the ingestion run using cancel payload `reason: "startup_rollback"`.
10. If ingestion cancel fails after retries, control service marks the run failed with stop reason `startup_rollback_cancel_failed` and returns an actionable error.
11. Ingestion auto-expires accepted runs with no detail events after 60 seconds.
12. Run finalization remains event-driven (`crawler.run.finished` + drained queue).

## 7.1 Execution Flow (operator_request cancel)

1. Control service requests cancel for the run.
2. Crawler stops scheduling new work and transitions to stopped.
3. Crawler emits `crawler.run.finished` with `status: "stopped"` and `stopReason: "cancelled_by_operator"`.
4. Ingestion continues processing already queued crawler detail events for that run.
5. Ingestion finalizes as stopped after `crawler.run.finished` is observed and ingestion queue/activity is drained.
6. Control service persists run summaries as partial with explicit stop reason `cancelled_by_operator`.

## 8) Rollout Plan

Release strategy:

- Deliver as one coordinated v2.1 release for `control-service-v2`, `crawler-worker-v2`, and `ingestion-worker-v2`.
- Include in the same release:
  - ingestion `StartRun.outputSinks.delivery` contract changes,
  - ingestion cancel request shape (`startup_rollback` and `operator_request`),
  - dependency preflight readiness checks,
  - startup rollback cancellation path and failure handling,
  - 60-second auto-expire and operator drain semantics.
- Publish updated `.env.example` documentation in the same change set.

Future versions:

- V4 introduces tenant/user-owned storage policy extensions and DLQ redrive workflow.

## 9) Operational Guardrails

- Track dependency preflight failures by worker type and pipeline mode.
- Track ingestion message outcomes by category: `success`, `transient_retry`, `permanent_failed`.
- Alert when ingestion `StartRun` retries exceed threshold.
- Alert when ingestion runs auto-expire (no detail events in 60 seconds).
- Publish run-level diagnostics including resolved storage routing (backend, bucket/basePath, prefix).

Known caveats kept in v2.1:

- 60-second auto-expire may incorrectly stop low-yield or slow-first-item runs; retained for now and revisited in a future version.
- Operator cancellation can take long on large queues because ingestion drains queued events before final stop; retained for now and revisited in a future version.

## 10) V4 Compatibility

This model is V4-ready:

- Control plane already owns per-run storage policy.
- User-owned buckets become a policy/provider change in control plane.
- Worker logic remains unchanged except for credential scope/authorization boundaries.
