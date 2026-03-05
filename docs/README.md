# Documentation Index

This directory contains design and implementation documentation for the JobCompass pipeline.

## Start Here

- System integration spec (crawler + ingestion MVP flow): `docs/specs/incremental-crawler-ingestion-monolith.md`
- Next-generation architecture brief (control plane + workers): `docs/specs/crawler-ingestion-control-plane-v1.md`
- Control-plane domain model and API contract: `docs/specs/control-plane-domain-api-v1.md`
- Event contracts and sink adapters: `docs/specs/pipeline-events-sinks-v1.md`
- Crawler worker adaptation plan: `docs/specs/crawler-worker-adaptation-v1.md`
- Ingestion worker adaptation plan: `docs/specs/ingestion-worker-adaptation-v1.md`
- Deferred follow-up scope after v1: `docs/specs/crawler-ingestion-control-plane-v2.md`

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

### `ops-control-plane`

- App README (operator usage, routes, env): `apps/ops-control-plane/README.md`
- App spec (dashboard/control-plane IA and UI contract): `docs/specs/ops-control-plane.md`
- App changelog (release and fix history): `apps/ops-control-plane/CHANGELOG.md`

## Related Top-Level Docs

- Root repo changelog: `CHANGELOG.md`
- Root workspace docs: `README.md`
- Root agent/repo operating rules: `AGENTS.md`

## Suggested Reading Order (New Contributors)

1. `docs/specs/incremental-crawler-ingestion-monolith.md`
2. `docs/specs/crawler-ingestion-control-plane-v1.md`
3. `docs/specs/control-plane-domain-api-v1.md`
4. `docs/specs/pipeline-events-sinks-v1.md`
5. `docs/specs/crawler-worker-adaptation-v1.md`
6. `docs/specs/ingestion-worker-adaptation-v1.md`
7. `docs/specs/crawler-ingestion-control-plane-v2.md`
8. `docs/specs/jobs-crawler-actor.md`
9. `docs/specs/jobs-ingestion-service.md`
10. `docs/specs/job-compass-chat.md`
11. `apps/jobs-crawler-actor/README.md`
12. `apps/jobs-ingestion-service/README.md`
13. `apps/job-compass-chat/README.md`
14. `docs/specs/ops-control-plane.md`
15. `apps/ops-control-plane/README.md`
