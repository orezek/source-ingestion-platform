# Documentation Index

This directory contains design and implementation documentation for the JobCompass pipeline.

## Start Here

- System integration spec (crawler + ingestion MVP flow): `docs/specs/incremental-crawler-ingestion-monolith.md`

## App Docs

### `jobs-crawler-actor`

- App README (operator/developer usage): `apps/jobs-crawler-actor/README.md`
- App spec (architecture and data flow): `docs/specs/jobs-crawler-actor.md`
- App changelog (features/fixes): `apps/jobs-crawler-actor/CHANGELOG.md`

### `jobs-ingestion-service`

- App README (pipeline, API, operations): `apps/jobs-ingestion-service/README.md`
- App spec (contracts, pipeline semantics, Mongo responsibilities): `docs/specs/jobs-ingestion-service.md`
- App changelog (parser versions and behavior changes): `apps/jobs-ingestion-service/CHANGELOG.md`

### `job-compass-chat`

- App README (runtime usage, env, TUI behavior): `apps/job-compass-chat/README.md`
- App spec (planner/worker graph, observability, testing): `docs/specs/job-compass-chat.md`
- App changelog (feature and workflow history): `apps/job-compass-chat/CHANGELOG.md`

## Related Top-Level Docs

- Root repo changelog: `CHANGELOG.md`
- Root workspace docs: `README.md`
- Root agent/repo operating rules: `AGENTS.md`

## Suggested Reading Order (New Contributors)

1. `docs/specs/incremental-crawler-ingestion-monolith.md`
2. `docs/specs/jobs-crawler-actor.md`
3. `docs/specs/jobs-ingestion-service.md`
4. `docs/specs/job-compass-chat.md`
5. `apps/jobs-crawler-actor/README.md`
6. `apps/jobs-ingestion-service/README.md`
7. `apps/job-compass-chat/README.md`
