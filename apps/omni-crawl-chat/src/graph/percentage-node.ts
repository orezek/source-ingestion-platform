import type { ChatState, ChatStateUpdate, PlannedTask } from './state.js';
import { getTaskById } from './task-utils.js';

const runPercentageOperation = (
  operation: PlannedTask['operation'],
  [left, right]: [number, number],
) => {
  switch (operation) {
    case 'percent_of':
      return (left / 100) * right;
    case 'increase_by_percent':
      return left * (1 + right / 100);
    case 'decrease_by_percent':
      return left * (1 - right / 100);
    default:
      throw new Error(`Unsupported percentage operation: ${operation}`);
  }
};

export const percentageNode = async (state: ChatState): Promise<ChatStateUpdate> => {
  const execution = state.activeExecution;
  if (!execution) {
    return {
      traceEntries: [
        {
          step: state.stepCount,
          phase: 'unsupported',
          summary: 'percentageNode received no active execution payload.',
          workerNode: 'percentageNode',
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
          summary: `percentageNode could not find task ${execution.taskId}.`,
          taskId: execution.taskId,
          workerNode: 'percentageNode',
        },
      ],
    };
  }

  const result = runPercentageOperation(execution.operation, execution.resolvedArgs);
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
        summary: `${execution.operation}(${execution.resolvedArgs[0]}, ${execution.resolvedArgs[1]}) = ${result}`,
        taskId: execution.taskId,
        workerNode: 'percentageNode',
        result,
      },
    ],
  };
};
