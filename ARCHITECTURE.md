# Monorepo Walking Skeleton (v1.1.0)

A robust, minimal foundation for scalable Node.js applications. This repository serves as a "walking skeleton"—a tiny, fully functional vertical slice of a system that proves the architecture is sound.

It comes pre-configured with a comprehensive suite of modern tooling to ensure code quality, consistency, and developer ergonomics from day one.

## 🛠 Architecture & Design Decisions

This repository is not just a collection of files; it is an opinionated engineering system. Below is the breakdown of the technology choices, why they were selected, and how they contribute to stability.

### 1. The Monorepo Engine

- **Runtime:** [Node.js](https://nodejs.org/) (v24+)
- _Why:_ The industry standard for server-side JavaScript. We enforce version consistency via `.node-version` and `fnm`.

- **Package Manager:** [pnpm](https://pnpm.io/) (with Workspaces & Catalogs)
- _Why:_ `pnpm` is significantly faster and more disk-efficient than npm/yarn due to its content-addressable store.
- _Feature:_ **Catalogs** are used in `pnpm-workspace.yaml` to define external dependencies (like `react`, `zod`, `typescript`) in _one place_. This guarantees that every app in the repo uses the exact same version of a library, preventing "version drift" and "phantom dependency" bugs.

- **Build System:** [Turborepo](https://turbo.build/)
- _Why:_ As the repo grows, building everything takes too long. Turbo provides **Smart Caching**. If you only touch `apps/web`, Turbo knows it doesn't need to rebuild `apps/docs`.
- _Config:_ Defined in `turbo.json`, it handles task orchestration (e.g., "Build libraries before building apps").

### 2. Code Quality & Consistency

- **Language:** [TypeScript](https://www.typescriptlang.org/)
- _Why:_ Static typing eliminates an entire class of runtime errors.
- _Implementation:_ Centralized configuration via `@repo/typescript-config`.

- **Linter:** [ESLint](https://eslint.org/) (Flat Config)
- _Why:_ Catches logic errors and bad patterns before execution.
- _Implementation:_ We use the modern "Flat Config" system. Rules are layered: `base` rules apply to everything, `react` rules extend base, and `next` rules extend react.

- **Formatter:** [Prettier](https://prettier.io/)
- _Why:_ Ends arguments about code style (semicolons, indentation). Prettier formats on save/commit.

- **VCS Enforcement:** [Husky](https://typicode.github.io/husky/) + [Commitlint](https://commitlint.js.org/)
- _Why:_ Quality tools are useless if developers can bypass them. Husky runs scripts _before_ you commit or push to ensure the code meets standards.

## 📂 Project Structure

```text
.
├── .aiassistant/rules        # AI Persona & Rules definition (see monorepo.md)
├── apps/                     # Deployable applications
│   ├── app-template/         # Canonical scaffold template for new apps
│   ├── omni-crawl-chat/     # Terminal-first LangGraph planning playground
│   ├── jobs-crawler-actor/   # Crawler worker
│   ├── jobs-ingestion-service/ # Ingestion worker
│   ├── ingestion-worker-v2/  # Lightweight V2 ingestion worker
│   └── ops-control-plane/    # Operator dashboard and control plane
├── packages/                 # Shared internal libraries
│   ├── env-config/           # Type-safe environment variable parsing
│   ├── eslint-config/        # Shared ESLint Flat Configurations (Base, React, Next)
│   └── typescript-config/    # Shared TSConfig bases (Node, React, Next)
├── .github/                  # GitHub Actions & Rulesets (Branch protection)
├── .husky/                   # Git Hooks (Pre-commit, Pre-push, Commit-msg)
├── docker-compose.yml        # Docker workshop placeholder (not wired yet)
├── turbo.json                # Build pipeline configuration
└── pnpm-workspace.yaml       # Workspace & Catalog definitions

```

## 🚀 Getting Started

### Prerequisites

1. **Node.js**: We use strict version management. Install [fnm](https://github.com/Schniz/fnm) (Fast Node Manager).

```bash
fnm use
# If not installed, fnm will prompt to install Node v24.6.0

```

2. **pnpm**:

```bash
corepack enable
pnpm install

```

3. **Docker** (optional for now): Planned for workshop deployment modules. Current Docker files are placeholders and are not yet wired for runnable services.

### Common Commands

| Command            | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `pnpm dev`         | Starts the development server for all apps.           |
| `pnpm build`       | Builds all apps and packages using Turbo caching.     |
| `pnpm lint`        | Runs ESLint across the entire monorepo.               |
| `pnpm format`      | Formats all files using Prettier.                     |
| `pnpm check-types` | Runs TypeScript type checking without emitting files. |

## 🤖 AI & Engineering Standards

We strictly enforce architectural patterns. To ensure AI assistants (like Cursor, WebStorm AI, or GitHub Copilot) generate code that adheres to our standards—such as using `pnpm` catalogs and specific TypeScript configurations—we have codified our rules.

**Location:** `.aiassistant/rules/monorepo.md`

### How to use with WebStorm

1. It is enabled by default
2. For other IDE's read their documentation
3. Link to WebStorm docs: https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html

## 📐 Shared Internal Packages

To maintain consistency, configuration is not duplicated in every app. It is imported from `packages/`.

### 1. TypeScript (`@repo/typescript-config`)

We do not use a single `tsconfig.json`. We use specialized base configs depending on the execution environment:

- `base.json`: The strict foundation (ES2022, strict mode).
- `node-lib.json`: For backend packages (Uses `NodeNext` modules, no DOM).
- `react-library.json`: For UI libraries (Includes DOM, strict React types).
- `nextjs.json`: Optimized for Next.js apps (Preserves JSX for SWC).

### 2. ESLint (`@repo/eslint-config`)

We use **ESLint Flat Config**.

- **Base:** Standard JS/TS rules + Turbo cache safety checks (ensures env vars are declared).
- **React Internal:** Enforces Hooks rules and accessibility.
- **Next.js:** Core Web Vitals and App Router best practices.

## 🛠 Engineering Workflow: GitFlow & SemVer

This repository moves beyond simple script execution to a professional, predictable engineering workflow. We strictly enforce **GitFlow** for branching and **Semantic Versioning (SemVer)** for releases.

### 1. The Core Branches

- **`main`**: **Production-ready code.** Every commit here is a stable release tagged with a version (e.g., `v1.0.0`). Direct commits are blocked.
- **`develop`**: **Integration branch.** The daily "current state" of development. All features merge here first.

### 2. The Development Cycle

**Phase 1: Feature Work**

1. **Sync:** `git checkout develop && git pull`
2. **Branch:** Create a descriptively named branch.

- `feat/auth-login`
- `bugfix/fix-header-alignment`
- `chore/update-deps`

3. **Work & Commit:**

- We use **Conventional Commits**.
- Format: `<type>(<scope>): <subject>`
- Example: `feat(ui): add dark mode toggle`
- _Enforcement:_ `commit-msg` hook validates your message against the standard.

4. **Push:**

- _Enforcement:_ `pre-push` hook validates your branch name. You cannot push a branch named `temp` or `my-stuff`. It must match the regex (e.g., `feat/*`, `bugfix/*`).

5. **PR:** Open a Pull Request to merge into `develop`.

**Phase 2: The Release (The SemVer Moment)**
When `develop` is ready for a release:

1. Create `release/v1.1.0` from `develop`.
2. Perform final polish (docs, version bumps). No new features.
3. Merge `release/v1.1.0` → `main`.
4. Tag `main` with `v1.1.0`.

- _Enforcement:_ GitHub Ruleset `protectSemVerTags` prevents deleting or moving tags once pushed.

5. Merge `release/v1.1.0` back into `develop` to ensure it has the version bump.

**Phase 3: Hotfixes**
Critical production bugs skip `develop`.

1. Branch `hotfix/v1.1.1` from `main`.
2. Fix and Merge to both `main` and `develop`.

### Automated Enforcement

This workflow is not just a suggestion; it is enforced via code and configuration:

1. **Husky Pre-Push Hook**: Blocks pushes from branches that do not adhere to naming conventions (`feat/*`, `bugfix/*`, `hotfix/*`, `release/vX.Y.Z`, `chore/*`).
2. **Commitlint**: Blocks commits that do not follow Conventional Commits.
3. **GitHub Rulesets**:

- **Protect Main:** Requires PRs, blocks direct pushes, blocks force pushes.
- **Protect Develop:** Requires PRs, blocks direct pushes.
- **Protect Tags:** Prevents deletion/updates of `v*` tags to ensure immutable release history.

## 🏗️ Docker & Deployment

### Turbo Prune

Deploying a monorepo can lead to bloated Docker images. `turbo prune` is the target approach we will use in the Docker workshop module.

### Current Docker Status

Docker files are placeholders at this stage:

- `docker-compose.yml` currently defines no runnable services.
- `apps/app-template/Dockerfile` is intentionally empty.

Use local `pnpm` commands for development and validation until Docker modules are added.

## 🧩 Adding New Components

### Creating a New App

1. From repo root, scaffold from the template: `pnpm scaffold <app-name>`.
2. Validate the new app:
   - `pnpm -C apps/<app-name> lint`
   - `pnpm -C apps/<app-name> check-types`
   - `pnpm -C apps/<app-name> build`
3. Update app-specific files (`README.md`, `.env`, and `src/app.ts`) as needed.
4. Use manual copy only as fallback when scaffold is unavailable (see `apps/README.md`).

### Creating a New Package

1. Create folder in `packages/`.
2. Name it with the scope `@repo/package-name`.
3. Extend `node-lib.json` or `react-library.json` depending on the use case.
4. Run `pnpm install`.

## 📄 License

**The MIT License (MIT)**

Copyright (c) 2026 Oldrich Rezek

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
