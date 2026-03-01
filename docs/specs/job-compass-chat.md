# Spec: `job-compass-chat`

## Goal

Create a new app, `job-compass-chat`, that will eventually become the chat interface for JobCompass.

The first release is intentionally narrow. It is not a job-search assistant yet. It is a learning and architecture app used to validate an agentic LangGraph loop with:

- one planner-router node
- three deterministic worker nodes
- explicit task decomposition
- explicit task dependencies
- cyclic execution flow
- structured observability and testability
- a local terminal user interface suitable for inspection and debugging

This release exists to prove the orchestration model before real JobCompass retrieval, analytics, or user-facing workflows are added.

## V1 Scope

V1 supports only simple math-oriented requests routed through an agentic loop.

Worker capabilities:

- `addSubtractNode`
- `multiplyDivideNode`
- `percentageNode`

Examples V1 should support:

- `what is 2 + 3`
- `what is 10 / 2`
- `what is 20% of 80`
- `what is (2 + 3) * 4`
- `what is 2 + 3 and 10 / 2`
- `what is (10 - 4) and 20% of 50, then add those results`

V1 also includes:

- a terminal-first chat interface
- a structured planner trace so the router is observable and not a black box
- reusable Gemini configuration aligned with the existing monorepo apps

## Non-Goals for V1

V1 does not include:

- real job search
- retrieval over MongoDB
- tool calling to external APIs
- memory across conversations
- HTTP API
- web UI
- authentication
- streaming tokens
- generalized planner for arbitrary domains

## Architecture

The app is a Node app inside the monorepo:

- `apps/job-compass-chat`

The app uses LangGraph with a cyclic execution graph and a DAG-like task plan stored in state.

Important distinction:

- the execution graph is cyclic
- the task dependency plan is acyclic

This is the intended design.

The planner-router node should not expose raw chain-of-thought. Instead, it should produce a structured planning trace that is safe to log and easy to inspect in the terminal UI.

### Execution graph

```text
START
  -> plannerRouterNode
  -> conditional routing
      -> addSubtractNode
      -> multiplyDivideNode
      -> percentageNode
      -> END
worker nodes
  -> plannerRouterNode
```

Meaning:

- the planner-router node may run multiple times
- after each worker execution, control returns to the planner-router node
- the planner-router node either:
  - schedules more work
  - or ends the run

### Task dependency plan

The planner-router node builds a task plan in state.

A task dependency means:

- one task cannot execute until another task has finished and produced a result

Example:

- `(2 + 3) * 4`
- `multiply` depends on `add`

Example:

- `2 + 3 and 10 / 2`
- no dependency between the two tasks
- both tasks are independently executable

This task plan should be a DAG.

## Two orchestration patterns

There are two valid agentic patterns in LangGraph. V1 explicitly chooses one of them.

### Pattern A: tool-calling agent

Shape:

```text
START -> agent -> tools -> agent -> END
```

Properties:

- one central LLM agent decides which tool to call
- tools execute operations
- the agent decides when to stop

Pros:

- flexible
- easy to extend with external tools later

Cons:

- less explicit control
- harder to reason about dependencies
- harder to parallelize safely
- harder to test deterministically

### Pattern B: graph-routed node orchestration

Shape:

```text
START -> plannerRouterNode -> worker nodes -> plannerRouterNode -> END
```

Properties:

- the planner-router node creates and updates a task plan
- worker nodes are deterministic executors
- routing decisions are explicit
- state carries task plan and results

Pros:

- easier to debug
- clearer dependency handling
- cleaner parallel execution model
- stronger testability

Cons:

- more orchestration code
- more explicit state design required

### V1 decision

V1 uses Pattern B.

Reason:

- it is the better learning architecture for future JobCompass workflows
- it makes planning, dependency handling, and state transitions explicit
- it keeps workers deterministic

## Node responsibilities

### `plannerRouterNode`

This is not just a router. It performs four roles:

- parse request
- plan subtasks
- determine dependencies
- schedule next executable tasks or end the run

Its responsibilities:

1. Read the original user message and current state.
2. If no task plan exists, create one.
3. Determine which tasks are ready to execute.
4. If all tasks are complete, synthesize the final answer.
5. If the request is invalid, unsupported, or impossible with available workers, end with a helpful response and suggestion.
6. Return routing intent in state.

The planner-router node may be LLM-backed, but the output must be tightly structured.

### `addSubtractNode`

Handles:

- addition
- subtraction

Behavior:

- reads one ready task from state
- resolves numeric inputs
- computes result
- writes result back into the task record
- marks task as done or failed

### `multiplyDivideNode`

Handles:

- multiplication
- division

Behavior:

- same pattern as `addSubtractNode`
- includes divide-by-zero guard

### `percentageNode`

Handles:

- percentage-of
- increase-by-percentage
- decrease-by-percentage

Behavior:

- same deterministic execution pattern
- worker does not interpret beyond the planner-defined operation

## State model

Initial V1 state should be explicit and small.

```ts
type TaskKind = 'add_subtract' | 'multiply_divide' | 'percentage';

type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

type TaskArg = number | { ref: string };

type PlannedTask = {
  id: string;
  description: string;
  kind: TaskKind;
  operation: string;
  args: TaskArg[];
  dependsOn: string[];
  status: TaskStatus;
  result: number | null;
  error: string | null;
};

type ChatState = {
  userMessage: string;
  tasks: PlannedTask[];
  readyTaskIds: string[];
  finalAnswer: string | null;
  error: string | null;
  stepCount: number;
  endReason: string | null;
  plannerTrace: {
    userMessageSummary: string | null;
    routingSummary: string | null;
    decompositionSummary: string | null;
    completionSummary: string | null;
    warnings: string[];
  };
  traceEntries: TraceEntry[];
  activeExecution: ActiveExecution | null;
};
```

`plannerTrace` is a structured observability object. It is not raw hidden reasoning. It exists so operators can see:

- what the planner thought the task was
- how it decomposed the task
- why it chose the next worker(s)
- why it ended

## Planning rules

The planner-router node must perform:

1. Decomposition

- break a request into smaller executable tasks

2. Dependency analysis

- for each task, determine whether it requires results from previous tasks

3. Scheduling

- determine which tasks are executable now
- independent tasks may be scheduled together
- dependent tasks wait until dependencies are complete

4. Completion detection

- if all tasks are done, produce `finalAnswer`

5. Unsupported and impossible request handling

- if unsupported, malformed, or impossible with available workers, produce a helpful answer and `END`

## Ready-task rule

A task is ready when:

- `status = pending`
- and every task in `dependsOn` has `status = done`

This rule should be deterministic and implemented outside the LLM.

## Parallel execution

V1 should support parallel execution when tasks are independent.

Example:

- `what is 2 + 3 and 10 / 2`

Task plan:

```ts
[
  {
    id: 't1',
    kind: 'add_subtract',
    operation: 'add',
    args: [2, 3],
    dependsOn: [],
    status: 'pending',
    result: null,
    error: null,
  },
  {
    id: 't2',
    kind: 'multiply_divide',
    operation: 'divide',
    args: [10, 2],
    dependsOn: [],
    status: 'pending',
    result: null,
    error: null,
  },
];
```

Both tasks are ready at the same time.

The planner-router node may return both task ids as ready. The graph runtime then dispatches the required worker executions.

## Sequential execution

V1 should support dependent execution.

Example:

- `what is (2 + 3) * 4`

Task plan:

```ts
[
  {
    id: 't1',
    kind: 'add_subtract',
    operation: 'add',
    args: [2, 3],
    dependsOn: [],
    status: 'pending',
    result: null,
    error: null,
  },
  {
    id: 't2',
    kind: 'multiply_divide',
    operation: 'multiply',
    args: [{ ref: 't1' }, 4],
    dependsOn: ['t1'],
    status: 'pending',
    result: null,
    error: null,
  },
];
```

Only `t1` is initially ready.

After `t1` completes, `t2` becomes ready.

## Fan-out and fan-in

### Fan-out

V1 may fan out multiple ready tasks when they are independent.

### Fan-in

V1 does not require a dedicated fan-in node.

The planner-router node handles fan-in by:

- observing completed task results in state
- synthesizing final output when appropriate

A dedicated fan-in or synthesis node may be introduced later if result aggregation becomes more complex.

## Conditional routing

The selector function does not execute nodes.

It only reads state and returns the next destination.

Example:

- if `finalAnswer` is present, route to `END`
- otherwise map `readyTaskIds` to one or more `Send(...)` dispatches

If multiple ready tasks are supported in a single step, routing must support multi-destination dispatch or repeated scheduling through the planner-router loop.

## Loop safety

The execution graph is cyclic, so loop safety must be explicit.

Required guards:

- `stepCount` incremented each planner/worker cycle
- maximum step count, for example `10`
- hard fail if no progress is made
- hard fail if planner produces impossible dependencies

These hard guards are internal correctness protections. User-visible behavior should still be graceful.

## User-visible unsupported or impossible handling

V1 must gracefully handle at least:

- unsupported request
- malformed task plan
- missing operands
- unresolved references
- divide by zero
- impossible dependency cycles

Behavior:

- set `finalAnswer` to a human-readable explanation
- include a concrete suggestion where possible
- route to `END`

Example:

- user asks for square root
- planner responds that square root is not yet supported and suggests using addition, subtraction, multiplication, division, or percentage queries

True runtime exceptions may still be represented in `error` for observability, but the user-facing response should remain clear and helpful.

## Determinism boundary

The planner-router node may use an LLM for planning.

Everything else should be deterministic:

- ready-task detection
- dependency validation
- argument resolution
- arithmetic execution
- final loop guards

This boundary is important for testability.

## Observability

V1 must include a structured observability layer visible in the terminal UI.

Goals:

- the planner-router should not be a black box
- every loop iteration should be inspectable
- task lifecycle should be visible

Minimum observability data per step:

- step number
- planner routing summary
- current task plan snapshot
- ready task ids
- worker node selected
- worker result or user-facing explanation
- end reason

Recommended implementation:

- maintain an append-only execution trace in state or in a logger-friendly side channel
- render it in the TUI as a collapsible or sequential trace view
- keep the trace structured, concise, and deterministic enough for tests

Do not log raw chain-of-thought. Log structured planning summaries only.

## Output contract

Final app output for V1 should include:

- `finalAnswer`
- optional final task plan snapshot for debug mode
- optional execution trace for debug mode
- planner trace summaries for observability mode

## Terminal UI

V1 should be a CLI/TUI app, not a web app.

Recommended approach:

- use a terminal UI library rather than plain console prints
- keep the interface simple and inspectable

Recommended library:

- `ink`

Reason:

- mature React-based terminal UI model
- good fit for structured panels, trace output, and live state inspection

Suggested initial TUI panels:

- input prompt area
- current planner summary
- current task plan table
- execution trace
- final answer

## Recommended first examples

The following examples should be used in tests and demos:

### Single-task

- `what is 4 + 5`
- `what is 9 / 3`
- `what is 25% of 200`

### Sequential dependency

- `what is (2 + 3) * 4`
- `what is 100 - 20, then divide by 5`

### Parallel then merge

- `what is 2 + 3 and 10 / 2, then add the results`
- `what is (10 - 4) and 20% of 50, then add those results`

### Failure cases

- `divide 5 by 0`
- `what is the square root of 16`
- `do something impossible`

Expected behavior:

- no opaque crash
- planner explains limitation or impossibility
- planner suggests a supported next query shape

## App structure

Recommended initial structure:

```text
apps/job-compass-chat/
  prompts/
    planner-router.md
  src/
    app.ts
    env.ts
    graph/
      state.ts
      graph.ts
      planner-router-node.ts
      add-subtract-node.ts
      multiply-divide-node.ts
      percentage-node.ts
      task-utils.ts
    planner/
      create-planner.ts
      gemini-planner.ts
      heuristic-planner.ts
      planner-schema.ts
      prompt-loader.ts
      types.ts
    tui/
      app-screen.tsx
      trace-panel.tsx
      task-plan-panel.tsx
  README.md
  CHANGELOG.md
  AGENTS.md
```

## Dependencies

Expected dependencies beyond the app template:

- `@langchain/google-genai`
- `@langchain/langgraph`
- `ink`
- `react`
- `react-dom`
- `zod`
- `@repo/env-config`

If an LLM-backed planner node is added immediately, also use the same LangChain model integration style already present in the monorepo.

## Model and prompt conventions

V1 should reuse the existing Gemini environment pattern already used in the monorepo.

Environment conventions:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_TEMPERATURE`
- `GEMINI_THINKING_LEVEL`
- `JOB_COMPASS_CHAT_PLANNER_MODE`
- `JOB_COMPASS_CHAT_MAX_STEPS`

Recommended default model:

- `gemini-3-flash-preview`

The planner-router instruction prompt should live in:

- `apps/job-compass-chat/prompts/planner-router.md`

Reason:

- prompt is human-readable
- prompt is easy to version and review
- markdown is suitable for both maintainers and the model

The planner prompt should instruct the model to output structured planning data and concise planner summaries, not hidden reasoning text.

Planner modes:

- `gemini`
- `heuristic`

`heuristic` exists to keep tests deterministic and to allow offline local verification of the graph behavior.

## Testing

V1 should include:

### Unit tests

- ready-task detection
- dependency validation
- argument resolution
- each worker node arithmetic behavior
- divide-by-zero handling
- cycle detection in task plan
- planner trace generation shape

### Integration tests

- single-task graph execution
- sequential dependent execution
- parallel independent execution
- merge/final synthesis through planner-router
- unsupported request returns helpful answer
- impossible request returns suggestion rather than opaque failure

### E2E / CLI tests

- run the app with sample prompts
- verify final answer and graceful unsupported/impossible behavior
- verify observability output renders planner trace and task plan

## Versioning

Recommended initial app package version:

- `1.0.0`

This first release is a proof-of-architecture release for the future JobCompass chat system.

## Acceptance criteria

V1 is complete when:

- the app exists under `apps/job-compass-chat`
- the graph runs with a cyclic planner/worker loop
- the planner-router can produce a small task plan
- dependencies are explicit in state
- independent tasks can run in parallel
- dependent tasks run in the correct order
- the planner-router can synthesize final answers
- unsupported and impossible cases terminate cleanly with helpful suggestions
- the terminal UI exposes planner and execution observability
- the planner prompt is stored in `/prompts` as markdown
- docs, changelog, and tests exist
