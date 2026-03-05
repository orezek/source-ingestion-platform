# `@repo/control-plane-contracts`

Shared v1 contracts for the JobCompass control plane and worker adapters.

Exports:

- control-plane config schemas
- run manifest schemas
- broker event schemas
- artifact and sink path helpers
- v2 worker contracts:
  - `startRunRequestV2Schema` and `startRunResponseV2Schema`
  - `workerLifecycleEventV2Schema`
  - projection schemas for:
    - `crawl_run_summaries`
    - `ingestion_run_summaries`
    - `ingestion_trigger_requests`
  - validated fixture payloads for the schemas above
