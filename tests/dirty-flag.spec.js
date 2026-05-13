// Dirty-flag behaviors — see docs/design.md § Rescore rules & tier alignment.
//
// Covers the round-trip between pristine and customized rule sets, and the
// confirm-protected "Reset to current defaults" button that restores the
// pristine state. Uses the JK publisher's defaults as the canonical baseline
// because it's the only publisher whose URL auto-fetches with a stable
// 7-rule shape that's easy to assert against.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary, focusWordlist } = require('./helpers');

// Tiny JK fixture: scores that all fall within JK's default-rule coverage
// (60, 50, 40, 30, 20, 10, 0) so the pristine state has no uncovered
// surprises distracting from the dirty-flag signal.
const JK_FIXTURE = 'WORDA;60\nWORDB;50\nWORDC;30\n';

async function populateJK(page) {
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman')?.populated)
  ).toBe(true);
  await openLibrary(page);
  await focusWordlist(page, 'John Kugelman');
}

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page, { jkugelman: JK_FIXTURE });
});

test('publisher wordlist starts pristine — no reset button visible', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.dirty).toBe(false);
  await expect(page.locator('.rule-reset-btn')).toHaveCount(0);
});

test('diverging from defaults flips dirty and shows the reset button', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);

  // Replace with a single-rule set that's obviously not the JK defaults.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('John Kugelman', [
    { input: '60', length: '', output: '50', note: '' },
  ]));

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.dirty).toBe(true);
  await expect(page.locator('.rule-reset-btn')).toBeVisible();
});

test('clicking reset restores defaults and clears the dirty flag', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);

  // Set up a dirty state.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('John Kugelman', [
    { input: '60', length: '', output: '50', note: '' },
  ]));
  await expect(page.locator('.rule-reset-btn')).toBeVisible();

  // Click reset → confirm in the dialog.
  await page.locator('.rule-reset-btn').click();
  const confirmDialog = page.locator('#confirm-dialog');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.locator('#btn-confirm-ok').click();

  // Rules back to JK's 7-rule defaults, button gone.
  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.dirty).toBe(false);
  expect(wl.rescoreRules.map(r => r.input).sort()).toEqual(['0', '10', '20', '30', '40', '50', '60']);
  await expect(page.locator('.rule-reset-btn')).toHaveCount(0);
});

test('cancel on reset keeps customizations intact', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);

  await page.evaluate(() => window.__grawlixTest.setRescoreRules('John Kugelman', [
    { input: '60', length: '', output: '50', note: '' },
  ]));
  await expect(page.locator('.rule-reset-btn')).toBeVisible();

  // Click reset → cancel.
  await page.locator('.rule-reset-btn').click();
  const confirmDialog = page.locator('#confirm-dialog');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.locator('#btn-confirm-cancel').click();

  // Customizations preserved, button still visible.
  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.dirty).toBe(true);
  expect(wl.rescoreRules).toHaveLength(1);
  await expect(page.locator('.rule-reset-btn')).toBeVisible();
});
