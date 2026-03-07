import { END, Send, START, StateGraph } from '@langchain/langgraph';

import type { PlannerRouter } from '../planner/types.js';
import {
  ChatStateAnnotation,
  createInitialState,
  type ActiveExecution,
  type ChatState,
  type TaskKind,
} from './state.js';
import { addSubtractNode } from './add-subtract-node.js';
import { createPlannerRouterNode } from './planner-router-node.js';
import { multiplyDivideNode } from './multiply-divide-node.js';
import { percentageNode } from './percentage-node.js';
import { getTaskById, getWorkerNodeForTaskKind, resolveTaskArgs } from './task-utils.js';

export type ChatGraphConfig = {
  planner: PlannerRouter;
  maxSteps: number;
};

const resolveActiveExecution = (state: ChatState, taskId: string): ActiveExecution => {
  const task = getTaskById(state.tasks, taskId);
  if (!task) {
    throw new Error(`Attempted to dispatch unknown task ${taskId}.`);
  }

  return {
    taskId,
    description: task.description,
    operation: task.operation,
    resolvedArgs: resolveTaskArgs(task, state.tasks),
    workerNode: getWorkerNodeForTaskKind(task.kind as TaskKind),
  };
};

export const createChatGraph = (config: ChatGraphConfig) => {
  const plannerRouterNode = createPlannerRouterNode(config.planner, config.maxSteps);

  return new StateGraph(ChatStateAnnotation)
    .addNode('plannerRouterNode', plannerRouterNode)
    .addNode('addSubtractNode', addSubtractNode)
    .addNode('multiplyDivideNode', multiplyDivideNode)
    .addNode('percentageNode', percentageNode)
    .addEdge(START, 'plannerRouterNode')
    .addConditionalEdges('plannerRouterNode', async (state) => {
      if (state.finalAnswer !== null || state.readyTaskIds.length === 0) {
        return END;
      }

      return state.readyTaskIds.map((taskId) => {
        const execution = resolveActiveExecution(state, taskId);
        return new Send(execution.workerNode, {
          tasks: state.tasks,
          stepCount: state.stepCount,
          activeExecution: execution,
        });
      });
    })
    .addEdge('addSubtractNode', 'plannerRouterNode')
    .addEdge('multiplyDivideNode', 'plannerRouterNode')
    .addEdge('percentageNode', 'plannerRouterNode')
    .compile();
};

export const runChatGraph = async (
  config: ChatGraphConfig,
  userMessage: string,
): Promise<ChatState> => {
  const graph = createChatGraph(config);
  return graph.invoke(createInitialState(userMessage));
};
