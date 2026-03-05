# Spec: `run-observability-dashboard`

## Status

- Owner: JobCompass observability tooling
- Scope: `apps/run-observability-dashboard`
- Mode: internal operator dashboard + control plane
- Lifecycle: v1 completed (2026-03-05)

## Purpose

`run-observability-dashboard` provides the v1 operator surface for crawler and ingestion operations.

It answers:

- what ran
- what succeeded or failed
- where the pipeline lost jobs
- how much time, token usage, and cost each run consumed
- how operators configure and execute pipelines end-to-end

## Product Levels

### Level 1: Overview (`/`)

Provides:

- environment/database context
- KPI strip for recent activity
- charts for status, success rate, outcomes, and token/cost trends
- recent crawler runs table
- recent ingestion runs table
- anomaly panel

### Level 2: Detail Views

Routes:

- `/crawler/runs/[crawlRunId]`
- `/ingestion/runs/[runId]`
- `/pipeline/[crawlRunId]`

These views expose raw counters, run metadata, non-success audit rows, and derived handoff diagnostics.

### Level 3: Control Plane (`/control-plane`)

Provides:

- pipeline management and run start operations
- search-space management
- runtime profile management
- structured output destination management
- run detail operation panels (events, logs, artifacts, outputs)

## Data Sources

Primary collections:

- `crawl_run_summaries`
- `ingestion_run_summaries`

Optional supporting collection:

- `ingestion_trigger_requests`

## Runtime Modes

### `mongo`

Uses live MongoDB reads for all pages.

### `fixture`

Uses JSON fixture files from `DASHBOARD_FIXTURE_DIR`.

This mode is intended for:

- local UI development
- unit/integration tests
- Playwright E2E tests

## Architecture

- Next.js App Router
- Server Components by default
- Client Components only for charts
- Typed environment parsing via `@repo/env-config` + `zod`
- Server-only repository layer for Mongo/fixture data access
- Mapper layer from raw summary docs to UI DTOs

## DTOs

Primary UI-facing DTOs:

- `CrawlerRunSummaryView`
- `IngestionRunSummaryView`
- `PipelineRunSummaryView`
- `OverviewDashboardView`

The UI must render DTOs, not raw Mongo documents.

## Visual System

- Design language: Swiss Authority meets Lab Report
- Theme: dark operator canvas with structured surfaces and zero-shadow depth
- Typography split:
  - primary: `var(--font-primary)` for navigation, headings, and body copy
  - secondary: `var(--font-secondary)` for metadata, identifiers, table data, logs, and JSON
- Interaction model:
  - precision hover/active states
  - explicit keyboard focus rings
  - structural loading skeletons

## Charts

Library:

- `recharts`

Overview charts:

- crawler status trend
- ingestion success rate trend
- ingestion processed/skipped/failed stacked bars
- crawler new/existing/inactive bars
- cost/tokens trend

## Testing

### Unit

- time range parsing
- summary mappers
- derived pipeline mismatch logic

### Integration

- overview data assembly from repository layer
- pipeline detail assembly from linked summaries

### E2E

- overview page render
- crawler detail route
- ingestion detail route
- pipeline detail route
- fixture mode server startup

## Non-goals

- no mutations or admin actions
- no retry endpoints
- no websocket/live streaming
- no direct binding of UI to raw database document shape
