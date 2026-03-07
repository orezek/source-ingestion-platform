# OmniCrawl

OmniCrawl is a robust, modular, and extensible crawling and ingestion pipeline system. Originally designed as a "walking skeleton" for job scraping (formerly JobCompass), the system has evolved into a generalized data harvesting engine. 

OmniCrawl leverages modern web crawling capabilities paired with LLM-powered extraction (using LangSmith and Gemini) to seamlessly parse, clean, and structure data from diverse, unstructured sources (e.g., jobs.cz, startupjobs.cz, bazos.cz, and more).

## 🚀 Current State & Version

**Current Version:** `v2.0.0`

The system currently runs on the **V2 Architecture**, which separates the control plane, operational dashboards, and targeted workers into discrete, deployable services managed within a Turborepo monorepo.

### The V2 Application Suite

- **`control-service-v2`**: The backend brain of the system. Manages pipelines, triggers crawling/ingestion runs, stores state in MongoDB, and orchestrates workers via Pub/Sub and HTTP.
- **`control-center-v2`**: A Next.js-based modern operator dashboard. Provides real-time visibility into run statuses, artifacts, and ingestion success rates.
- **`crawler-worker-v2`**: A dedicated Actor/Worker that executes specific crawler manifests (using Crawlee/Playwright) to extract raw data and HTML from targeted sites.
- **`ingestion-worker-v2`**: A dedicated data-processing worker that takes raw scraped data, runs it through an LLM pipeline (for cleaning and structured entity extraction), and produces finalized, standardized JSON artifacts.

*(Note: Legacy V1 applications such as `jobs-crawler-actor`, `jobs-ingestion-service`, `omni-crawl-chat`, and `ops-control-plane` are deprecated and have been intentionally excluded from active workflows in favor of the V2 suite).*

## 📚 Documentation & Specs

OmniCrawl places a heavy emphasis on spec-driven development. Comprehensive design and architecture documentation can be found in the [`docs/specs`](./docs/specs) directory. 

For a complete history of changes, see the [`CHANGELOG.md`](./CHANGELOG.md).

For documentation on the underlying Monorepo architecture, tooling (Turborepo, pnpm, ESLint, TypeScript), and development workflows (GitFlow), see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## 🛣 Roadmap & V3 Ideas

While V2 solidifies the distributed worker architecture, the following capabilities are targeted for **V3**:

- **Execution Sessions & Shared Worker Pools:** Moving away from isolated node processes per run to persistent worker pools that can dynamically allocate resources for large-scale scrapes.
- **Provider & Model-Independent Ingestion:** Decoupling the ingestion parser from specific LLM providers (e.g., currently leveraging Gemini) via adapter-based interfaces, allowing seamless switching to OpenAI, Anthropic, or local open-source models.
- **Deeper Persistence Decoupling:** Further abstracting database dependencies to allow plugging in different structured output destinations without changing core persistence schemas.
- **Authentication & Operator Identity:** Introducing formal login, RBAC (Role-Based Access Control), and operator identity for the `control-center-v2` dashboard.

## ⚙️ Getting Started

### Prerequisites

1. **Node.js**: Install [fnm](https://github.com/Schniz/fnm) (Fast Node Manager).
```bash
fnm use
```
2. **pnpm**:
```bash
corepack enable
pnpm install
```

### Common Commands

| Command            | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `pnpm dev`         | Starts the development server for all apps.           |
| `pnpm build`       | Builds all apps and packages using Turbo caching.     |
| `pnpm lint`        | Runs ESLint across the entire monorepo.               |
| `pnpm format`      | Formats all files using Prettier.                     |
| `pnpm check-types` | Runs TypeScript type checking without emitting files. |

## 📄 License

**The MIT License (MIT)**

Copyright (c) 2026 Oldrich Rezek
