# Spec: Control Plane v1 Release Summary

## Status

- release-summary
- release: v1.1.0
- date: 2026-03-05

## Purpose

Capture what was delivered and merged for crawler + ingestion control plane v1.

## Delivered Scope

### Platform and Domain

- Centralized control plane modeled in Next.js with API-backed management.
- Control-plane contract and adapter packages added for stable boundaries:
  - `@repo/control-plane-contracts`
  - `@repo/control-plane-adapters`
- Local and cloud-capable adapter seams added for broker and managed storage.

### Operator Workflows

- Manage search spaces, runtime profiles, pipelines, and structured outputs.
- Start and operate runs from the control plane.
- Browse run artifacts and structured output captures from the UI.
- Inspect worker logs and event history from run detail pages.

### Execution and Safety

- Immutable run-manifest based execution flow.
- Local CLI execution hardening and lifecycle reliability fixes.
- Historical-reference-aware delete semantics for managed resources.
- Deterministic naming and length-constraint enforcement for derived storage identifiers.

### UX and Design System

- Unified "Lab Report" visual system across dashboard and control plane.
- Layout containment and grid/flex architecture for readability and density.
- Empty-state normalization.
- Precision interaction layer (hover/active/focus) and loading skeletons.
- Persistent app shell with sidebar navigation and dynamic breadcrumbs.

## Reference Specs

- `docs/specs/crawler-ingestion-control-plane-v1.md`
- `docs/specs/control-plane-domain-api-v1.md`
- `docs/specs/pipeline-events-sinks-v1.md`
- `docs/specs/ops-control-plane.md`

## Follow-up

- Naming and prefix cleanup captured for v2 scope in:
  - `docs/specs/crawler-ingestion-control-plane-v2.md`
