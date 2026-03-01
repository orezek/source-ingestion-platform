import type { ChatState, ChatStateUpdate, PlannedTask } from './state.js';
import { getTaskById } from './task-utils.js';

export const addSubtractNode = async (state: ChatState): Promise<ChatStateUpdate> => {
  const execution = state.activeExecution;
  if (!execution) {
    return {
      traceEntries: [
        {
          step: state.stepCount,
          phase: 'unsupported',
          summary: 'addSubtractNode received no active execution payload.',
          workerNode: 'addSubtractNode',
        },
      ],
    };
  }

  const currentTask = getTaskById(state.tasks, execution.taskId);
  if (!currentTask) {
    return {
      traceEntries: [
        {
          step: state.stepCount,
          phase: 'unsupported',
          summary: `addSubtractNode could not find task ${execution.taskId}.`,
          taskId: execution.taskId,
          workerNode: 'addSubtractNode',
        },
      ],
    };
  }

  const [left, right] = execution.resolvedArgs;
  const result = execution.operation === 'subtract' ? left - right : left + right;
  const updatedTask: PlannedTask = {
    ...currentTask,
    status: 'done',
    result,
    error: null,
  };

  return {
    tasks: [updatedTask],
    traceEntries: [
      {
        step: state.stepCount,
        phase: 'worker',
        summary: `${execution.operation}(${left}, ${right}) = ${result}`,
        taskId: execution.taskId,
        workerNode: 'addSubtractNode',
        result,
      },
    ],
  };
};
