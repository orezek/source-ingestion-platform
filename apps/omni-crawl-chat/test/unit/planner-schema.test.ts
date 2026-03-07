import { describe, expect, it } from 'vitest';

import { parseGeminiPlannerDecision } from '../../src/planner/planner-schema.js';

describe('planner schema conversion', () => {
  it('converts a flat Gemini plan decision into the strict internal union', () => {
    const decision = parseGeminiPlannerDecision({
      decision: 'plan',
      userMessageSummary: 'Multiply ten by ten.',
      decompositionSummary: 'Single multiplication task.',
      routingSummary: 'Dispatch multiply worker.',
      warnings: [],
      message: null,
      suggestion: null,
      tasks: [
        {
          id: 't1',
          description: 'Multiply 10 and 10',
          kind: 'multiply_divide',
          operation: 'multiply',
          args: [10, 10],
          dependsOn: [],
        },
      ],
    });

    expect(decision.decision).toBe('plan');
    if (decision.decision === 'plan') {
      expect(decision.tasks).toHaveLength(1);
      expect(decision.tasks[0]?.operation).toBe('multiply');
    }
  });

  it('converts a flat Gemini unsupported decision into the strict internal union', () => {
    const decision = parseGeminiPlannerDecision({
      decision: 'unsupported',
      userMessageSummary: 'Unsupported operation.',
      decompositionSummary: 'No valid arithmetic decomposition.',
      routingSummary: 'Return unsupported response.',
      warnings: ['unsupported_operation'],
      tasks: [],
      message: 'I can only help with arithmetic and percentage questions.',
      suggestion: 'Try a question like "What is (2 + 3) * 4?"',
    });

    expect(decision.decision).toBe('unsupported');
    if (decision.decision === 'unsupported') {
      expect(decision.message).toContain('arithmetic');
      expect(decision.suggestion).toContain('(2 + 3) * 4');
    }
  });
});
