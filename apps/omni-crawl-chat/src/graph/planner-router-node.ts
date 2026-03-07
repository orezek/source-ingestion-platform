import type { PlannerRouter, PlannedTaskBlueprint } from '../planner/types.js';
import type { ChatState, ChatStateUpdate, PlannedTask, PlannerTrace, TraceEntry } from './state.js';
import {
  buildFailureAnswer,
  buildUnsupportedSuggestion,
  getFailedTask,
  validateTaskPlan,
  allTasksDone,
  getReadyTaskIds,
  composeFinalAnswer,
} from './task-utils.js';

const toTraceEntry = (step: number, phase: TraceEntry['phase'], summary: string): TraceEntry => ({
  step,
  phase,
  summary,
});

const initializePlannedTasks = (tasks: PlannedTaskBlueprint[]): PlannedTask[] =>
  tasks.map((task) => ({
    ...task,
    status: 'pending',
    result: null,
    error: null,
  }));

const buildUnsupportedAnswer = (message: string, suggestion: string | null): string =>
  suggestion ? `${message} ${suggestion}` : message;

const clonePlannerTrace = (trace: PlannerTrace): PlannerTrace => ({
  ...trace,
  warnings: [...trace.warnings],
});

export const createPlannerRouterNode = (planner: PlannerRouter, maxSteps: number) => {
  return async (state: ChatState): Promise<ChatStateUpdate> => {
    const step = state.stepCount + 1;

    if (step > maxSteps) {
      const finalAnswer =
        'I reached the maximum planning steps for this run. Try a simpler supported arithmetic or percentage query.';
      return {
        stepCount: step,
        finalAnswer,
        error: 'max_steps_exceeded',
        endReason: 'max_steps_exceeded',
        readyTaskIds: [],
        traceEntries: [toTraceEntry(step, 'unsupported', finalAnswer)],
        plannerTrace: {
          ...clonePlannerTrace(state.plannerTrace),
          completionSummary: 'Stopped because the maximum step count was exceeded.',
          warnings: state.plannerTrace.warnings.concat('max_steps_exceeded'),
        },
      };
    }

    if (state.tasks.length === 0) {
      const decision = await planner.plan(state.userMessage);

      if (decision.decision === 'unsupported') {
        const finalAnswer = buildUnsupportedAnswer(
          decision.message,
          decision.suggestion ?? buildUnsupportedSuggestion(),
        );
        return {
          stepCount: step,
          finalAnswer,
          endReason: 'unsupported',
          readyTaskIds: [],
          plannerTrace: {
            userMessageSummary: decision.userMessageSummary,
            routingSummary: decision.routingSummary,
            decompositionSummary: decision.decompositionSummary,
            completionSummary: finalAnswer,
            warnings: decision.warnings,
          },
          traceEntries: [
            toTraceEntry(step, 'plan', decision.decompositionSummary),
            toTraceEntry(step, 'unsupported', finalAnswer),
          ],
        };
      }

      const plannedTasks = initializePlannedTasks(decision.tasks);
      const validationError = validateTaskPlan(plannedTasks);
      if (validationError) {
        const finalAnswer = `${validationError} ${buildUnsupportedSuggestion()}`;
        return {
          stepCount: step,
          finalAnswer,
          error: validationError,
          endReason: 'invalid_plan',
          readyTaskIds: [],
          plannerTrace: {
            userMessageSummary: decision.userMessageSummary,
            routingSummary: decision.routingSummary,
            decompositionSummary: decision.decompositionSummary,
            completionSummary: finalAnswer,
            warnings: decision.warnings.concat(validationError),
          },
          traceEntries: [
            toTraceEntry(step, 'plan', decision.decompositionSummary),
            toTraceEntry(step, 'unsupported', finalAnswer),
          ],
          tasks: plannedTasks,
        };
      }

      const readyTaskIds = getReadyTaskIds(plannedTasks);
      return {
        stepCount: step,
        tasks: plannedTasks,
        readyTaskIds,
        plannerTrace: {
          userMessageSummary: decision.userMessageSummary,
          routingSummary: `Dispatching ${readyTaskIds.length} ready task(s): ${readyTaskIds.join(', ')}`,
          decompositionSummary: decision.decompositionSummary,
          completionSummary: null,
          warnings: decision.warnings,
        },
        traceEntries: [
          toTraceEntry(step, 'plan', decision.decompositionSummary),
          toTraceEntry(
            step,
            'dispatch',
            `Ready tasks: ${readyTaskIds.join(', ') || 'none'}. ${decision.routingSummary}`,
          ),
        ],
      };
    }

    const failedTask = getFailedTask(state.tasks);
    if (failedTask) {
      const finalAnswer = buildFailureAnswer(failedTask);
      return {
        stepCount: step,
        finalAnswer,
        error: failedTask.error,
        endReason: 'task_failed',
        readyTaskIds: [],
        plannerTrace: {
          ...clonePlannerTrace(state.plannerTrace),
          routingSummary: 'A worker task failed; no further tasks were scheduled.',
          completionSummary: finalAnswer,
        },
        traceEntries: [toTraceEntry(step, 'unsupported', finalAnswer)],
      };
    }

    if (allTasksDone(state.tasks)) {
      const finalAnswer = composeFinalAnswer(state.tasks);
      return {
        stepCount: step,
        finalAnswer,
        endReason: 'completed',
        readyTaskIds: [],
        plannerTrace: {
          ...clonePlannerTrace(state.plannerTrace),
          routingSummary: 'All tasks completed; no more worker dispatches are required.',
          completionSummary: finalAnswer,
        },
        traceEntries: [toTraceEntry(step, 'complete', finalAnswer)],
      };
    }

    const readyTaskIds = getReadyTaskIds(state.tasks);
    if (readyTaskIds.length === 0) {
      const finalAnswer =
        'I could not find any executable next step from the current task plan. Try rewriting the request into smaller supported steps.';
      return {
        stepCount: step,
        finalAnswer,
        error: 'no_ready_tasks',
        endReason: 'invalid_plan',
        readyTaskIds: [],
        plannerTrace: {
          ...clonePlannerTrace(state.plannerTrace),
          routingSummary: 'No ready tasks were found in the current task plan.',
          completionSummary: finalAnswer,
          warnings: state.plannerTrace.warnings.concat('no_ready_tasks'),
        },
        traceEntries: [toTraceEntry(step, 'unsupported', finalAnswer)],
      };
    }

    return {
      stepCount: step,
      readyTaskIds,
      plannerTrace: {
        ...clonePlannerTrace(state.plannerTrace),
        routingSummary: `Dispatching ${readyTaskIds.length} ready task(s): ${readyTaskIds.join(', ')}`,
      },
      traceEntries: [
        toTraceEntry(step, 'dispatch', `Ready tasks for execution: ${readyTaskIds.join(', ')}`),
      ],
    };
  };
};
