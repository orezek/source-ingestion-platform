import { GeminiPlannerRouter } from './gemini-planner.js';
import { HeuristicPlannerRouter } from './heuristic-planner.js';
import type { PlannerRouter } from './types.js';

export type PlannerMode = 'gemini' | 'heuristic';

export type PlannerRuntimeConfig = {
  mode: PlannerMode;
  geminiApiKey?: string;
  geminiModel: string;
  geminiTemperature: number;
  geminiThinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
};

export const createPlanner = (config: PlannerRuntimeConfig): PlannerRouter => {
  if (config.mode === 'heuristic') {
    return new HeuristicPlannerRouter();
  }

  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required when JOB_COMPASS_CHAT_PLANNER_MODE=gemini.');
  }

  return new GeminiPlannerRouter({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    temperature: config.geminiTemperature,
    thinkingLevel: config.geminiThinkingLevel,
    promptPath: 'prompts/planner-router.md',
  });
};
