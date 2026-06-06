// Auto-seeded inert rescore rules — see docs/design.md § Rescore rules.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary, focusWordlist } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('auto-seeds inert rules on custom-wordlist import with ≤10 distinct scores', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Tiny', scores: [10, 30, 50],
  }));

  // Backend snapshot: three rules, one per distinct score, outputs blank.
  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Tiny'));
  expect(wl.rescoreRules).toHaveLength(3);
  expect(wl.rescoreRules.map(r => r.input).sort()).toEqual(['10', '30', '50']);
  expect(wl.rescoreRules.every(r => r.output === '')).toBe(true);

  // DOM: editor shows three rule rows.
  await openLibrary(page);
  await focusWordlist(page, 'Tiny');
  await expect(page.locator('#rescore-rules .rule-row')).toHaveCount(3);
});

test('does not auto-seed when distinct scores exceed the threshold (>10)', async ({ page }) => {
  await gotoApp(page);
  // 11 distinct scores — above AUTO_SEED_SCORE_LIMIT.
  const scores = Array.from({ length: 11 }, (_, i) => (i + 1) * 5);
  await page.evaluate(s => window.__grawlixTest.addCustomWordlist({ name: 'Big', scores: s }), scores);

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Big'));
  expect(wl.rescoreRules).toHaveLength(0);

  // DOM: no rule rows.
  await openLibrary(page);
  await focusWordlist(page, 'Big');
  await expect(page.locator('#rescore-rules .rule-row')).toHaveCount(0);
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
