import { z } from 'zod';

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

export const plannerDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('plan'),
    userMessageSummary: z.string().min(1),
    decompositionSummary: z.string().min(1),
    routingSummary: z.string().min(1),
    warnings: z.array(z.string()),
    tasks: z.array(plannedTaskBlueprintSchema).min(1),
  }),
  z.object({
    decision: z.literal('unsupported'),
    userMessageSummary: z.string().min(1),
    decompositionSummary: z.string().min(1),
    routingSummary: z.string().min(1),
    warnings: z.array(z.string()),
    message: z.string().min(1),
    suggestion: z.string().nullable(),
  }),
]);

export type PlannerDecisionSchema = z.infer<typeof plannerDecisionSchema>;
