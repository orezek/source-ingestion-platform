# Changelog

All notable changes to `omni-crawl-chat` are documented in this file.

The format is based on Keep a Changelog principles and uses Semantic Versioning.

## [Unreleased]

### Fixed

- Replaced the Gemini planner response schema sent to Google with a provider-safe flat schema and kept strict internal validation after conversion, fixing runtime failures caused by unsupported `const` fields in generated JSON Schema.

## [1.0.0] - 2026-03-01

### Added

- Initial release of `omni-crawl-chat` as a terminal-first LangGraph planning playground.
- Planner-router architecture with three deterministic worker nodes:
  - addition/subtraction
  - multiplication/division
  - percentage operations
- Structured planner observability rendered in a terminal UI.
- Local markdown prompt at `prompts/planner-router.md`.
- Gemini planner backend with deterministic heuristic fallback for tests and offline runs.
- Unit, integration, and CLI e2e tests.
