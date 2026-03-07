import type { TaskArg, TaskKind, TaskOperation } from '../graph/state.js';

export type PlannedTaskBlueprint = {
  id: string;
  description: string;
  kind: TaskKind;
  operation: TaskOperation;
  args: TaskArg[];
  dependsOn: string[];
};

export type PlannerPlanDecision = {
  decision: 'plan';
  userMessageSummary: string;
  decompositionSummary: string;
  routingSummary: string;
  warnings: string[];
  tasks: PlannedTaskBlueprint[];
};

export type PlannerUnsupportedDecision = {
  decision: 'unsupported';
  userMessageSummary: string;
  decompositionSummary: string;
  routingSummary: string;
  warnings: string[];
  message: string;
  suggestion: string | null;
};

export type PlannerDecision = PlannerPlanDecision | PlannerUnsupportedDecision;

export interface PlannerRouter {
  plan(userMessage: string): Promise<PlannerDecision>;
}
