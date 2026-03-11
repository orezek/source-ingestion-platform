import { defineConfig } from '@playwright/test';

const port = 3107;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: false,
    trace: 'retain-on-failure',
    viewport: {
      width: 1440,
      height: 900,
    },
  },
  webServer: {
    command: [
      'CONTROL_SERVICE_BASE_URL=http://127.0.0.1:39999',
      'CONTROL_SHARED_TOKEN=e2e-local-token',
      `pnpm build && pnpm start --port ${port}`,
    ].join(' '),
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
