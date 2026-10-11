// The rescore editor on a list's Rescoring page in Manage wordlists: rule edits
// stage into the dialog's draft and commit on its Save, with the lifecycle
// links (Reset, Disable rescoring, Make permanent) beneath the rules. The
// entry panel's provenance shows raw → rescored for committed rules.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeViaSelector, openRescoreEditor, applyRescoreEditor, openRescoreMenu } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// OCEAN (350) is remapped to 80 by the rule; TIDE (40) is left alone.
async function seedRemappedSource(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['ocean', 'tide'], scores: [350, 40],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Src', [
    { query: 'score: 350', output: '80', note: '' },
  ]));
  await scopeViaSelector(page, 'Src');
}

const oceanScore = page => page.locator('.entry-row[data-entry="ocean"] .atom-score');
const tideScore  = page => page.locator('.entry-row[data-entry="tide"] .atom-score');
const editor     = page => page.locator('#manage-dialog .manage-rules');
const ruleOutput = page => editor(page).locator('#rescore-rules .rule-row .rule-out');
const saveBtn    = page => page.locator('#manage-dialog .manage-apply-btn');

test('a rule edit commits only on Save, and the table follows', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);
  await expect(saveBtn(page)).toBeDisabled();

  await ruleOutput(page).fill('90');
  await expect(saveBtn(page)).toBeEnabled();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules[0].output)).toBe('80');

  await ruleOutput(page).blur();
  await applyRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules[0].output)).toBe('90');
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('90');
});

test('the table shows plain committed scores, no raw → rescored arrow', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);
  await ruleOutput(page).fill('90');
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(0);
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('80');
});

test('Save re-disables when an edit is reverted', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);

  await ruleOutput(page).fill('90');
  await expect(saveBtn(page)).toBeEnabled();
  await ruleOutput(page).fill('80');
  await expect(saveBtn(page)).toBeDisabled();
});

test('Cancel discards a rule edit, leaving the committed rules unchanged', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);

  await ruleOutput(page).fill('90');
  await ruleOutput(page).blur();
  await page.locator('#manage-dialog .manage-cancel-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules[0].output)).toBe('80');
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('80');
});

test('leaving one rule field for another keeps the typed value and the new focus', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);

  const row = editor(page).locator('#rescore-rules .rule-row').first();
  await row.locator('.rule-query').fill('score: 300+');
  await row.locator('.rule-out').click();
  await expect(row.locator('.rule-out')).toBeFocused();
  // macOS firefox and webkit don't bind End to the end of an input.
  await row.locator('.rule-out').evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type('5');
  await expect(row.locator('.rule-out')).toHaveValue('805');
  await expect(row.locator('.rule-query')).toHaveValue('score: 300+');
});

// Same gesture as manage-panel's dragRowBefore: the +10px nudge clears
// makeReorderable's drag-start threshold; releasing in the target's top quarter
// selects insert-before.
async function dragRuleBefore(page, fromIdx, beforeIdx) {
  const rows = editor(page).locator('#rescore-rules .rule-row');
  const h = await rows.nth(fromIdx).locator('.drag-handle').boundingBox();
  const t = await rows.nth(beforeIdx).boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 10);
  await page.mouse.move(t.x + t.width / 2, t.y + t.height * 0.25, { steps: 12 });
  await page.mouse.up();
}

test('dragging a rule to reorder it changes which rule wins (no auto-sort)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Zinc', entries: ['wave'], scores: [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Zinc', [
    { query: 'score: 40-60', output: '30', note: '' },
    { query: 'score: 50', output: '70', note: '' },
  ]));
  await scopeViaSelector(page, 'Zinc');
  const waveScore = page.locator('.entry-row[data-entry="wave"] .atom-score');
  await expect(waveScore.locator('.score-badge')).toHaveText('30');  // broad rule is first, so 50 → 30

  await openRescoreEditor(page);
  await dragRuleBefore(page, 1, 0);   // move the exact 50→70 rule above the broad one
  await expect(editor(page).locator('#rescore-rules .rule-row .rule-query').first()).toHaveValue('score: 50');

  await applyRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Zinc').rescoreRules.map(r => r.query)))
    .toEqual(['score: 50', 'score: 40-60']);
  await expect(waveScore.locator('.score-badge')).toHaveText('70');
});

const provScore = (page, entry) => page
  .locator('.entry-panel-prov tbody tr', { has: page.locator('.entry-panel-prov-entry', { hasText: new RegExp(`^${entry}$`) }) })
  .locator('.entry-panel-prov-score');

test('the panel provenance shows raw → rescored', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);

  await oceanScore(page).click();
  await expect(page.locator('#entry-panel')).toBeVisible();

  await expect(provScore(page, 'ocean').locator('.atom-score-raw')).toHaveText('350');
  await expect(provScore(page, 'ocean').locator('.atom-score-arrow')).toHaveCount(1);
  await expect(provScore(page, 'ocean').locator('.score-badge')).toHaveText('80');
});

test('an unrescored source shows a single score in the panel provenance', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);

  await tideScore(page).click();
  await expect(page.locator('#entry-panel')).toBeVisible();

  await expect(provScore(page, 'tide').locator('.score-badge')).toHaveText('40');
  await expect(provScore(page, 'tide').locator('.atom-score-arrow')).toHaveCount(0);
  await expect(provScore(page, 'tide').locator('.atom-score-raw')).toHaveCount(0);
});

test('score badges carry the tier-label tooltip in the panel, not just the table', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);

  const tableTitle = await tideScore(page).locator('.score-badge').getAttribute('title');
  expect(tableTitle).toBeTruthy();

  await tideScore(page).click();
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(provScore(page, 'tide').locator('.score-badge')).toHaveAttribute('title', tableTitle);
});

const neutralizeBtn = page => page.locator('#manage-dialog .rescore-menu .rule-neutralize-btn');

// Neutralize keeps a source's raw scores but strips Grawlix's remapping: surviving
// rules blank their outputs (ranges + notes survive as a documenting legend) while
// scoring:false rows (pure-rescore special cases) drop out entirely.
test('Disable rescoring blanks rule outputs and drops scoring:false rows on Save', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['ocean', 'tide'], scores: [350, 40],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Src', [
    { query: 'score: 350', output: '80', note: 'top tier' },
    { query: 'score: 40', output: '10', note: '', scoring: false },
  ]));
  await scopeViaSelector(page, 'Src');
  await openRescoreEditor(page);

  await openRescoreMenu(page);
  await neutralizeBtn(page).click();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules.length)).toBe(2);
  await applyRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  // The test API's getWordlist projection drops note/scoring, so the surviving
  // input + the 2→1 count carry the scoring:false-dropped assertion.
  const rules = await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules);
  expect(rules).toEqual([{ query: 'score: 350', output: '' }]);
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('350');
});

test('a background refresh mid-click does not swallow an editor click', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);
  await openRescoreMenu(page);
  const box = await neutralizeBtn(page).boundingBox();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // A cache bump re-renders Manage's left pane, as a worker summary landing would.
  await page.evaluate(() => window.__grawlixTest.setUpdateAvailable('Src', false));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Other', entries: ['reef'], scores: [50] }));
  await page.mouse.up();

  await expect(saveBtn(page)).toBeEnabled();
});

test('Disable rescoring is absent on All Wordlists (tier labels have nothing to neutralize)', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await scopeViaSelector(page, 'All Wordlists');
  await openRescoreEditor(page);
  await expect(editor(page).locator('#scoring-rules')).toBeVisible();
  await expect(neutralizeBtn(page)).toHaveCount(0);
});

test('Disable rescoring is hidden when every rule is already pass-through (a no-op)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Inert', entries: ['ocean', 'tide'], scores: [50, 40],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Inert', [
    { query: 'score: 50', output: '', note: '' },
    { query: 'score: 40', output: '', note: '' },
  ]));
  await scopeViaSelector(page, 'Inert');
  await openRescoreEditor(page);
  await expect(editor(page).locator('#rescore-rules .rule-row')).toHaveCount(2);
  await expect(neutralizeBtn(page)).toHaveCount(0);
});

const bakeBtn = page => page.locator('#manage-dialog .rescore-menu .rule-bake-btn');

test('Make permanent bakes the saved rules and stays on the page', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mine', entries: ['ocean'], scores: [350],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Mine', [
    { query: 'score: 350', output: '80', note: '' },
  ]));
  await scopeViaSelector(page, 'Mine');
  await openRescoreEditor(page);
  await expect(bakeBtn(page)).toBeEnabled();

  await openRescoreMenu(page);
  await bakeBtn(page).click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-dialog #btn-confirm-ok').click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await expect(editor(page)).toBeVisible();
  await expect.poll(() => page.evaluate(async () =>
    (await window.__grawlixTest.dumpSourceEntries('Mine')).map(e => e.score))).toEqual([80]);
  await expect(bakeBtn(page)).toBeDisabled();  // rules reset → nothing left to bake
  await expect(saveBtn(page)).toBeDisabled();  // the draft follows the reset rules
});
