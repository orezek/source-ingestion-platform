# Run Observability Dashboard

`ops-control-plane` is an internal Next.js dashboard for operational visibility into JobCompass crawler and ingestion runs.

## Purpose

The app reads run-summary collections and presents:

- recent crawler and ingestion runs
- derived operational KPIs
- linked pipeline views by `crawlRunId`
- token/cost and success-rate charts
- anomaly indicators for low-quality or error-prone runs

## Routes

- `/` overview dashboard
- `/control-plane` local v1 control plane
- `/control-plane/runs/[runId]` operator run detail with manifest, logs, events, artifacts, and downloadable JSON outputs
- `/control-plane/runs/[runId]/artifacts/[sourceId]` artifact browser for captured HTML
- `/control-plane/runs/[runId]/outputs/[destinationId]/[sourceId]` structured output browser for normalized JSON
- `/crawler/runs/[crawlRunId]` crawler run detail
- `/ingestion/runs/[runId]` ingestion run detail
- `/pipeline/[crawlRunId]` linked pipeline detail
- `/api/control-plane/[resource]` JSON API for local control-plane resources and run starts
- `/api/control-plane/runs/[runId]/artifacts/[sourceId]` artifact preview/download endpoint
- `/api/control-plane/runs/[runId]/outputs/[destinationId]/[sourceId]` structured output preview/download endpoint

## Data Sources

Primary Mongo collections:

- `crawl_run_summaries`
- `ingestion_run_summaries`

Optional supporting collection:

- `ingestion_trigger_requests`

## Environment

See `.env.example`.

Two supported modes:

- `DASHBOARD_DATA_MODE=mongo` for live data
- `DASHBOARD_DATA_MODE=fixture` for local UI testing and automated tests

Control-plane execution modes:

- `CONTROL_PLANE_EXECUTION_MODE=fixture`
  - simulates crawler + ingestion for local UI tests
- `CONTROL_PLANE_EXECUTION_MODE=local_cli`
  - launches the local crawler and ingestion worker adapters
  - still relies on the current crawler behavior, including Mongo-backed reconciliation

Execution mode is env-driven in v1. The `/control-plane` route shows the active mode in the
header, but does not provide a runtime selector.

Local ingestion parser backend:

- `CONTROL_PLANE_INGESTION_PARSER_BACKEND=gemini`
  - requires `GEMINI_API_KEY` and `LANGSMITH_API_KEY` for `local_cli` ingest runs
- `CONTROL_PLANE_INGESTION_PARSER_BACKEND=fixture`
  - uses a deterministic local parser for end-to-end worker validation without external LLM
    credentials

Broker adapter modes:

- `CONTROL_PLANE_BROKER_BACKEND=local`
  - persist broker events under `CONTROL_PLANE_BROKER_DIR`
- `CONTROL_PLANE_BROKER_BACKEND=gcp_pubsub`
  - publish runtime events to Google Cloud Pub/Sub
  - still archive those events under `CONTROL_PLANE_BROKER_DIR` for run detail and downloads
  - requires `CONTROL_PLANE_GCP_PROJECT_ID` and `CONTROL_PLANE_GCP_PUBSUB_TOPIC`

Operator-facing artifact access:

- artifacts stay in the managed backend adapter
- operators browse and download them through the dashboard
- local filesystem paths are treated as backend references, not the primary operator workflow
- GCS-backed artifacts are previewed/downloaded through the same route when Google credentials are
  available to the dashboard process
- downloadable JSON outputs follow the same dashboard-first browse/download flow

Structured outputs:

- `downloadable_json` is built in and selected on pipelines directly
- the control-plane "Structured outputs" section manages only add-on sinks such as MongoDB
- active run detail, artifact, and output pages auto-refresh while the run is still queued or running

Managed storage backends:

- `CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND`
  - controls the raw HTML artifact backend
- `CONTROL_PLANE_DOWNLOADABLE_OUTPUT_BACKEND`
  - controls where `downloadable_json` structured outputs are written
- both support:
  - `local_filesystem`
  - `gcs`
- operators do not configure bucket, prefix, or local path details in the control-plane UI

Database selection:

- `MONGODB_DB_NAME` if explicitly set
- otherwise `JOB_COMPASS_DB_PREFIX`

Control-plane state:

- file-backed resources live under `CONTROL_PLANE_DATA_DIR`
- brokered handoff events live under `CONTROL_PLANE_BROKER_DIR`
- bootstrap search spaces are imported from `CONTROL_PLANE_BOOTSTRAP_SEARCH_SPACES_DIR`

## Development

```bash
pnpm -C apps/ops-control-plane dev
```

App-local `dev`, `build`, `start`, `check-types`, and `test` commands first build the shared
workspace contract packages so they do not depend on pre-existing `dist/` artifacts.

## Validation

```bash
pnpm -C apps/ops-control-plane lint
pnpm -C apps/ops-control-plane check-types
pnpm -C apps/ops-control-plane build
pnpm -C apps/ops-control-plane test
pnpm -C apps/ops-control-plane test:e2e
```

## Design Notes

- Visual language follows a "Swiss Authority meets Lab Report" system: dark canvas, flat surfaces, hard borders, and no ornamental depth.
- Primary copy uses Neue Haas / Helvetica Now style fallbacks for headlines and body text.
- Metadata, metrics, UUIDs, tables, timestamps, and JSON traces use IBM Plex Mono with tabular numerals.
- Control-plane run payloads and normalized JSON outputs are opened through accordion-style inspectors instead of soft, always-open dumps.
- Charts are implemented with `recharts`.
