# Run Observability Dashboard

`run-observability-dashboard` is an internal Next.js dashboard for operational visibility into JobCompass crawler and ingestion runs.

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
- `/crawler/runs/[crawlRunId]` crawler run detail
- `/ingestion/runs/[runId]` ingestion run detail
- `/pipeline/[crawlRunId]` linked pipeline detail
- `/api/control-plane/[resource]` JSON API for local control-plane resources and run starts

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

Database selection:

- `MONGODB_DB_NAME` if explicitly set
- otherwise `JOB_COMPASS_DB_PREFIX`

Control-plane state:

- file-backed resources live under `CONTROL_PLANE_DATA_DIR`
- brokered handoff events live under `CONTROL_PLANE_BROKER_DIR`
- bootstrap search spaces are imported from `CONTROL_PLANE_BOOTSTRAP_SEARCH_SPACES_DIR`

## Development

```bash
pnpm -C apps/run-observability-dashboard dev
```

App-local `dev`, `build`, `start`, `check-types`, and `test` commands first build the shared
workspace contract packages so they do not depend on pre-existing `dist/` artifacts.

## Validation

```bash
pnpm -C apps/run-observability-dashboard lint
pnpm -C apps/run-observability-dashboard check-types
pnpm -C apps/run-observability-dashboard build
pnpm -C apps/run-observability-dashboard test
pnpm -C apps/run-observability-dashboard test:e2e
```

## Design Notes

- Primary type stack uses Neue Haas / Helvetica Now style fallbacks for quiet, dense editorial typography.
- Mono labels and metrics use IBM Plex Mono.
- Visual language is restrained, matte, and data-forward.
- Charts are implemented with `recharts`.
