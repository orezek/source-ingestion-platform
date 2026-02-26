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

## Related Top-Level Docs

- Root repo changelog: `CHANGELOG.md`
- Root workspace docs: `README.md`
- Root agent/repo operating rules: `AGENTS.md`

## Suggested Reading Order (New Contributors)

1. `docs/specs/incremental-crawler-ingestion-monolith.md`
2. `docs/specs/jobs-crawler-actor.md`
3. `docs/specs/jobs-ingestion-service.md`
4. `apps/jobs-crawler-actor/README.md`
5. `apps/jobs-ingestion-service/README.md`
