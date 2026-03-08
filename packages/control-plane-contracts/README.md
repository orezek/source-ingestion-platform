# `@repo/control-plane-contracts`

Shared contracts for the control plane, worker adapters, and current broker events.

Exports:

- control-plane config schemas
- run manifest schemas
- current broker event schemas/builders
- artifact and sink path helpers
- v2 worker contracts:
  - `startRunRequestV2Schema` and `startRunResponseV2Schema`
  - `workerLifecycleEventV2Schema`
  - `runtimeBrokerEventV2Schema`
  - control-service collection and command schemas for:
    - `control_plane_pipelines`
    - `control_plane_runs`
    - `control_plane_run_manifests`
    - `control_plane_run_event_index`
    - create/update pipeline requests
    - start/cancel run requests
    - list/query response envelopes for pipelines, runs, and run events
    - `healthz`, `readyz`, and `heartbeat` response payloads
    - minimal Pub/Sub consumer config for `control-service`
    - SSE query and event payload schemas
  - projection schemas for:
    - `crawl_run_summaries`
    - `ingestion_run_summaries`
  - validated fixture payloads for the schemas above

Notes:

- v2 worker command ingress is REST `StartRun`, not broker command delivery.
- worker-facing `StartRun` excludes `workerType`, `requestedAt`, and `correlationId`.
- `runtimeSnapshot` is worker-specific:
  - crawler: `crawlerMaxConcurrency`, `crawlerMaxRequestsPerMinute`
  - ingestion: `ingestionConcurrency`
- ingestion `StartRun` is event-driven registration only:
  - it includes `inputRef.crawlRunId` and `inputRef.searchSpaceId`
  - downloadable JSON routing is run-scoped in `outputSinks[].delivery`
  - it does not carry inline item batches or `inputRef.records`
- ingestion `CancelRun` uses a typed reason payload:
  - `startup_rollback`
  - `operator_request`
- `crawler.run.requested` remains exported for legacy/v1 compatibility and control-plane replay
  helpers; it is not the canonical v2 worker command path.
- V2 runtime broker events now live in `src/v2.ts`.
- `src/index.ts` remains the legacy/v1 compatibility surface for older broker event builders and
  readers still used by v1-era apps.
- V2 event design rule:
  - `crawler.detail.captured` is the rich crawler-to-ingestion handoff event
  - `crawler.run.finished` is minimal
  - ingestion item lifecycle events are intentionally lean and do not carry sink routing blobs
