import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = 3105;
const appDir = path.dirname(fileURLToPath(import.meta.url));
const controlPlaneRoot = path.resolve(appDir, '.playwright-control-plane');

export default defineConfig({
  testDir: './src/test/e2e',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: [
      `DASHBOARD_DATA_MODE=fixture`,
      `DASHBOARD_FIXTURE_DIR=./src/test/fixtures`,
      `CONTROL_PLANE_EXECUTION_MODE=fixture`,
      `CONTROL_PLANE_DATA_DIR=${path.join(controlPlaneRoot, 'state')}`,
      `CONTROL_PLANE_BROKER_DIR=${path.join(controlPlaneRoot, 'broker')}`,
      `CONTROL_PLANE_WORKER_LOG_DIR=${path.join(controlPlaneRoot, 'logs')}`,
      `CONTROL_PLANE_DEFAULT_ARTIFACT_DIR=${path.join(controlPlaneRoot, 'artifacts')}`,
      `CONTROL_PLANE_DEFAULT_JSON_OUTPUT_DIR=${path.join(controlPlaneRoot, 'json-output')}`,
      `pnpm dev --port ${port}`,
    ].join(' '),
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
