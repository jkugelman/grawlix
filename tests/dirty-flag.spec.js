// Dirty-flag behaviors — see docs/design.md § Rescore rules.
//
// Covers the round-trip between pristine and customized rule sets, and the
// confirm-protected "Reset to defaults" button that restores the pristine
// state. Uses the JK publisher's defaults as the canonical baseline because
// it's the only publisher whose URL auto-fetches with a stable 7-rule shape
// that's easy to assert against.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeViaSelector, openRescoreEditor } = require('./helpers');

// Tiny JK fixture: scores that all fall within JK's default-rule coverage
// (60, 50, 40, 30, 20, 10, 0), so rescoring is a clean passthrough and the
// dirty-flag signal stands alone.
const JK_FIXTURE = 'WORDA;60\nWORDB;50\nWORDC;30\n';

async function populateJK(page) {
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman')?.populated)
  ).toBe(true);
  await scopeViaSelector(page, 'John Kugelman');
  await openRescoreEditor(page);
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

  // Wait for the post-reset render before reading state — the dialog click
  // hands off async work (await showConfirm → mutate rules → repaint), and
  // a synchronous read of getWordlist would race that completion. The reset
  // button disappearing is the DOM signal that dirty has flipped back.
  await expect(page.locator('.rule-reset-btn')).toHaveCount(0);

  // Rules back to JK's 7-rule defaults.
  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.dirty).toBe(false);
  expect(wl.rescoreRules.map(r => r.input).sort()).toEqual(['0', '10', '20', '30', '40', '50', '60']);
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

// On a list with defaults, neutralize leaves rules that diverge from those
// defaults, so it flips dirty and keeps Reset available to undo it. Seed remap
// rules first (JK's own defaults are already blank-output, so neutralizing the
// pristine list would be a no-op with nothing to assert).
test('neutralize flips dirty, blanks every output, drops scoring:false, keeps Reset available', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);

  await page.evaluate(() => window.__grawlixTest.setRescoreRules('John Kugelman', [
    { input: '60', length: '', output: '50', note: '' },
    { input: '50', length: '1-2', output: '30', note: '', scoring: false },
  ]));

  const editor = page.locator('#workshop-rescore-editor');
  await editor.locator('.rule-neutralize-btn').click();
  const confirmDialog = page.locator('#confirm-dialog');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.locator('#btn-confirm-ok').click();

  // Reset reappearing is the DOM signal that the post-neutralize render settled.
  await expect(editor.locator('.rule-reset-btn')).toBeVisible();

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.dirty).toBe(true);
  expect(wl.rescoreRules).toEqual([{ input: '60', length: '', output: '' }]);
});
