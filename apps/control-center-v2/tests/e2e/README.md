# Create Pipeline E2E Baseline

This suite validates the `/pipelines/new` form as an internet-facing operator surface.

Principles:

- Tests run in headed mode (`headless: false`) for visual debugging.
- Tests mock `POST /api/pipelines` to validate UI behavior without depending on control-service.
- Tests explicitly assert no run execution endpoint is called.

Scenario directories:

- `01-required-fields`
- `02-min-safe-limits`
- `03-max-safe-limits`
- `04-max-items-upper-bound`
- `05-crawler-concurrency-range`
- `06-crawler-rpm-range`
- `07-ingestion-mode-gating`
- `08-start-urls-validation`
- `09-mongodb-uri-validation`
- `10-mongodb-dbname-validation`
