import { defineConfig } from '@playwright/test';

const port = 3105;

export default defineConfig({
  testDir: './src/test/e2e',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `DASHBOARD_DATA_MODE=fixture DASHBOARD_FIXTURE_DIR=./src/test/fixtures pnpm dev --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
