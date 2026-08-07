import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Three projects: Chromium, Firefox, WebKit. Each runs the full suite.
// Tests run against a static server hosting site/. __grawlixTest is exposed
// unconditionally on window (see Test API section at the bottom of
// site/index.html).
// CI overrides GRAWLIX_SITE_DIR to `dist` so the suite verifies the deployed
// minified bundle; drop this indirection and CI silently tests the source.
const siteDir = process.env.GRAWLIX_SITE_DIR || 'site';

// Keyed by served directory, not hardcoded: a shared port let a run silently
// attach to a parallel worktree's leftover server and test its bundle, surfacing
// as phantom failures. Reuse stays off so a collision is a loud port error.
const servedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), siteDir);
const derivedPort = 20_000 + (createHash('sha1').update(servedDir).digest().readUInt32BE(0) % 20_000);
const port = Number(process.env.GRAWLIX_PORT) || derivedPort;
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Not what CI runs: ci.yml's per-job --workers flag overrides this.
  workers: process.env.CI ? 1 : undefined,
  // A cold WebKit boot under a local fully-parallel `npm test` (worker build + IDB +
  // sync-target loads all contending for the CPU) can exceed Playwright's 30s default,
  // so whenBootSettled times out with no local retry net; CI never hits it, where
  // webkit stays single-worker and retries. Confirmed surgically: a >30s boot times
  // out at 30s and passes above it.
  timeout: 60_000,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'html',
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome']  } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari']  } },
  ],
  webServer: {
    // Quiet `python3 -m http.server` that also reaps itself once orphaned -- a
    // SIGKILLed run can't stop it, and a survivor holds this port and wedges
    // every later run on the same directory. See scripts/test-server.py.
    command: `python3 scripts/test-server.py ${siteDir} ${port}`,
    url: `${origin}/index.html`,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
