import { buildUnsupportedSuggestion } from '../graph/task-utils.js';
import type { TaskArg, TaskKind, TaskOperation } from '../graph/state.js';
import type { PlannerDecision, PlannerRouter, PlannedTaskBlueprint } from './types.js';

type ExprNode =
  | { type: 'number'; value: number }
  | { type: 'binary'; operator: '+' | '-' | '*' | '/'; left: ExprNode; right: ExprNode };

type BinaryOperator = Extract<ExprNode, { type: 'binary' }>['operator'];

type CompileResult = {
  tasks: PlannedTaskBlueprint[];
  ref: TaskArg;
  description: string;
};

const stripQuestionPrefix = (input: string): string =>
  input
    .trim()
    .replace(/^what is\s+/i, '')
    .replace(/^calculate\s+/i, '')
    .replace(/^compute\s+/i, '')
    .replace(/[?.]+$/g, '')
    .trim();

const isWrappedInParentheses = (input: string): boolean => {
  if (!input.startsWith('(') || !input.endsWith(')')) {
    return false;
  }

  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0 && index < input.length - 1) {
        return false;
      }
    }
  }

  return depth === 0;
};

const stripOuterParentheses = (input: string): string => {
  let current = input.trim();
  while (isWrappedInParentheses(current)) {
    current = current.slice(1, -1).trim();
  }
  return current;
};

const findTopLevelOperator = (input: string, operators: string[]): number => {
  let depth = 0;

  for (let index = input.length - 1; index >= 0; index -= 1) {
    const char = input[index]!;
    if (char === ')') {
      depth += 1;
      continue;
    }
    if (char === '(') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    if (operators.includes(char)) {
      return index;
    }
  }

  return -1;
};

const parseArithmeticExpression = (input: string): ExprNode | null => {
  const normalized = stripOuterParentheses(input.trim());
  if (normalized.length === 0) {
    return null;
  }

  const numberValue = Number(normalized);
  if (!Number.isNaN(numberValue)) {
    return {
      type: 'number',
      value: numberValue,
    };
  }

  const lowPrecedenceIndex = findTopLevelOperator(normalized, ['+', '-']);
  if (lowPrecedenceIndex > 0) {
    const operator = normalized[lowPrecedenceIndex] as '+' | '-';
    const left = parseArithmeticExpression(normalized.slice(0, lowPrecedenceIndex));
    const right = parseArithmeticExpression(normalized.slice(lowPrecedenceIndex + 1));
    if (!left || !right) {
      return null;
    }
    return {
      type: 'binary',
      operator,
      left,
      right,
    };
  }

  const highPrecedenceIndex = findTopLevelOperator(normalized, ['*', '/']);
  if (highPrecedenceIndex > 0) {
    const operator = normalized[highPrecedenceIndex] as '*' | '/';
    const left = parseArithmeticExpression(normalized.slice(0, highPrecedenceIndex));
    const right = parseArithmeticExpression(normalized.slice(highPrecedenceIndex + 1));
    if (!left || !right) {
      return null;
    }
    return {
      type: 'binary',
      operator,
      left,
      right,
    };
  }

  return null;
};

const expressionToString = (expr: ExprNode): string => {
  if (expr.type === 'number') {
    return String(expr.value);
  }
  return `(${expressionToString(expr.left)} ${expr.operator} ${expressionToString(expr.right)})`;
};

const normalizeBinaryOperation = (
  operator: BinaryOperator,
): {
  kind: TaskKind;
  operation: TaskOperation;
} => {
  switch (operator) {
    case '+':
      return { kind: 'add_subtract', operation: 'add' };
    case '-':
      return { kind: 'add_subtract', operation: 'subtract' };
    case '*':
      return { kind: 'multiply_divide', operation: 'multiply' };
    case '/':
      return { kind: 'multiply_divide', operation: 'divide' };
    default:
      throw new Error(`Unsupported binary operator: ${operator}`);
  }
};

const createTaskIdGenerator = () => {
  let current = 1;
  return () => `t${current++}`;
};

const compileExpression = (expr: ExprNode, nextTaskId: () => string): CompileResult => {
  if (expr.type === 'number') {
    return {
      tasks: [],
      ref: expr.value,
      description: expressionToString(expr),
    };
  }

  const left = compileExpression(expr.left, nextTaskId);
  const right = compileExpression(expr.right, nextTaskId);
  const taskId = nextTaskId();
  const normalized = normalizeBinaryOperation(expr.operator);

  return {
    tasks: left.tasks.concat(right.tasks, [
      {
        id: taskId,
        description: expressionToString(expr),
        kind: normalized.kind,
        operation: normalized.operation,
        args: [left.ref, right.ref],
        dependsOn: [left.ref, right.ref]
          .filter((arg): arg is { ref: string } => typeof arg === 'object' && arg !== null)
          .map((arg) => arg.ref),
      },
    ]),
    ref: { ref: taskId },
    description: expressionToString(expr),
  };
};

const parseExpressionPlan = (input: string, nextTaskId: () => string): CompileResult | null => {
  const normalized = stripOuterParentheses(input.trim());

  const divideMatch = normalized.match(/^divide\s+(.+)\s+by\s+(.+)$/i);
  if (divideMatch) {
    const leftPlan = parseExpressionPlan(divideMatch[1]!, nextTaskId);
    const rightPlan = parseExpressionPlan(divideMatch[2]!, nextTaskId);
    if (!leftPlan || !rightPlan) {
      return null;
    }
    const taskId = nextTaskId();
    return {
      tasks: leftPlan.tasks.concat(rightPlan.tasks, [
        {
          id: taskId,
          description: `divide ${leftPlan.description} by ${rightPlan.description}`,
          kind: 'multiply_divide',
          operation: 'divide',
          args: [leftPlan.ref, rightPlan.ref],
          dependsOn: [leftPlan.ref, rightPlan.ref]
            .filter((arg): arg is { ref: string } => typeof arg === 'object' && arg !== null)
            .map((arg) => arg.ref),
        },
      ]),
      ref: { ref: taskId },
      description: `divide ${leftPlan.description} by ${rightPlan.description}`,
    };
  }

  const multiplyMatch = normalized.match(/^multiply\s+(.+)\s+by\s+(.+)$/i);
  if (multiplyMatch) {
    const leftPlan = parseExpressionPlan(multiplyMatch[1]!, nextTaskId);
    const rightPlan = parseExpressionPlan(multiplyMatch[2]!, nextTaskId);
    if (!leftPlan || !rightPlan) {
      return null;
    }
    const taskId = nextTaskId();
    return {
      tasks: leftPlan.tasks.concat(rightPlan.tasks, [
        {
          id: taskId,
          description: `multiply ${leftPlan.description} by ${rightPlan.description}`,
          kind: 'multiply_divide',
          operation: 'multiply',
          args: [leftPlan.ref, rightPlan.ref],
          dependsOn: [leftPlan.ref, rightPlan.ref]
            .filter((arg): arg is { ref: string } => typeof arg === 'object' && arg !== null)
            .map((arg) => arg.ref),
        },
      ]),
      ref: { ref: taskId },
      description: `multiply ${leftPlan.description} by ${rightPlan.description}`,
    };
  }

  const percentOfMatch = normalized.match(/^(\d+(?:\.\d+)?)%\s+of\s+(.+)$/i);
  if (percentOfMatch) {
    const percentage = Number(percentOfMatch[1]);
    const baseExpression = parseExpressionPlan(percentOfMatch[2]!, nextTaskId);
    if (!baseExpression) {
      return null;
    }
    const taskId = nextTaskId();
    return {
      tasks: baseExpression.tasks.concat([
        {
          id: taskId,
          description: `${percentage}% of ${baseExpression.description}`,
          kind: 'percentage',
          operation: 'percent_of',
          args: [percentage, baseExpression.ref],
          dependsOn:
            typeof baseExpression.ref === 'object' && baseExpression.ref !== null
              ? [baseExpression.ref.ref]
              : [],
        },
      ]),
      ref: { ref: taskId },
      description: `${percentage}% of ${baseExpression.description}`,
    };
  }

  const increaseMatch = normalized.match(/^increase\s+(.+)\s+by\s+(\d+(?:\.\d+)?)%$/i);
  if (increaseMatch) {
    const baseExpression = parseExpressionPlan(increaseMatch[1]!, nextTaskId);
    if (!baseExpression) {
      return null;
    }
    const percentage = Number(increaseMatch[2]);
    const taskId = nextTaskId();
    return {
      tasks: baseExpression.tasks.concat([
        {
          id: taskId,
          description: `increase ${baseExpression.description} by ${percentage}%`,
          kind: 'percentage',
          operation: 'increase_by_percent',
          args: [baseExpression.ref, percentage],
          dependsOn:
            typeof baseExpression.ref === 'object' && baseExpression.ref !== null
              ? [baseExpression.ref.ref]
              : [],
        },
      ]),
      ref: { ref: taskId },
      description: `increase ${baseExpression.description} by ${percentage}%`,
    };
  }

  const decreaseMatch = normalized.match(/^decrease\s+(.+)\s+by\s+(\d+(?:\.\d+)?)%$/i);
  if (decreaseMatch) {
    const baseExpression = parseExpressionPlan(decreaseMatch[1]!, nextTaskId);
    if (!baseExpression) {
      return null;
    }
    const percentage = Number(decreaseMatch[2]);
    const taskId = nextTaskId();
    return {
      tasks: baseExpression.tasks.concat([
        {
          id: taskId,
          description: `decrease ${baseExpression.description} by ${percentage}%`,
          kind: 'percentage',
          operation: 'decrease_by_percent',
          args: [baseExpression.ref, percentage],
          dependsOn:
            typeof baseExpression.ref === 'object' && baseExpression.ref !== null
              ? [baseExpression.ref.ref]
              : [],
        },
      ]),
      ref: { ref: taskId },
      description: `decrease ${baseExpression.description} by ${percentage}%`,
    };
  }

  const arithmeticExpression = parseArithmeticExpression(normalized);
  if (!arithmeticExpression) {
    return null;
  }

  return compileExpression(arithmeticExpression, nextTaskId);
};

const summarizePlan = (tasks: PlannedTaskBlueprint[]): string => {
  const rootTasks = tasks.filter((task) => task.dependsOn.length === 0).length;
  if (tasks.length === 1) {
    return 'Decomposed the request into one executable task.';
  }
  if (rootTasks === tasks.length) {
    return `Decomposed the request into ${tasks.length} independent tasks.`;
  }
  return `Decomposed the request into ${tasks.length} tasks with explicit dependencies.`;
};

const buildUnsupportedDecision = (userMessage: string, message: string): PlannerDecision => ({
  decision: 'unsupported',
  userMessageSummary: stripQuestionPrefix(userMessage),
  decompositionSummary: 'The request could not be mapped to the available math workers.',
  routingSummary: 'No worker nodes were dispatched.',
  warnings: [],
  message,
  suggestion: buildUnsupportedSuggestion(),
});

export class HeuristicPlannerRouter implements PlannerRouter {
  async plan(userMessage: string): Promise<PlannerDecision> {
    const normalized = stripQuestionPrefix(userMessage);
    const nextTaskId = createTaskIdGenerator();

    const addResultsMatch = normalized.match(/^(.+?)\s+and\s+(.+?),\s*then add the results$/i);
    if (addResultsMatch) {
      const leftPlan = parseExpressionPlan(addResultsMatch[1]!, nextTaskId);
      const rightPlan = parseExpressionPlan(addResultsMatch[2]!, nextTaskId);
      if (!leftPlan || !rightPlan) {
        return buildUnsupportedDecision(
          userMessage,
          'I could not break the request into two solvable branches and a final add step.',
        );
      }

      const mergeTaskId = nextTaskId();
      const tasks = leftPlan.tasks.concat(rightPlan.tasks, [
        {
          id: mergeTaskId,
          description: `add results of ${leftPlan.description} and ${rightPlan.description}`,
          kind: 'add_subtract',
          operation: 'add',
          args: [leftPlan.ref, rightPlan.ref],
          dependsOn: [leftPlan.ref, rightPlan.ref]
            .filter((arg): arg is { ref: string } => typeof arg === 'object' && arg !== null)
            .map((arg) => arg.ref),
        },
      ]);

      return {
        decision: 'plan',
        userMessageSummary: normalized,
        decompositionSummary: summarizePlan(tasks),
        routingSummary: 'Created two independent branches and one merge task.',
        warnings: [],
        tasks,
      };
    }

    const divideThenMatch = normalized.match(/^(.+?),\s*then divide by\s+(.+)$/i);
    if (divideThenMatch) {
      const leftPlan = parseExpressionPlan(divideThenMatch[1]!, nextTaskId);
      const divisorPlan = parseExpressionPlan(divideThenMatch[2]!, nextTaskId);
      if (!leftPlan || !divisorPlan) {
        return buildUnsupportedDecision(
          userMessage,
          'I could not turn the sequential divide request into valid tasks.',
        );
      }

      const taskId = nextTaskId();
      const tasks = leftPlan.tasks.concat(divisorPlan.tasks, [
        {
          id: taskId,
          description: `divide ${leftPlan.description} by ${divisorPlan.description}`,
          kind: 'multiply_divide',
          operation: 'divide',
          args: [leftPlan.ref, divisorPlan.ref],
          dependsOn: [leftPlan.ref, divisorPlan.ref]
            .filter((arg): arg is { ref: string } => typeof arg === 'object' && arg !== null)
            .map((arg) => arg.ref),
        },
      ]);

      return {
        decision: 'plan',
        userMessageSummary: normalized,
        decompositionSummary: summarizePlan(tasks),
        routingSummary: 'Created a sequential plan that finishes with division.',
        warnings: [],
        tasks,
      };
    }

    const independentMatch = normalized.match(/^(.+?)\s+and\s+(.+)$/i);
    if (independentMatch) {
      const leftPlan = parseExpressionPlan(independentMatch[1]!, nextTaskId);
      const rightPlan = parseExpressionPlan(independentMatch[2]!, nextTaskId);
      if (!leftPlan || !rightPlan) {
        return buildUnsupportedDecision(
          userMessage,
          'I could not break the request into independent supported expressions.',
        );
      }

      const tasks = leftPlan.tasks.concat(rightPlan.tasks);
      return {
        decision: 'plan',
        userMessageSummary: normalized,
        decompositionSummary: summarizePlan(tasks),
        routingSummary: 'Created independent tasks that can run in parallel.',
        warnings: [],
        tasks,
      };
    }

    const simplePlan = parseExpressionPlan(normalized, nextTaskId);
    if (!simplePlan) {
      return buildUnsupportedDecision(
        userMessage,
        'I can currently plan only arithmetic and percentage requests for this MVP.',
      );
    }

    return {
      decision: 'plan',
      userMessageSummary: normalized,
      decompositionSummary: summarizePlan(simplePlan.tasks),
      routingSummary: 'Created a task plan for the supported request.',
      warnings: [],
      tasks: simplePlan.tasks,
    };
  }
}
