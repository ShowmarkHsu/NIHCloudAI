import {defineConfig} from '@playwright/test';
import process from 'node:process';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'visual.spec.mjs',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', {open: 'never'}]] : 'line',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'zh-TW',
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
  },
  projects: [
    {name: 'desktop-1440x900', use: {viewport: {width: 1440, height: 900}}},
    {name: 'desktop-1024x768', use: {viewport: {width: 1024, height: 768}}},
  ],
  webServer: {
    command: 'npm run visual:serve',
    url: 'http://127.0.0.1:4174/tests/visual/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
