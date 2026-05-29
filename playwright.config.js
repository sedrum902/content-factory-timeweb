import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    { name: 'desktop-1920', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-1366', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'tablet-768', use: { ...devices['iPad (gen 7)'] } },
    { name: 'mobile-430', use: { ...devices['iPhone 14 Pro Max'] } },
    { name: 'mobile-390', use: { ...devices['iPhone 13'] } },
    { name: 'mobile-360', use: { ...devices['Galaxy S9+'] } }
  ]
});
