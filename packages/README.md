# Monorepo Packages

Shared packages in `packages/` provide reusable configuration and runtime utilities for apps in this repository.

## Current Packages

| Directory                          | Package Name                    | Purpose                                                  |
| ---------------------------------- | ------------------------------- | -------------------------------------------------------- |
| `packages/env-config`              | `@repo/env-config`              | Typed environment parsing with `zod`.                    |
| `packages/eslint-config`           | `@repo/eslint-config`           | Shared ESLint Flat Config presets.                       |
| `packages/control-plane-contracts` | `@repo/control-plane-contracts` | Shared control-plane manifests and broker event schemas. |
| `packages/typescript-config`       | `@repo/typescript-config`       | Shared TypeScript base configurations.                   |

## Package Management Rules

- Use `pnpm` only.
- Use `workspace:*` for internal package dependencies.
- Use `catalog:` for shared external dependencies defined in `pnpm-workspace.yaml`.
- Run installs from repository root: `pnpm install`.

## Consuming Internal Packages

Add internal packages to app/package `package.json` using `workspace:*`.

Example:

```json
{
  "dependencies": {
    "@repo/env-config": "workspace:*"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*"
  }
}
```

## Creating a New Package

1. Create a new directory in `packages/`.
2. Use scope `@repo/<name>` in `package.json`.
3. Keep package `private: true` unless there is explicit publishing intent.
4. Use shared configs and scripts aligned to repository standards.

Recommended baseline:

```json
{
  "name": "@repo/<name>",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.13.1",
  "engines": { "node": ">=24" },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -w -p tsconfig.json",
    "lint": "eslint . --max-warnings 0",
    "check-types": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:"
  }
}
```

`tsconfig.json` should usually extend one of:

- `@repo/typescript-config/node-lib.json`
- `@repo/typescript-config/react-library.json`

## Validation

From repo root:

```bash
pnpm lint
pnpm check-types
pnpm build
```
