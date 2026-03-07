# omni-crawl-chat

Terminal-first LangGraph planning playground for OmniCrawl.

This app is intentionally narrow in V1. It proves the planning loop, dependency handling, parallel worker dispatch, and operator-safe observability before real OmniCrawl chat capabilities are added.

## What V1 Does

- accepts one prompt at a time
- uses a planner-router to decompose the request into explicit tasks
- routes work to deterministic worker nodes
- supports:
  - addition and subtraction
  - multiplication and division
  - percentage calculations
- renders a terminal UI with:
  - planner trace
  - task plan
  - execution trace
  - final answer

## Architecture

Execution graph:

```text
START -> plannerRouterNode -> worker nodes -> plannerRouterNode -> END
```

State model:

- task plan is explicit
- task dependencies are explicit
- planner trace is structured
- worker execution is deterministic

The planner-router produces structured planning records. It does not expose hidden chain-of-thought.

## Prompt

Planner instructions live in:

- `prompts/planner-router.md`

The file is markdown so it is readable, reviewable, and versioned as source.

## Planner Modes

Runtime planner backends:

- `gemini`
- `heuristic`

Use `gemini` for normal runs. Use `heuristic` for deterministic testing and offline validation.

## Environment

Copy `.env.example` to `.env` and set at minimum:

```bash
GEMINI_API_KEY=...
JOB_COMPASS_CHAT_PLANNER_MODE=gemini
```

Important vars:

- `JOB_COMPASS_CHAT_PLANNER_MODE`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_TEMPERATURE`
- `GEMINI_THINKING_LEVEL`
- `JOB_COMPASS_CHAT_MAX_STEPS`

## Usage

Build:

```bash
pnpm -C apps/omni-crawl-chat build
```

Run with an explicit prompt:

```bash
pnpm -C apps/omni-crawl-chat start -- --prompt "what is (2 + 3) * 4"
```

Run interactively:

```bash
pnpm -C apps/omni-crawl-chat start
```

Heuristic mode example:

```bash
JOB_COMPASS_CHAT_PLANNER_MODE=heuristic pnpm -C apps/omni-crawl-chat start -- --prompt "divide 5 by 0"
```

## Validation

```bash
pnpm -C apps/omni-crawl-chat lint
pnpm -C apps/omni-crawl-chat check-types
pnpm -C apps/omni-crawl-chat build
pnpm -C apps/omni-crawl-chat test
pnpm -C apps/omni-crawl-chat test:e2e
```

## Files

- `src/app.ts` entrypoint
- `src/graph/` LangGraph state, routing, and worker nodes
- `src/planner/` planner backends and prompt loading
- `src/tui/` terminal UI panels
- `test/` unit, integration, and e2e tests
