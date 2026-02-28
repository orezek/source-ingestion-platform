# Changelog (`jobs-crawler-actor`)

All notable changes to `apps/jobs-crawler-actor` should be documented in this file.

The app package version is currently `1.0.0` (see `package.json`). This changelog tracks feature evolution and operational behavior changes even when the package version is not bumped on every internal improvement.

## [Unreleased]

### Changed

- Replaced the separate crawl-state model with a single trusted state collection: `normalized_job_ads`.
- Phase one now reconciles live listing coverage directly against existing normalized docs.
- Phase two now fetches detail HTML only for jobs missing from `normalized_job_ads`.
- Ingestion handoff is now asynchronous and per-item via `POST /ingestion/item` after artifact persistence.
- Removed the crawler-side dependency on `crawl_job_states`.

### Fixed

- Actor input throttling controls are now applied at runtime:
  - `maxConcurrency`
  - `maxRequestsPerMinute`
- These limits now affect both list and detail crawl phases.

### Changed

- The crawler now resolves canonical crawl config from `searchSpaceId` at runtime.
- Local helper scripts were removed:
  - `prepare:input`
  - `start:local`
  - `start:prod`
  - `start:dev`
  - `dev`
- Operator flow is now:
  - `pnpm -C apps/jobs-crawler-actor start -- --search-space <id>`
- Expanded `.actor/input_schema.json` to include:
  - `maxConcurrency`
  - `maxRequestsPerMinute`
- Expanded `.env.example` documentation with per-variable operational comments and explicit note that crawl throttling is input-driven (not env-driven).

### Documentation

- Added detailed README and app-specific architecture spec for operators and contributors.

## [1.0.0] - Current Baseline

### Added

- Jobs.cz list-page crawling with pagination and typed listing extraction.
- Detail-page crawling with rendered HTML snapshots (`job-html-<sourceId>.html`).
- Support for dynamic employer `*.jobs.cz` pages (widget/capybara and vacancy-detail patterns).
- Detail snapshot metadata in dataset records:
  - requested vs final detail URL
  - redirect host
  - render type/signal
  - render wait time / text chars
  - HTML byte size and SHA-256
- Crawl run summary written to Crawlee KV store (`RUN_SUMMARY`).
- Optional MongoDB crawl run summary sink (`crawl_run_summaries`).
- Incremental crawl reconciliation using `crawl_job_states` (new vs existing + inactive marking guard rails).
- Local MVP handoff to `jobs-ingestion-service/scrapped_jobs/runs/<crawlRunId>/`.
- Optional ingestion trigger to `jobs-ingestion-service` Fastify API (`POST /ingestion/start`).
- Configurable crawl pacing (runtime input): `maxConcurrency`, `maxRequestsPerMinute`.

### Changed

- `maxItems` semantics align with "job ads/detail pages" instead of total requests.
- Details are saved only when HTML snapshot persistence succeeds (prevents dangling references).
- Missing local Apify input error now points explicitly to the expected `INPUT.json` path and `CRAWLEE_STORAGE_DIR` usage.

### Fixed

- Dynamic detail-page readiness checks for multiple employer templates (including vacancy-detail and widget/capybara variants).
- False render timeouts caused by secondary template loaders (e.g. similar-vacancies loaders inside `#vacancy-detail`).
- Redirect observability: crawler now records/logs requested URL vs final loaded URL.
- Missing or unknown `searchSpaceId` now fails fast with an explicit error and a list of available search spaces.

## Versioning Notes

- `package.json` version tracks app package metadata.
- Crawl output schema and run-summary fields may evolve without an immediate package version bump if the repository does not use per-app release tags yet.
