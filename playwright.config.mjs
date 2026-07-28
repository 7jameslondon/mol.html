import { defineConfig, devices } from '@playwright/test';

const scheduled = process.env.MOLHTML_SCHEDULED === '1';
const allBrowsers = process.env.MOLHTML_ALL_BROWSERS === '1';
const ci = Boolean(process.env.CI);
const linuxWebGLArgs = process.platform === 'linux'
  ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  : [];

const projects = [
  {
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { args: linuxWebGLArgs }
    }
  }
];

if (allBrowsers) {
  projects.push(
    {
      name: 'firefox',
      testMatch: [/smoke\.spec\.mjs/, /save-roundtrip\.spec\.mjs/],
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      testMatch: [/smoke\.spec\.mjs/, /save-roundtrip\.spec\.mjs/],
      use: { ...devices['Desktop Safari'] }
    }
  );
}

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  testIgnore: scheduled ? [] : [/performance\.spec\.mjs/, /visual\.spec\.mjs/],
  use: {
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    acceptDownloads: true,
    trace: ci ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
    video: ci ? 'retain-on-failure' : 'off'
  },
  projects
});
