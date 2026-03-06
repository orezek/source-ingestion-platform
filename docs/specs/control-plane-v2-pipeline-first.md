# Spec Draft: Control Plane Pipeline-First Model v2

## Status

- draft
- canonical control-plane revamp direction for v2
- supersedes the v1 component-first operating model for future implementation work

## Purpose

Define the v2 control-plane domain model where the pipeline is the primary production boundary.

This replaces the current permissive component registry model, where search spaces, runtime
profiles, and structured output destinations can be edited independently and then recombined in
ways that break lineage and data isolation.

## Problem Statement

The current model is too permissive for a production data pipeline.

Main failure modes:

- a pipeline can drift semantically after creation
- changing `searchSpaceId` on an existing pipeline contaminates the same `normalized_job_ads`
  dataset with a different crawl universe
- inactive marking becomes invalid because crawler reconciliation no longer compares against a
  stable scope
- global editing of source/search space/runtime/output resources weakens auditability and replay

## Core Decision

In v2, the pipeline is the authoritative aggregate.

That means:

- operators create a pipeline first
- the pipeline owns one resolved source configuration
- the pipeline owns one resolved search space configuration
- the pipeline owns one resolved runtime profile configuration
- the pipeline owns one resolved structured output configuration
- the pipeline owns one logical production database

The pipeline is not a loose pointer set to mutable shared resources.

## Core Terms

- pipeline = stable definition and production boundary
- run = one execution instance of that pipeline

Examples:

- one pipeline can produce many runs over time
- `control_plane_pipelines` stores pipeline definitions
- `control_plane_runs` stores run-state projections for those executions

## Pipeline Aggregate

### Required Identity

- `id`
- `name`
- `version`
- `source`
- `dbName`
- `status`
- `createdAt`
- `updatedAt`

### Owned Configuration Snapshots

- `searchSpace`
- `runtimeProfile`
- `structuredOutput`
- `schedule` (when scheduling is enabled)

These are embedded pipeline-owned snapshots, not authoritative references to globally editable
resources.

## Immutability Rules

After pipeline creation, the following fields are immutable:

- `source`
- `searchSpace`
- `runtimeProfile`
- `structuredOutput`
- `dbName`

After pipeline creation, the following fields remain mutable:

- `name`
- `schedule`
- operational state (`active`, `paused`, `stopped`, `deleted`)

v2 rule:

- if the operator needs a different source, search scope, runtime, or structured output contract,
  they must create a new pipeline

## Database Ownership

Each pipeline owns one logical database.

Within that database, the canonical collection names remain fixed:

- `crawl_run_summaries`
- `ingestion_run_summaries`
- `normalized_job_ads`

Consequences:

- crawler reconciliation and inactive marking always operate against the same pipeline-owned
  `normalized_job_ads` collection
- changing the search scope of an existing pipeline is forbidden because it would corrupt that
  dataset boundary

## Control-Plane Persistence Model

### Authoritative Collections

- `control_plane_pipelines`
- `control_plane_runs`
- `control_plane_run_manifests`
- `control_plane_run_event_index`
- `control_plane_bootstrap_profiles`

These are MongoDB collections in the control-plane database.

Projection roles:

- `control_plane_runs` stores one current-state projection document per run
- `control_plane_run_event_index` stores many event-history documents per run

### Removed As First-Class Runtime Resources

These should no longer be authoritative editable resources for live pipelines:

- `control_plane_search_spaces`
- `control_plane_runtime_profiles`
- `control_plane_structured_output_destinations`

If presets/templates are added later, they are creation aids only and must not be the runtime
source of truth for an already-created pipeline.

## Operator Workflow

### Create Pipeline

The operator creates a pipeline through one pipeline-centric flow:

1. enter pipeline name
2. choose source
3. define the search space inside the pipeline flow
4. define crawler/ingestion runtime settings inside the pipeline flow
5. define structured output settings inside the pipeline flow
6. save the pipeline

On save:

- the control plane freezes the pipeline-owned config snapshot
- the control plane assigns the pipeline database name
- the control plane persists the pipeline aggregate

### Manage Pipeline

After creation, the operator can:

- rename the pipeline
- configure scheduling
- pause the pipeline
- stop current activity
- delete the pipeline

The operator cannot edit the pipeline's execution identity.

## Run Orchestration

When a run is started:

- the control plane resolves the pipeline aggregate into immutable worker commands
- the run manifest stores the full pipeline-owned snapshot for replay and audit
- worker-facing `StartRun` payloads contain only the resolved execution data each worker needs

Worker commands must not depend on reading mutable configuration resources at execution time.

## API Shape

Primary control-plane write resources in v2:

- `POST /pipelines`
- `GET /pipelines`
- `GET /pipelines/{pipelineId}`
- `PATCH /pipelines/{pipelineId}` for allowed mutable fields only
- `POST /pipelines/{pipelineId}/pause`
- `POST /pipelines/{pipelineId}/resume`
- `POST /pipelines/{pipelineId}/runs`
- `DELETE /pipelines/{pipelineId}`

Not part of the primary v2 runtime API:

- standalone CRUD for live search spaces
- standalone CRUD for live runtime profiles
- standalone CRUD for live structured output destinations

## UI Implications

The control plane should move from component management screens to a pipeline-first experience.

Recommended UI direction:

- one pipeline creation workflow
- one pipeline list/detail surface
- no global "manage search spaces/runtime profiles/structured outputs" screens for live runtime
  config

## Consequences For Worker Design

Crawler and ingestion workers can now assume:

- `pipelineId` identifies a stable production dataset contract
- `runId` identifies one execution instance of that pipeline
- the pipeline-owned database boundary is stable for the lifetime of the pipeline
- worker reconciliation logic is valid because the pipeline identity cannot drift

## Non-Goals

Not part of this v2 revamp:

- multi-pipeline composition graphs
- user-editable shared runtime components for live pipelines
- mutable source/search-space swaps on an existing pipeline
- retroactive migration of existing v1 pipelines in place without explicit operator review
