import { z } from 'zod';

import type { PlannerDecision } from './types.js';

const taskArgSchema = z.union([
  z.number(),
  z.object({
    ref: z.string().min(1),
  }),
]);

const taskKindSchema = z.enum(['add_subtract', 'multiply_divide', 'percentage']);
const taskOperationSchema = z.enum([
  'add',
  'subtract',
  'multiply',
  'divide',
  'percent_of',
  'increase_by_percent',
  'decrease_by_percent',
]);

export const plannedTaskBlueprintSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  kind: taskKindSchema,
  operation: taskOperationSchema,
  args: z.array(taskArgSchema).min(2).max(2),
  dependsOn: z.array(z.string().min(1)),
});

const plannerPlanDecisionSchema = z.object({
  decision: z.literal('plan'),
  userMessageSummary: z.string().min(1),
  decompositionSummary: z.string().min(1),
  routingSummary: z.string().min(1),
  warnings: z.array(z.string()),
  tasks: z.array(plannedTaskBlueprintSchema).min(1),
});

const plannerUnsupportedDecisionSchema = z.object({
  decision: z.literal('unsupported'),
  userMessageSummary: z.string().min(1),
  decompositionSummary: z.string().min(1),
  routingSummary: z.string().min(1),
  warnings: z.array(z.string()),
  message: z.string().min(1),
  suggestion: z.string().nullable(),
});

export const plannerDecisionSchema = z.discriminatedUnion('decision', [
  plannerPlanDecisionSchema,
  plannerUnsupportedDecisionSchema,
]);

// Gemini rejects discriminated-union JSON Schema output that uses "const".
// Keep the provider-facing schema flat, then convert it to the stricter internal union.
export const geminiPlannerDecisionSchema = z.object({
  decision: z.enum(['plan', 'unsupported']),
  userMessageSummary: z.string().min(1),
  decompositionSummary: z.string().min(1),
  routingSummary: z.string().min(1),
  warnings: z.array(z.string()).default([]),
  tasks: z.array(plannedTaskBlueprintSchema).default([]),
  message: z.string().nullable().default(null),
  suggestion: z.string().nullable().default(null),
});

export type PlannerDecisionSchema = z.infer<typeof plannerDecisionSchema>;
export type GeminiPlannerDecisionSchema = z.infer<typeof geminiPlannerDecisionSchema>;

export const parseGeminiPlannerDecision = (value: GeminiPlannerDecisionSchema): PlannerDecision => {
  if (value.decision === 'plan') {
    return plannerPlanDecisionSchema.parse({
      decision: 'plan',
      userMessageSummary: value.userMessageSummary,
      decompositionSummary: value.decompositionSummary,
      routingSummary: value.routingSummary,
      warnings: value.warnings,
      tasks: value.tasks,
    });
  }

  return plannerUnsupportedDecisionSchema.parse({
    decision: 'unsupported',
    userMessageSummary: value.userMessageSummary,
    decompositionSummary: value.decompositionSummary,
    routingSummary: value.routingSummary,
    warnings: value.warnings,
    message: value.message,
    suggestion: value.suggestion,
  });
};
