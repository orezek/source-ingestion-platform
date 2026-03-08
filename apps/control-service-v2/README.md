# control-service-v2

Standalone control-plane backend for V2.

It owns:

- control-plane REST endpoints for pipelines and runs
- control-plane SSE stream for live UI updates
- Pub/Sub consumption for runtime event projections
- control-plane MongoDB collections only:
  - `control_plane_pipelines`
  - `control_plane_runs`
  - `control_plane_run_manifests`
  - `control_plane_run_event_index`
- worker dependency preflight checks (`/readyz`) before run dispatch
- run-scoped artifact/output routing policy for crawler and ingestion

It does not own:

- worker execution
- pipeline-local collections such as `crawl_run_summaries` or `ingestion_run_summaries`
- browser-side auth

## HTTP surface

- `GET /healthz`
- `GET /readyz`
- `GET /heartbeat`
- `POST /v1/pipelines`
- `GET /v1/pipelines`
- `GET /v1/pipelines/:pipelineId`
- `PATCH /v1/pipelines/:pipelineId`
- `POST /v1/pipelines/:pipelineId/runs`
- `POST /v1/runs/:runId/cancel`
- `GET /v1/runs`
- `GET /v1/runs/:runId`
- `GET /v1/runs/:runId/events`
- `GET /v1/stream`

## Bootstrap env

See [`.env.example`](./.env.example).

Required at runtime:

- `CONTROL_SHARED_TOKEN`
- `MONGODB_URI`
- `CONTROL_PLANE_DB_NAME`
- `CRAWLER_WORKER_BASE_URL`
- `INGESTION_WORKER_BASE_URL`
- `GCP_PROJECT_ID`
- `PUBSUB_EVENTS_TOPIC`
- `PUBSUB_EVENTS_SUBSCRIPTION`

Optional with defaults:

- `PORT`
- `HOST`
- `SERVICE_NAME`
- `SERVICE_VERSION`
- `LOG_LEVEL`
- `LOG_PRETTY`
- `ENABLE_PUBSUB_CONSUMER`
- `PUBSUB_AUTO_CREATE_SUBSCRIPTION`
- `SSE_HEARTBEAT_INTERVAL_MS`

Artifact/output sink selection is owned here:

- crawler receives `artifactSink`
- ingestion receives `outputSinks[].delivery`

- local development can use `CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND=local_filesystem`
- GCP deployment should use `CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND=gcs`

Run dispatch policy:

- `crawl_only`: crawler readiness required
- `crawl_and_ingest`: crawler and ingestion readiness required
- for `crawl_and_ingest`, ingestion `StartRun` is dispatched first, crawler second
- if crawler dispatch fails after ingestion accepted, control-service sends ingestion cancel with
  `reason: "startup_rollback"`

## Local development

Install dependencies from repo root:

```bash
pnpm install
```

Run the service:

```bash
pnpm -C apps/control-service-v2 dev
```

## Validation

```bash
pnpm -C apps/control-service-v2 lint
pnpm -C apps/control-service-v2 check-types
pnpm -C apps/control-service-v2 build
pnpm -C apps/control-service-v2 test
```
