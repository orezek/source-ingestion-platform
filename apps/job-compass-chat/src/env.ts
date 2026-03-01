import { z } from 'zod';

import { loadEnv } from '@repo/env-config';

const thinkingLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const envSchema = z.object({
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3-flash-preview'),
  GEMINI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0),
  GEMINI_THINKING_LEVEL: thinkingLevelSchema.default('LOW'),
  JOB_COMPASS_CHAT_PLANNER_MODE: z.enum(['gemini', 'heuristic']).default('gemini'),
  JOB_COMPASS_CHAT_MAX_STEPS: z.coerce.number().int().positive().default(10),
});

export type JobCompassChatEnv = z.infer<typeof envSchema>;

export const loadJobCompassChatEnv = (): JobCompassChatEnv => loadEnv(envSchema, import.meta.url);
