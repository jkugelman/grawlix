const { defineConfig, devices } = require('@playwright/test');

// Single project (Chromium) for now. WebKit and Firefox are easy to add but
// out of scope until the multi-browser signal earns its keep.
//
// Tests run against a static server hosting site/. The ?test=1 isn't used —
// __grawlixTest is exposed unconditionally on window (see Test API section at
// the bottom of site/index.html).
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'python3 -m http.server 4173 --directory site --bind 127.0.0.1',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
