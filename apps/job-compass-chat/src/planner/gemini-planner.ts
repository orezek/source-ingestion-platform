import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

import { plannerDecisionSchema } from './planner-schema.js';
import { loadPromptMarkdown } from './prompt-loader.js';
import type { PlannerDecision, PlannerRouter } from './types.js';

export type GeminiPlannerConfig = {
  apiKey: string;
  model: string;
  temperature: number;
  thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  promptPath: string;
};

export class GeminiPlannerRouter implements PlannerRouter {
  private readonly structuredModel;

  private readonly promptContentPromise: Promise<string>;

  constructor(config: GeminiPlannerConfig) {
    const model = new ChatGoogleGenerativeAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxRetries: 2,
      thinkingConfig: config.thinkingLevel ? { thinkingLevel: config.thinkingLevel } : undefined,
    });

    this.structuredModel = model.withStructuredOutput(plannerDecisionSchema, {
      name: 'job_compass_chat_planner_record',
    });
    this.promptContentPromise = loadPromptMarkdown(config.promptPath);
  }

  async plan(userMessage: string): Promise<PlannerDecision> {
    const promptContent = await this.promptContentPromise;
    const result = await this.structuredModel.invoke(
      `${promptContent}\n\n## User Request\n\n${userMessage}`,
    );

    return plannerDecisionSchema.parse(result);
  }
}
