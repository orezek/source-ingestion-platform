import 'server-only';
import { loadEnv } from '@repo/env-config';
import { z } from 'zod';

const envSchema = z.object({
  CONTROL_SERVICE_BASE_URL: z.url(),
  CONTROL_SHARED_TOKEN: z.string().trim().min(1),
});

export type ControlCenterEnv = z.infer<typeof envSchema>;

let cachedEnv: ControlCenterEnv | null = null;

export const getEnv = (): ControlCenterEnv => {
  if (!cachedEnv) {
    cachedEnv = loadEnv(envSchema, import.meta.url);
  }

  return cachedEnv;
};
