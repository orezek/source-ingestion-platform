# Run Observability Dashboard Agent Instructions

These instructions are app-local extensions of the repository root rules.

## Inheritance (Mandatory)

- Always apply root `AGENTS.md` first.
- Always apply `.aiassistant/rules/monorepo.md`.
- This file may add stricter local constraints but must not weaken root rules.
- If this file conflicts with root rules, root rules win.

## Scope

- This file applies to this app directory (`./**`).

## App-Specific Constraints

- Preserve the Next.js runtime and App Router architecture unless explicitly requested.
- Default to Server Components; use Client Components only where interactivity or charting requires it.
- Keep Mongo reads server-only.
- Do not read `process.env` directly in components; use typed env parsing in server modules.
- Keep the app read-only for MVP. No mutation endpoints or admin actions unless explicitly requested.
- Maintain the visual system: quiet sans headlines/body, mono labels/data, muted laboratory palette, dense information layout.

## Data Contracts

- Primary collections:
  - `crawl_run_summaries`
  - `ingestion_run_summaries`
- Optional supporting collection:
  - `ingestion_trigger_requests`
- UI must map raw documents into dashboard DTOs before rendering.

## Testing Expectations

- Unit tests for derived metrics and mappers.
- Integration tests for repository/service data assembly.
- E2E tests for overview/detail navigation using fixture mode.
