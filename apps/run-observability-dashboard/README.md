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
- `/crawler/runs/[crawlRunId]` crawler run detail
- `/ingestion/runs/[runId]` ingestion run detail
- `/pipeline/[crawlRunId]` linked pipeline detail

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

## Development

```bash
pnpm -C apps/run-observability-dashboard dev
```

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
