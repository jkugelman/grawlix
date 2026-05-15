const { defineConfig, devices } = require('@playwright/test');

// Three projects: Chromium, Firefox, WebKit. Each runs the full suite.
// Tests run against a static server hosting site/. __grawlixTest is exposed
// unconditionally on window (see Test API section at the bottom of
// site/index.html).
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
    { name: 'chromium', use: { ...devices['Desktop Chrome']  } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari']  } },
  ],
  webServer: {
    // Equivalent to `python3 -m http.server`, but with log_message stubbed out
    // so per-request access logs don't flood the test output. Genuine failures
    // (port in use, missing file) raise exceptions rather than routing through
    // log_message, so stderr: 'pipe' still surfaces real errors.
    command: `python3 -c "import http.server as h,functools; h.SimpleHTTPRequestHandler.log_message=lambda *a:None; h.test(HandlerClass=functools.partial(h.SimpleHTTPRequestHandler,directory='site'),port=4173,bind='127.0.0.1')"`,
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
