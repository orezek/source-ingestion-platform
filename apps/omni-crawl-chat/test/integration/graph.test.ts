import { describe, expect, it } from 'vitest';

import { runChatGraph } from '../../src/graph/graph.js';
import { HeuristicPlannerRouter } from '../../src/planner/heuristic-planner.js';

const planner = new HeuristicPlannerRouter();

describe('omni-crawl-chat graph integration', () => {
  it('solves a single task', async () => {
    const state = await runChatGraph({ planner, maxSteps: 10 }, 'what is 4 + 5');

    expect(state.finalAnswer).toBe('The result is 9.');
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.status).toBe('done');
  });

  it('solves a sequential dependency', async () => {
    const state = await runChatGraph({ planner, maxSteps: 10 }, 'what is (2 + 3) * 4');

    expect(state.finalAnswer).toBe('The result is 20.');
    expect(state.tasks.map((task) => task.status)).toEqual(['done', 'done']);
  });

  it('fans out independent tasks and merges them', async () => {
    const state = await runChatGraph(
      { planner, maxSteps: 10 },
      'what is 2 + 3 and 10 / 2, then add the results',
    );

    expect(state.finalAnswer).toBe('The result is 10.');
    expect(state.traceEntries.some((entry) => entry.summary.includes('Ready tasks: t1, t2'))).toBe(
      true,
    );
  });

  it('returns a graceful unsupported response', async () => {
    const state = await runChatGraph({ planner, maxSteps: 10 }, 'what is the square root of 16');

    expect(state.finalAnswer).toContain('supported arithmetic or percentage');
    expect(state.endReason).toBe('unsupported');
  });

  it('returns a graceful divide-by-zero response', async () => {
    const state = await runChatGraph({ planner, maxSteps: 10 }, 'divide 5 by 0');

    expect(state.finalAnswer).toContain('cannot divide by zero');
    expect(state.endReason).toBe('task_failed');
  });
});
