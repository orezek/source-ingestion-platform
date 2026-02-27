# Changelog (`jobs-ingestion-service`)

All notable changes to `apps/jobs-ingestion-service` should be documented in this file.

This app has two relevant version identifiers:

- package version (`package.json`): currently `1.0.2`
- parser version (`PARSER_VERSION`, written into ingestion metadata): currently `jobs-ingestion-service-v0.9.0`

The parser version is the operational identifier used in `normalized_job_ads` and `ingestion_run_summaries`.

## [Unreleased]

### Documentation

- Added detailed README and app-specific architecture spec for operators and contributors.
- Added app-level changelog with parser-version notes.
- Formalized MVP run-profile conventions (`prod_full`, `dev_sample`) in env examples and operator docs.

### Changed

- Added dual raw text snapshots in `normalized_job_ads.rawDetailPage`:
  - `loadDetailPageText` (step-1 static extraction)
  - `cleanDetailText` (step-2 LLM cleaner output)
- Added per-node and total LLM telemetry:
  - cleaner stats
  - extractor stats
  - combined total stats
- Run summaries now include cleaner/extractor/total telemetry blocks and totals across both LLM nodes.
- Prompt env convention updated:
  - `LLM_EXTRACTOR_PROMPT_NAME` (default `jobcompass-job-ad-structured-extractor`)
  - `LLM_CLEANER_PROMPT_NAME` (default `jobcompass-job-ad-text-cleaner`)
- Removed legacy prompt env aliases (`LANGSMITH_PROMPT_NAME`, `LANGSMITH_CLEANER_PROMPT_NAME`) to keep configuration explicit and deterministic.

## [jobs-ingestion-service-v0.9.0] - Current Parser Baseline

### Added

- Persisted both step-1 and step-2 text snapshots in `rawDetailPage`.
- Cleaner LLM telemetry capture (tokens/cost/duration) and ingestion-level aggregation.

### Changed

- Prompt defaults updated to:
  - `jobcompass-job-ad-text-cleaner`
  - `jobcompass-job-ad-structured-extractor`
- `ingestion_run_summaries` now report cleaner/extractor/total LLM usage separately and in aggregate.

## [jobs-ingestion-service-v0.8.0]

### Added

- Top-level `crawlRunId` field in `normalized_job_ads` for crawler-run traceability (when known).

### Changed

- `loadDetailPage` internals refactored into smaller deterministic helpers for readability and maintainability without changing external behavior.
- Ingestion trigger flow now propagates `crawlRunId` into normalized documents in Fastify-triggered runs.

## [jobs-ingestion-service-v0.7.0]

### Fixed

- Replaced brittle whole-page completeness gating with a structural-first validation approach for detail pages.
- Valid Alma/Capybara employer pages are now accepted based on primary job-content containers (for example `.cp-detail__content`, `#capybara-position-detail`) before fallback heuristics.
- Reduced false `jobsSkippedIncomplete` outcomes on custom employer templates with heavy cookie/footer/legal noise.

### Added

- Structural completeness signals in skipped-job audit payloads:
  - `hasPrimaryJobContentContainer`
  - `primaryJobContentContainerSelector`
  - `primaryJobContentChars`
  - `primaryJobContentWords`

## [jobs-ingestion-service-v0.6.0]

### Added

- Idempotent Fastify ingestion trigger API (`POST /ingestion/start`) keyed by `source + crawlRunId`.
- Trigger lifecycle persistence in `ingestion_trigger_requests`.
- Local crawl-run handoff support using `scrapped_jobs/runs/<crawlRunId>/`.
- Crawl-state alignment maintenance command: `align-crawl-state`.

### Changed

- Parser version default bumped to `v0.6.0` as part of the trigger/integration milestone.

## [jobs-ingestion-service-v0.5.0]

### Changed

- Standardized extraction fields for analytics stability (for example seniority and recruiter-contact field naming improvements).
- Improved schema descriptions and extraction guidance quality.

## [jobs-ingestion-service-v0.4.0]

### Added

- LangSmith Hub prompt integration for extraction workflow (`job-ad-extractor`).
- Richer ingestion/cost telemetry captured in run summaries and document metadata.

## [1.0.0] - Package Baseline

### Added

- Batch ingestion pipeline for local scraped jobs dataset (`dataset.json` + `records/*.html`).
- LangGraph-based extraction pipeline with Gemini structured output.
- Mongo persistence for normalized job documents.
- Run summaries and cost/token tracking.
- Cheerio-based HTML loading and plain-text preparation.

## Versioning Notes

- Prefer `PARSER_VERSION` as the operational release marker for parser behavior changes.
- Keep `package.json` version aligned with app packaging/runtime changes (scripts, dependencies, runtime interfaces).
