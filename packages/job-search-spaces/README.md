# @repo/job-search-spaces

Shared search-space schemas and runtime helpers for OmniCrawl apps.

## Responsibilities

- validate named search-space configuration files
- validate operator-facing actor input keyed by `searchSpaceId`
- resolve full runtime crawl input from canonical search-space config
- derive per-search-space Mongo database names
- validate runtime search-space identifiers

## Core API

- `searchSpaceConfigSchema`
- `actorOperatorInputSchema`
- `resolvedActorRuntimeInputSchema`
- `buildActorInputFromSearchSpace(...)`
- `deriveMongoDbName(...)`
