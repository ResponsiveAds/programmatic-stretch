import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://localhost:3333',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npx serve -l 3333 .',
    port: 3333,
    reuseExistingServer: !process.env.CI,
  },
});
