import type { ChatState, ChatStateUpdate, PlannedTask } from './state.js';
import { getTaskById } from './task-utils.js';

export const multiplyDivideNode = async (state: ChatState): Promise<ChatStateUpdate> => {
  const execution = state.activeExecution;
  if (!execution) {
    return {
      traceEntries: [
        {
          step: state.stepCount,
          phase: 'unsupported',
          summary: 'multiplyDivideNode received no active execution payload.',
          workerNode: 'multiplyDivideNode',
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
          summary: `multiplyDivideNode could not find task ${execution.taskId}.`,
          taskId: execution.taskId,
          workerNode: 'multiplyDivideNode',
        },
      ],
    };
  }

  const [left, right] = execution.resolvedArgs;
  if (execution.operation === 'divide' && right === 0) {
    const failedTask: PlannedTask = {
      ...currentTask,
      status: 'failed',
      result: null,
      error: 'Division by zero is not allowed.',
    };

    return {
      tasks: [failedTask],
      traceEntries: [
        {
          step: state.stepCount,
          phase: 'worker',
          summary: `divide(${left}, ${right}) failed because the divisor is zero.`,
          taskId: execution.taskId,
          workerNode: 'multiplyDivideNode',
        },
      ],
    };
  }

  const result = execution.operation === 'divide' ? left / right : left * right;
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
        workerNode: 'multiplyDivideNode',
        result,
      },
    ],
  };
};
