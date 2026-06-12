// Auto-seeded inert rescore rules — see docs/design.md § Rescore rules.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('does not auto-seed for known publishers — publisher defaults are preserved', async ({ page }) => {
  // JK auto-fetches at boot. Stub it with a fixture whose only score (42) is
  // outside JK's default-rule coverage. If auto-seed were firing wrongly,
  // rescoreRules would shrink to [{input:'42'}]. The publisher gate keeps
  // JK's 7 default rules intact.
  await stubPublisherFetches(page, { jkugelman: 'TESTWORD;42\n' });
  await gotoApp(page);

  // Boot kicks off the JK fetch fire-and-forget. Poll until the wordlist is
  // populated rather than racing the network.
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman')?.populated)
  ).toBe(true);

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.publisherId).toBe('jkugelman');
  expect(wl.rescoreRules.length).toBe(7);            // JK's published defaults
  expect(wl.rescoreRules.map(r => r.input)).not.toContain('42');
});
