// Dirty-flag behaviors — see docs/design.md § Rescore rules.
//
// Covers the round-trip between pristine and customized rule sets, and the
// confirm-protected "Reset to defaults" button that restores the pristine
// state. Uses the JK publisher's defaults as the canonical baseline because
// it's the only publisher whose URL auto-fetches with a stable 7-rule shape
// that's easy to assert against.
//
// The editor batches edits into a draft, so a rule mutation only flips the
// committed dirty flag on Apply. Tests that assert a divergent committed state
// set it through the setRescoreRules backdoor before opening the editor (so the
// draft snapshots it), then drive the UI and Apply.

import { test, expect } from '@playwright/test';
import { awaitSettle, stubPublisherFetches, gotoApp, scopeViaSelector, openRescoreEditor, applyRescoreEditor } from './helpers.js';

// Tiny JK fixture: scores that all fall within JK's default-rule coverage
// (60, 50, 40, 30, 20, 10, 0), so rescoring is a clean passthrough and the
// dirty-flag signal stands alone.
const JK_FIXTURE = 'WORDA;60\nWORDB;50\nWORDC;30\n';

// The waits below go through awaitSettle, not a bare evaluate: each holds the
// frame's main-world context open across a fetch drain or a worker round-trip,
// which full-matrix contention can drop mid-call (see helpers.js).
async function populateJK(page) {
  await awaitSettle(page, () => window.__grawlixTest.loadIdle());
  await scopeViaSelector(page, 'John Kugelman');
}

const ONE_RULE = [{ input: '60', length: '', output: '50', note: '' }];
const DEFAULT_INPUTS = ['0', '10', '20', '30', '40', '50', '60'];
const setJKRules = (page, rules) =>
  awaitSettle(page, r => window.__grawlixTest.setRescoreRules('John Kugelman', r), rules);
const readJK = page =>
  awaitSettle(page, () => window.__grawlixTest.getWordlist('John Kugelman'));

// Absence assertions pass just as well against an editor that never rendered,
// so each is preceded by the rule-row count that proves the draft it should be
// reading. Without it a blank editor reads as "no reset button" and the test
// goes green having checked nothing.
const expectRuleRows = (page, n) =>
  expect(page.locator('#rescore-editor .rule-row')).toHaveCount(n);

// A rescore-editor repaint rebuilds the footer and can swallow a click landing
// on it, leaving the dialog closed and the rest of the test asserting against an
// un-reset draft (wordlist-selector.spec.js hit the same thing on bake). Re-click
// until the dialog opens, skipping the click once it has so the retry can't fire
// a second one into the modal.
async function clickResetAwaitingConfirm(page) {
  const dialog = page.locator('#confirm-dialog');
  await expect(async () => {
    if (!await dialog.isVisible()) await page.locator('.rule-reset-btn').click();
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page, { jkugelman: JK_FIXTURE });
});

test('publisher wordlist starts pristine — no reset button visible', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);
  await openRescoreEditor(page);

  const wl = await readJK(page);
  expect(wl.dirty).toBe(false);
  await expectRuleRows(page, DEFAULT_INPUTS.length);
  await expect(page.locator('.rule-reset-btn')).toHaveCount(0);
});

test('diverging from defaults flips dirty and shows the reset button', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);

  await setJKRules(page, ONE_RULE);
  await openRescoreEditor(page);

  const wl = await readJK(page);
  expect(wl.dirty).toBe(true);
  await expect(page.locator('.rule-reset-btn')).toBeVisible();
});

test('clicking reset restores defaults and clears the dirty flag', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);
  await setJKRules(page, ONE_RULE);
  await openRescoreEditor(page);
  await expect(page.locator('.rule-reset-btn')).toBeVisible();

  const confirmDialog = await clickResetAwaitingConfirm(page);
  await confirmDialog.locator('#btn-confirm-ok').click();
  await expectRuleRows(page, DEFAULT_INPUTS.length);
  await expect(page.locator('.rule-reset-btn')).toHaveCount(0);
  await applyRescoreEditor(page);

  const wl = await readJK(page);
  expect(wl.dirty).toBe(false);
  expect(wl.rescoreRules.map(r => r.input).sort()).toEqual(DEFAULT_INPUTS);
});

test('cancel on reset keeps customizations intact', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);
  await setJKRules(page, ONE_RULE);
  await openRescoreEditor(page);
  await expect(page.locator('.rule-reset-btn')).toBeVisible();

  const confirmDialog = await clickResetAwaitingConfirm(page);
  await confirmDialog.locator('#btn-confirm-cancel').click();

  const wl = await readJK(page);
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
  await setJKRules(page, [
    { input: '60', length: '', output: '50', note: '' },
    { input: '50', length: '1-2', output: '30', note: '', scoring: false },
  ]);
  await openRescoreEditor(page);

  const editor = page.locator('#rescore-editor');
  await editor.locator('.rule-neutralize-btn').click();
  await applyRescoreEditor(page);

  const wl = await readJK(page);
  expect(wl.dirty).toBe(true);
  expect(wl.rescoreRules).toEqual([{ input: '60', length: '', output: '' }]);

  // Reopen: neutralized rules still diverge from JK's defaults, so Reset stays.
  await openRescoreEditor(page);
  await expect(editor.locator('.rule-reset-btn')).toBeVisible();
});

// The migration guard: a pre-existing user whose pristine rules were stored in
// the old auto-sorted order (which order-sensitive equality now reads as
// "differs from defaults") must NOT be marked dirty — propagateDefaults
// renormalizes the order off the persisted (false) flag.
test('a pristine list with rules in a non-default order is renormalized, staying not-dirty', async ({ page }) => {
  await gotoApp(page);
  await populateJK(page);

  const result = await awaitSettle(page, () => {
    const wl = state.sources.find(s => s.name === 'John Kugelman');
    wl.rescoreRules = [...wl.rescoreRules].reverse();   // a non-authored order, still pristine
    wl.dirty = false;
    window.__grawlixTest.propagateDefaults();
    return { dirty: !!wl.dirty, inputs: wl.rescoreRules.map(r => r.input) };
  });

  expect(result.dirty).toBe(false);
  expect(result.inputs).toEqual(['60', '50', '40', '30', '20', '10', '0']);
});
