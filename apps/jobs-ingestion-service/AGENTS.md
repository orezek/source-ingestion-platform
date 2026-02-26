# App Template Agent Instructions

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

- Preserve script conventions in the local app `package.json`: `build` -> `tsc`.
- Preserve script conventions in the local app `package.json`: `start` -> `node dist/app.js`.
- Preserve script conventions in the local app `package.json`: `dev` -> `tsx watch src/app.ts`.
- Keep dependency style aligned with repo standards: internal packages as `workspace:*`.
- Keep dependency style aligned with repo standards: external shared dependencies as `catalog:`.
- Maintain TypeScript config inheritance via `@repo/typescript-config/node-lib.json`.
- Keep ESLint flat config extending `@repo/eslint-config`.
- Keep env loading type-safe through `@repo/env-config` + schema validation.

## Template-Maintenance Rule

- If this file is located at `apps/app-template/AGENTS.md`, keep the app reusable as a scaffold template and do not delete `apps/app-template`.

## When Updating This Template

- Ensure changes are template-safe and reusable by newly scaffolded apps.
- If this file is located in `apps/app-template`, update `apps/app-template/README.md` when behavior or usage changes.
- Avoid adding app-specific business logic that would not generalize to new apps.
