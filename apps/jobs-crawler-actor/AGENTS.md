# Job Compass Actor Agent Instructions

These instructions are app-local extensions of the repository root rules.

## Inheritance (Mandatory)

- Always apply root `AGENTS.md` first.
- Always apply `.aiassistant/rules/monorepo.md`.
- This file may add stricter local constraints but must not weaken root rules.
- If this file conflicts with root rules, root rules win.

## Scope

- This file applies to the app directory that contains this file (`./**`).
- Do not treat these rules as global to other apps or packages.

## App-Specific Constraints

- Preserve the current runtime entrypoint unless explicitly requested to refactor:
  - `build` -> `tsc`
  - `start` -> `node ./dist/main.js`
  - `dev` -> `tsx watch src/main.ts`
- Keep Apify actor metadata in `.actor/**` consistent with app behavior when changing scripts, Dockerfile, or README.
- Keep dependency style aligned with repo standards: internal packages as `workspace:*`.
- Keep dependency style aligned with repo standards: external shared dependencies as `catalog:`.
- Maintain TypeScript config inheritance via `@repo/typescript-config/node-lib.json`.
- Keep ESLint flat config extending `@repo/eslint-config`.
- Keep env loading type-safe through `@repo/env-config` + schema validation.

## Runtime Note

- This app is designed for Apify actor images and currently targets a Node 20 runtime there.
- Do not change the runtime image or Node compatibility level unless explicitly requested.
