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
  - projection schemas for:
    - `crawl_run_summaries`
    - `ingestion_run_summaries`
  - validated fixture payloads for the schemas above

Notes:

- v2 worker command ingress is REST `StartRun`, not broker command delivery.
- `crawler.run.requested` remains exported for legacy/v1 compatibility and control-plane replay
  helpers; it is not the canonical v2 worker command path.
- current runtime broker events are still split:
  - `startRunRequestV2Schema`, `startRunResponseV2Schema`, and summary projections live in
    `src/v2.ts`
  - item/capture broker events currently live in `src/index.ts`
