import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

// Base URL of the app under test. Override with BASE_URL=... on the command line.
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const apiBaseURL = process.env.API_BASE_URL ?? baseURL;

// Remember the target so the PDF report can print it.
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/run-info.json', JSON.stringify({ baseURL, apiBaseURL }));

export default defineConfig({
  testDir: './tests',
  outputDir: './artifacts/test-output',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? 'artifacts/results.json' }],
    ['html', { outputFolder: 'artifacts/html-report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'e2e', outputDir: './artifacts/test-output/e2e', testMatch: 'e2e/**/*.spec.ts', use: { ...devices['Desktop Chrome'], baseURL } },
    { name: 'api', outputDir: './artifacts/test-output/api', testMatch: 'api/**/*.spec.ts', use: { baseURL: apiBaseURL } },
    { name: 'a11y', outputDir: './artifacts/test-output/a11y', testMatch: 'a11y/**/*.spec.ts', use: { ...devices['Desktop Chrome'], baseURL } },
  ],
  // Start the app automatically when QA_WEB_SERVER is set, e.g.
  //   QA_WEB_SERVER="npm run dev --prefix .." npm run test:e2e
  webServer: process.env.QA_WEB_SERVER
    ? { command: process.env.QA_WEB_SERVER, url: baseURL, reuseExistingServer: true, timeout: 120_000 }
    : undefined,
});
