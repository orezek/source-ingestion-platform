import { Annotation } from '@langchain/langgraph';

export const workerNodeNames = ['addSubtractNode', 'multiplyDivideNode', 'percentageNode'] as const;

export type WorkerNodeName = (typeof workerNodeNames)[number];

export const taskKinds = ['add_subtract', 'multiply_divide', 'percentage'] as const;
export type TaskKind = (typeof taskKinds)[number];

export const taskOperations = [
  'add',
  'subtract',
  'multiply',
  'divide',
  'percent_of',
  'increase_by_percent',
  'decrease_by_percent',
] as const;

export type TaskOperation = (typeof taskOperations)[number];

export type TaskArg = number | { ref: string };

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

export type PlannedTask = {
  id: string;
  description: string;
  kind: TaskKind;
  operation: TaskOperation;
  args: TaskArg[];
  dependsOn: string[];
  status: TaskStatus;
  result: number | null;
  error: string | null;
};

export type PlannerTrace = {
  userMessageSummary: string | null;
  routingSummary: string | null;
  decompositionSummary: string | null;
  completionSummary: string | null;
  warnings: string[];
};

export type TracePhase = 'plan' | 'dispatch' | 'worker' | 'complete' | 'unsupported';

export type TraceEntry = {
  step: number;
  phase: TracePhase;
  summary: string;
  taskId?: string;
  workerNode?: WorkerNodeName;
  result?: number;
};

export type ActiveExecution = {
  taskId: string;
  description: string;
  operation: TaskOperation;
  resolvedArgs: [number, number];
  workerNode: WorkerNodeName;
};

const mergeTasks = (left: PlannedTask[], right: PlannedTask[]): PlannedTask[] => {
  const mergedById = new Map(left.map((task) => [task.id, task]));
  for (const task of right) {
    mergedById.set(task.id, task);
  }

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const source of [left, right]) {
    for (const task of source) {
      if (!seen.has(task.id)) {
        seen.add(task.id);
        orderedIds.push(task.id);
      }
    }
  }

  return orderedIds.map((taskId) => mergedById.get(taskId)!).filter(Boolean);
};

const mergeTraceEntries = (left: TraceEntry[], right: TraceEntry[]): TraceEntry[] =>
  left.concat(right);

export const defaultPlannerTrace = (): PlannerTrace => ({
  userMessageSummary: null,
  routingSummary: null,
  decompositionSummary: null,
  completionSummary: null,
  warnings: [],
});

export const ChatStateAnnotation = Annotation.Root({
  userMessage: Annotation<string>(),
  tasks: Annotation<PlannedTask[]>({
    reducer: mergeTasks,
    default: () => [],
  }),
  readyTaskIds: Annotation<string[]>(),
  finalAnswer: Annotation<string | null>(),
  error: Annotation<string | null>(),
  stepCount: Annotation<number>(),
  plannerTrace: Annotation<PlannerTrace>(),
  traceEntries: Annotation<TraceEntry[]>({
    reducer: mergeTraceEntries,
    default: () => [],
  }),
  activeExecution: Annotation<ActiveExecution | null>(),
  endReason: Annotation<string | null>(),
});

export type ChatState = typeof ChatStateAnnotation.State;
export type ChatStateUpdate = typeof ChatStateAnnotation.Update;

export const createInitialState = (userMessage: string): ChatState => ({
  userMessage,
  tasks: [],
  readyTaskIds: [],
  finalAnswer: null,
  error: null,
  stepCount: 0,
  plannerTrace: defaultPlannerTrace(),
  traceEntries: [],
  activeExecution: null,
  endReason: null,
});
