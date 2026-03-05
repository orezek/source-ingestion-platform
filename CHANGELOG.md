# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog principles and uses Semantic Versioning.

## [1.1.0] - 2026-03-05

### Added

- Completed and merged the control-plane v1 slice into `main`.
- Added centralized control-plane management in `ops-control-plane`:
  - pipeline, runtime profile, search space, and structured-output management
  - run start/operate flows with run details, artifact browser, and structured output browser
  - global app shell with persistent sidebar and dynamic breadcrumbs
- Added event and worker log inspectors with readable formatting and live-refresh support.
- Added local and Google Cloud adapter boundaries for broker and managed storage backends.

### Changed

- Unified dashboard and control-plane UI under the Lab Report design language.
- Enforced layout containment, responsive grid structure, compact form controls, and scrollable large history/log regions.
- Standardized empty states, interaction states, and loading skeletons for operational pages.
- Finalized v1 docs/spec baseline and bumped root package version from `1.0.4` to `1.1.0`.

### Commit Summary

- `89ee291` Merge branch `feat/control-plane-v1-slice`

## [1.0.4] - 2026-02-11

### Changed

- Added explicit agent operating rules in `AGENTS.md`, including:
  - definition of done expectations
  - formatting/lint/typecheck enforcement by change type
  - release metadata synchronization policy
- Bumped root package version from `1.0.3` to `1.0.4`.
- Updated root README release label to `v1.0.4`.

### Commit Summary

- `14a495d` docs(agents): add operating rules and done criteria

## [1.0.3] - 2026-02-11

### Added

- Added retrospective `CHANGELOG.md` entries covering all changes since `v1.0.0`.

### Changed

- Bumped root package version from `1.0.1` to `1.0.3`.
- Updated root README release label to `v1.0.3` to match package metadata.

## [1.0.2] - 2026-02-11

### Changed

- Aligned workshop guidance for humans and LLMs across root/app/package docs.
- Added and enforced CI workflow checks (`lint`, `types`, `build`) with branch protection snapshots.
- Standardized scaffold-first app creation guidance and app-level agent inheritance behavior.
- Aligned GitFlow branch naming guidance and release branch conventions.
- Cleaned repository bookkeeping around generated runtime artifacts.

### Commit Summary

- `db604f8` docs(agents): align ai assistant guidance with repo standards
- `b2346c4` docs(scaffold): clarify scaffold-first workflow and manual fallback
- `084201a` chore(workflow): align workshop docs, ci, and branch protection
- `02fbd7e` chore(repo): stop tracking turbo runtime artifacts
- `3b8fcd1` chore(workshop): align guidance, metadata, and release rules

## [1.0.1] - 2026-02-07

### Changed

- Updated root package version to `1.0.1`.
- Improved repository tooling compatibility around ESM and commit hooks.
- Fixed module/tooling mismatch and `.gitignore` entries for generated output.
- Normalized AI assistant rules formatting and synchronized workspace lockfile/build artifacts.

### Commit Summary

- `5fe7ae2` chore: fix aiassitant/rules.md file
- `03727e3` fix: include to .gitignore dist dirs
- `a74b3f1` fix: fix module mismatch to modern ecma script
- `9ee75b0` fix(tooling): make commitlint config ESM and use local commitlint in husky hook
- `e0c1d31` chore(aiassistant): normalize rules markdown formatting
- `572fbef` chore(env-config): refresh generated build artifacts
- `432592c` chore(lockfile): sync workspace importers and TypeScript resolution
- `cc8aa2d` chore(release): bump version to 1.0.1

## [1.0.0] - 2026-01-10

### Added

- Initial release of the monorepo walking skeleton with Turborepo, pnpm workspaces/catalogs, shared TypeScript/ESLint config packages, and baseline app/package structure.
