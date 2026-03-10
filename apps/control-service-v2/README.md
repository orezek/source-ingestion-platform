# control-service-v2

Standalone control-plane backend for V2.

It owns:

- control-plane REST endpoints for pipelines and runs
- control-plane SSE stream for live UI updates
- Pub/Sub consumption for runtime event projections
- control-plane MongoDB collections:
  - `control_plane_pipelines`
  - `control_plane_runs`
  - `control_plane_run_manifests`
  - `control_plane_run_event_index`
  - `control_plane_run_json_artifacts`
  - `control_plane_pipeline_delete_jobs`
- worker dependency preflight checks (`/readyz`) before run dispatch
- sink preflight checks (operator Mongo sink + artifact sink)
- run-scoped routing policy for crawler artifacts and ingestion outputs

It does not own:

- worker execution
- browser-side auth

## HTTP surface

- `GET /healthz`
- `GET /readyz`
- `GET /heartbeat`
- `POST /v1/pipelines`
- `GET /v1/pipelines`
- `GET /v1/pipelines/:pipelineId`
- `PATCH /v1/pipelines/:pipelineId`
- `DELETE /v1/pipelines/:pipelineId`
- `GET /v1/pipelines/:pipelineId/delete-status`
- `POST /v1/pipelines/:pipelineId/runs`
- `POST /v1/runs/:runId/cancel`
- `GET /v1/runs`
- `GET /v1/runs/:runId`
- `GET /v1/runs/:runId/events`
- `GET /v1/runs/:runId/json-artifacts`
- `GET /v1/runs/:runId/json-artifacts/:artifactId`
- `GET /v1/runs/:runId/json-artifacts/:artifactId/download`
- `GET /v1/runs/:runId/json-artifacts/download-all`
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
- `CONTROL_PLANE_JSON_BUNDLE_MAX_BYTES`
- `CONTROL_PLANE_JSON_BUNDLE_TIMEOUT_MS`
- `CONTROL_PLANE_SKIP_SINK_PREFLIGHT`

Artifact sink selection is owned here:

- crawler receives `artifactSink`
- ingestion receives `outputSinks[].delivery`
- system default is `CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND=gcs` so HTML artifacts and downloadable JSON are bucket-backed
- `local_filesystem` is fallback-only for temporary local debugging

Run dispatch policy:

- `crawl_only`: crawler readiness required
- `crawl_and_ingest`: crawler and ingestion readiness required
- `crawl_and_ingest` dispatch order: ingestion `StartRun` accepted first, crawler `StartRun` second
- worker dispatch retries transient failures (`408`, `429`, `5xx`) with backoff
- if crawler dispatch fails after ingestion accepted, control-service sends ingestion cancel with
  `reason: "startup_rollback"`

Operator Mongo sink policy:

- pipeline config includes `operatorSink.mongodbUri` and `operatorSink.dbName`
- `mongodbUri` is write-only in pipeline read responses (`hasMongoUri` indicates presence)
- control-service passes `persistenceTargets.mongodbUri` and `persistenceTargets.dbName` per run to
  both workers

Pipeline delete policy:

- delete is async and returns accepted with `deleteJobId`
- delete is blocked while any pipeline run is active
- delete is blocked while unsettled runtime events exist
- cascade removes control-plane metadata, pipeline-scoped artifacts, and pipeline output data

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
