import type { PlannedTask, TaskArg, TaskKind, TaskOperation, WorkerNodeName } from './state.js';

const workerNodeByKind: Record<TaskKind, WorkerNodeName> = {
  add_subtract: 'addSubtractNode',
  multiply_divide: 'multiplyDivideNode',
  percentage: 'percentageNode',
};

const supportedOperationsByKind: Record<TaskKind, TaskOperation[]> = {
  add_subtract: ['add', 'subtract'],
  multiply_divide: ['multiply', 'divide'],
  percentage: ['percent_of', 'increase_by_percent', 'decrease_by_percent'],
};

export const isTaskReference = (value: TaskArg): value is { ref: string } =>
  typeof value === 'object' && value !== null && 'ref' in value;

export const getWorkerNodeForTaskKind = (kind: TaskKind): WorkerNodeName => workerNodeByKind[kind];

export const isOperationSupportedForKind = (kind: TaskKind, operation: TaskOperation): boolean =>
  supportedOperationsByKind[kind].includes(operation);

export const getTaskById = (tasks: PlannedTask[], taskId: string): PlannedTask | undefined =>
  tasks.find((task) => task.id === taskId);

export const getDependentTaskIds = (tasks: PlannedTask[]): Set<string> =>
  new Set(tasks.flatMap((task) => task.dependsOn));

export const getTerminalTasks = (tasks: PlannedTask[]): PlannedTask[] => {
  const dependedOnIds = getDependentTaskIds(tasks);
  return tasks.filter((task) => !dependedOnIds.has(task.id));
};

export const getReadyTaskIds = (tasks: PlannedTask[]): string[] =>
  tasks
    .filter((task) => task.status === 'pending')
    .filter((task) =>
      task.dependsOn.every((dependencyId) => getTaskById(tasks, dependencyId)?.status === 'done'),
    )
    .map((task) => task.id);

export const resolveTaskArgs = (task: PlannedTask, tasks: PlannedTask[]): [number, number] => {
  const resolvedArgs = task.args.map((arg) => {
    if (!isTaskReference(arg)) {
      return arg;
    }

    const referencedTask = getTaskById(tasks, arg.ref);
    if (!referencedTask || referencedTask.result === null) {
      throw new Error(`Task ${task.id} depends on unresolved result ${arg.ref}.`);
    }

    return referencedTask.result;
  });

  if (resolvedArgs.length !== 2) {
    throw new Error(`Task ${task.id} must resolve to exactly two numeric arguments.`);
  }

  return [resolvedArgs[0]!, resolvedArgs[1]!];
};

export const hasDependencyCycle = (tasks: PlannedTask[]): boolean => {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) {
      return true;
    }

    if (visited.has(taskId)) {
      return false;
    }

    visiting.add(taskId);
    const task = taskById.get(taskId);
    for (const dependencyId of task?.dependsOn ?? []) {
      if (visit(dependencyId)) {
        return true;
      }
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };

  return tasks.some((task) => visit(task.id));
};

export const validateTaskPlan = (tasks: PlannedTask[]): string | null => {
  if (tasks.length === 0) {
    return 'Planner produced an empty task plan.';
  }

  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      return `Planner produced duplicate task id "${task.id}".`;
    }
    ids.add(task.id);
  }

  for (const task of tasks) {
    if (!isOperationSupportedForKind(task.kind, task.operation)) {
      return `Task ${task.id} uses unsupported operation ${task.operation} for kind ${task.kind}.`;
    }

    if (task.dependsOn.includes(task.id)) {
      return `Task ${task.id} depends on itself.`;
    }

    for (const dependencyId of task.dependsOn) {
      if (!ids.has(dependencyId)) {
        return `Task ${task.id} depends on unknown task ${dependencyId}.`;
      }
    }

    for (const arg of task.args) {
      if (isTaskReference(arg) && !ids.has(arg.ref)) {
        return `Task ${task.id} references unknown task ${arg.ref}.`;
      }
    }
  }

  if (hasDependencyCycle(tasks)) {
    return 'Planner produced a cyclic task dependency graph.';
  }

  return null;
};

export const allTasksDone = (tasks: PlannedTask[]): boolean =>
  tasks.length > 0 && tasks.every((task) => task.status === 'done');

export const getFailedTask = (tasks: PlannedTask[]): PlannedTask | undefined =>
  tasks.find((task) => task.status === 'failed');

export const formatTaskArg = (arg: TaskArg): string =>
  isTaskReference(arg) ? `ref(${arg.ref})` : String(arg);

export const formatTaskDescription = (task: PlannedTask): string =>
  `${task.id}: ${task.description}`;

export const buildUnsupportedSuggestion = (): string =>
  'Try a supported arithmetic or percentage query using addition, subtraction, multiplication, division, or percentage operations.';

export const composeFinalAnswer = (tasks: PlannedTask[]): string => {
  const terminalTasks = getTerminalTasks(tasks).filter((task) => task.result !== null);

  if (terminalTasks.length === 1) {
    const task = terminalTasks[0]!;
    return `The result is ${task.result}.`;
  }

  const summaries = terminalTasks.map((task) => `${task.description} = ${task.result}`);
  return `I completed ${terminalTasks.length} independent tasks: ${summaries.join('; ')}.`;
};

export const buildFailureAnswer = (task: PlannedTask): string => {
  if (task.operation === 'divide') {
    return 'I cannot divide by zero. Try the same query with a non-zero divisor.';
  }

  return task.error
    ? `${task.error} Try a simpler supported arithmetic or percentage query.`
    : 'I could not complete the requested task. Try a simpler supported arithmetic or percentage query.';
};
