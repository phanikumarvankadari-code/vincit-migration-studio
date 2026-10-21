import { defineConfig, devices } from '@playwright/test';

// Smoke test against an already running container (see npm run e2e:container).
export default defineConfig({
  testDir: './e2e-container',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: process.env['MMS_URL'] ?? 'http://127.0.0.1:8080' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
