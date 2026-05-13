// Tier-alignment behaviors — see docs/design.md § Rescore rules & tier alignment.
//
// Covers auto-seed-on-import, the Unhandled-scores banner, and the
// severity-bubble propagation from card → Library nav tab. The dirty-flag
// round-trip and severity priority live in a separate spec.

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
  expect(wl.uncovered).toEqual([]);

  // DOM: editor shows three rule rows, banner is absent (everything covered).
  await openLibrary(page);
  await focusWordlist(page, 'Tiny');
  await expect(page.locator('#rescore-rules .rule-row')).toHaveCount(3);
  await expect(page.locator('.rule-banner')).toHaveCount(0);
});

test('does not auto-seed when distinct scores exceed the threshold (>10)', async ({ page }) => {
  await gotoApp(page);
  // 11 distinct scores — above AUTO_SEED_SCORE_LIMIT.
  const scores = Array.from({ length: 11 }, (_, i) => (i + 1) * 5);
  await page.evaluate(s => window.__grawlixTest.addCustomWordlist({ name: 'Big', scores: s }), scores);

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Big'));
  expect(wl.rescoreRules).toHaveLength(0);
  expect(wl.uncovered).toEqual(scores);

  // DOM: no rule rows, banner is present and lists the uncovered scores.
  await openLibrary(page);
  await focusWordlist(page, 'Big');
  await expect(page.locator('#rescore-rules .rule-row')).toHaveCount(0);
  await expect(page.locator('.rule-banner')).toBeVisible();
  await expect(page.locator('.rule-banner')).toContainText('Unhandled');
});

test('does not auto-seed for known publishers — publisher defaults are preserved', async ({ page }) => {
  // JK auto-fetches at boot. Stub it with a fixture whose only score (42) is
  // outside JK's default-rule coverage. If auto-seed were firing wrongly,
  // rescoreRules would shrink to [{input:'42'}]. The publisher gate keeps
  // JK's 7 default rules intact and the unknown score lands in _uncovered.
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
  expect(wl.uncovered).toEqual([42]);
});

test('uncovered scores show an orange bubble on the card and Library nav tab', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mixed', scores: [10, 30, 50],
  }));
  // Replace the auto-seeded rules with one that only covers 50. 10 and 30
  // become uncovered. Score range stays inside the default tier scale so
  // we're isolating the rescore-side bubble; tier-side coverage is fine.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Mixed', [
    { input: '50', length: '', output: '', note: '' },
  ]));

  // Nav tab bubble is rendered regardless of which view is active.
  await expect(
    page.locator('.header-nav-item[data-view="library"] .severity-bubble[data-severity="warning"]')
  ).toBeVisible();

  // Card bubble appears once Library is open.
  await openLibrary(page);
  const card = page.locator('.wordlist-card[data-wordlist]', { hasText: 'Mixed' });
  await expect(card.locator('.severity-bubble[data-severity="warning"]')).toBeVisible();
});

test('bubble clears when rules cover all scores', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mixed', scores: [10, 30, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Mixed', [
    { input: '50', length: '', output: '', note: '' },
  ]));
  await openLibrary(page);
  const card = page.locator('.wordlist-card[data-wordlist]', { hasText: 'Mixed' });
  const navBubble = page.locator('.header-nav-item[data-view="library"] .severity-bubble[data-severity="warning"]');

  // Precondition: bubbles present.
  await expect(card.locator('.severity-bubble[data-severity="warning"]')).toBeVisible();
  await expect(navBubble).toBeVisible();

  // Widen the rule to cover everything.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Mixed', [
    { input: '0-100', length: '', output: '', note: '' },
  ]));

  // Both bubbles gone. (The bubble span is removed entirely, not just
  // hidden — so we assert count 0 rather than not-visible.)
  await expect(card.locator('.severity-bubble[data-severity="warning"]')).toHaveCount(0);
  await expect(navBubble).toHaveCount(0);
});

test('rules editor shows the Unhandled-scores banner alongside the + Add rule button', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mixed', scores: [10, 30, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Mixed', [
    { input: '50', length: '', output: '', note: '' },
  ]));
  await openLibrary(page);
  await focusWordlist(page, 'Mixed');

  // Banner above the list, lists the uncovered scores by name.
  const banner = page.locator('.rule-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Unhandled');
  await expect(banner).toContainText('10');
  await expect(banner).toContainText('30');

  // + Add rule button is a sibling, not nested inside the banner — they're
  // intentionally separate affordances.
  const addBtn = page.locator('.rule-add-btn');
  await expect(addBtn).toBeVisible();
  await expect(banner.locator('.rule-add-btn')).toHaveCount(0);
});
