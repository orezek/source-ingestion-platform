# Changelog

All notable changes to `job-compass-chat` are documented in this file.

The format is based on Keep a Changelog principles and uses Semantic Versioning.

## [1.0.0] - 2026-03-01

### Added

- Initial release of `job-compass-chat` as a terminal-first LangGraph planning playground.
- Planner-router architecture with three deterministic worker nodes:
  - addition/subtraction
  - multiplication/division
  - percentage operations
- Structured planner observability rendered in a terminal UI.
- Local markdown prompt at `prompts/planner-router.md`.
- Gemini planner backend with deterministic heuristic fallback for tests and offline runs.
- Unit, integration, and CLI e2e tests.
