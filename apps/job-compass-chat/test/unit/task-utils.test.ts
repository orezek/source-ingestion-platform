import { describe, expect, it } from 'vitest';

import {
  buildFailureAnswer,
  getReadyTaskIds,
  hasDependencyCycle,
  resolveTaskArgs,
  validateTaskPlan,
} from '../../src/graph/task-utils.js';
import type { PlannedTask } from '../../src/graph/state.js';

const baseTasks: PlannedTask[] = [
  {
    id: 't1',
    description: '2 + 3',
    kind: 'add_subtract',
    operation: 'add',
    args: [2, 3],
    dependsOn: [],
    status: 'done',
    result: 5,
    error: null,
  },
  {
    id: 't2',
    description: 't1 * 4',
    kind: 'multiply_divide',
    operation: 'multiply',
    args: [{ ref: 't1' }, 4],
    dependsOn: ['t1'],
    status: 'pending',
    result: null,
    error: null,
  },
];

describe('task-utils', () => {
  it('finds ready tasks from dependency completion', () => {
    expect(getReadyTaskIds(baseTasks)).toEqual(['t2']);
  });

  it('resolves reference args from completed tasks', () => {
    expect(resolveTaskArgs(baseTasks[1]!, baseTasks)).toEqual([5, 4]);
  });

  it('detects dependency cycles', () => {
    const cyclicTasks: PlannedTask[] = [
      { ...baseTasks[0]!, status: 'pending', result: null, dependsOn: ['t2'] },
      { ...baseTasks[1]!, dependsOn: ['t1'] },
    ];

    expect(hasDependencyCycle(cyclicTasks)).toBe(true);
    expect(validateTaskPlan(cyclicTasks)).toContain('cyclic');
  });

  it('builds user-friendly divide-by-zero answer', () => {
    const failedTask: PlannedTask = {
      ...baseTasks[1]!,
      operation: 'divide',
      status: 'failed',
      error: 'Division by zero is not allowed.',
    };

    expect(buildFailureAnswer(failedTask)).toContain('cannot divide by zero');
  });
});
