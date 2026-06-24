// The live rule-arrow preview: while the rescore editor is open and
// scoped to a source, rows a rule remapped show `raw → rescored` in the score
// cell; unaffected rows show a single badge. Closing the editor — or scoping to
// All Wordlists, where the editor edits tier labels, not scores — drops every arrow.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeViaSelector, openRescoreEditor, applyRescoreEditor } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// OCEAN (350) is remapped to 80 by the rule; TIDE (40) is left alone.
async function seedRemappedSource(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['ocean', 'tide'], scores: [350, 40],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Src', [
    { input: '350', length: '', output: '80', note: '' },
  ]));
  await scopeViaSelector(page, 'Src');
}

const oceanScore = page => page.locator('.entry-row[data-entry="ocean"] .atom-score');
const tideScore  = page => page.locator('.entry-row[data-entry="tide"] .atom-score');

test('an open editor shows raw → rescored on remapped rows, single score on others', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);

  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(0);
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('80');

  await openRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await expect(oceanScore(page).locator('.atom-score-raw')).toHaveText('350');
  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(1);
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('80');

  await expect(tideScore(page).locator('.atom-score-arrow')).toHaveCount(0);
  await expect(tideScore(page).locator('.atom-score-raw')).toHaveCount(0);
  await expect(tideScore(page).locator('.score-badge')).toHaveText('40');
});

test('closing the editor removes the arrow', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(1);

  await page.locator('#wordlist-bar .rescore-toggle').click();
  await expect(page.locator('#rescore-editor')).toBeHidden();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(0);
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('80');
});

const ruleOutput = page => page.locator('#rescore-rules .rule-row .rule-out');

const applyBtn = page => page.locator('#rescore-editor .rescore-apply');

test('editing a rule output previews live on every keystroke and only commits on Apply', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('80');
  await expect(applyBtn(page)).toBeDisabled();

  // fill dispatches input but not change, so a passing preview here proves the
  // keystroke (oninput) path drove it — no blur/commit yet.
  await ruleOutput(page).fill('90');
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('90');
  await expect(oceanScore(page).locator('.atom-score-raw')).toHaveText('350');
  await expect(applyBtn(page)).toBeEnabled();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules[0].output)).toBe('80');

  await ruleOutput(page).blur();
  await applyRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules[0].output)).toBe('90');
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('90');
});

test('Apply is disabled with no changes and re-disables when an edit is reverted', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);
  await expect(applyBtn(page)).toBeDisabled();

  await ruleOutput(page).fill('90');
  await expect(applyBtn(page)).toBeEnabled();

  await ruleOutput(page).fill('80');
  await expect(applyBtn(page)).toBeDisabled();
});

test('Cancel discards a rule edit, leaving the committed rules unchanged', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await ruleOutput(page).fill('90');
  await ruleOutput(page).blur();
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('90');

  await page.locator('#rescore-editor .rescore-cancel').click();
  await expect(page.locator('#rescore-editor')).toBeHidden();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules[0].output)).toBe('80');
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('80');
  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(0);
});

// Same gesture as manage-panel's dragRowBefore: the +10px nudge clears
// makeReorderable's drag-start threshold; releasing in the target's top quarter
// selects insert-before.
async function dragRuleBefore(page, fromIdx, beforeIdx) {
  const rows = page.locator('#rescore-rules .rule-row');
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
    { input: '40-60', length: '', output: '30', note: '' },
    { input: '50',    length: '', output: '70', note: '' },
  ]));
  await scopeViaSelector(page, 'Zinc');
  await openRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const waveScore = page.locator('.entry-row[data-entry="wave"] .atom-score');
  await expect(waveScore.locator('.score-badge')).toHaveText('30');  // broad rule is first, so 50 → 30

  await dragRuleBefore(page, 1, 0);   // move the exact 50→70 rule above the broad one
  await expect(waveScore.locator('.score-badge')).toHaveText('70');  // now the exact rule wins

  await applyRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Zinc').rescoreRules.map(r => r.input)))
    .toEqual(['50', '40-60']);
  await expect(waveScore.locator('.score-badge')).toHaveText('70');
});

test('on All Wordlists the editor edits tier labels, so no row shows an arrow', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  // Open the editor on the source (arrow present), then scope to All Wordlists. The editor
  // stays open but switches to tier labels, so the arrow must vanish.
  await openRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(1);

  await scopeViaSelector(page, 'All Wordlists');
  await expect(page.locator('#rescore-editor')).toBeVisible();
  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(0);
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('80');
});

const provScore = (page, entry) => page
  .locator('.entry-panel-prov tbody tr', { has: page.locator('.entry-panel-prov-entry', { hasText: new RegExp(`^${entry}$`) }) })
  .locator('.entry-panel-prov-score');

test('the panel provenance shows raw → rescored without opening the editor', async ({ page }) => {
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

const neutralizeBtn = page => page.locator('#rescore-editor .rule-neutralize-btn');

// Neutralize keeps a source's raw scores but strips Grawlix's remapping: surviving
// rules blank their outputs (ranges + notes survive as a documenting legend) while
// scoring:false rows (pure-rescore special cases) drop out entirely.
test('Neutralize blanks rule outputs, drops scoring:false rows, and clears the arrows', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['ocean', 'tide'], scores: [350, 40],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Src', [
    { input: '350', length: '', output: '80', note: 'top tier' },
    { input: '40', length: '', output: '10', note: '', scoring: false },
  ]));
  await scopeViaSelector(page, 'Src');
  await openRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(1);

  await neutralizeBtn(page).click();

  // Disable rescoring stages into the draft: the preview drops the arrow at
  // once, but the committed rules only change on Apply.
  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(0);
  await applyRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  // Only the non-scoring:false rule survives, and its output is blanked. (The
  // test API's getWordlist projection drops note/scoring, so the surviving
  // input + the 2→1 count carry the scoring:false-dropped assertion.)
  const rules = await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules);
  expect(rules).toEqual([{ input: '350', length: '', output: '' }]);

  await expect(oceanScore(page).locator('.atom-score-arrow')).toHaveCount(0);
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('350');
});

test('Neutralize is absent on All Wordlists (tier labels have nothing to neutralize)', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await scopeViaSelector(page, 'All Wordlists');
  await openRescoreEditor(page);
  await expect(neutralizeBtn(page)).toHaveCount(0);
});

test('Disable rescoring is hidden when every rule is already pass-through (a no-op)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Inert', entries: ['ocean', 'tide'], scores: [50, 40],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Inert', [
    { input: '50', length: '', output: '', note: '' },
    { input: '40', length: '', output: '', note: '' },
  ]));
  await scopeViaSelector(page, 'Inert');
  await openRescoreEditor(page);
  await expect(page.locator('#rescore-rules .rule-row')).toHaveCount(2);
  await expect(neutralizeBtn(page)).toHaveCount(0);
});

const bakeBtn = page => page.locator('#rescore-editor .rule-bake-btn');

async function seedBakeable(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mine', entries: ['ocean'], scores: [350],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Mine', [
    { input: '350', length: '', output: '', note: '' },
  ]));
  await scopeViaSelector(page, 'Mine');
  await openRescoreEditor(page);
}

test('Make permanent enables live as you type, before any blur or Apply', async ({ page }) => {
  await gotoApp(page);
  await seedBakeable(page);
  await expect(bakeBtn(page)).toBeDisabled();  // committed rule is pass-through

  // fill dispatches input but not blur, so this proves the live (oninput) path
  // lights the button without a focus shift.
  await ruleOutput(page).fill('80');
  await expect(applyBtn(page)).toBeEnabled();  // still uncommitted
  await expect(bakeBtn(page)).toBeEnabled();   // yet bakeable already
});

test('Make permanent bakes an unsaved draft and leaves the editor open', async ({ page }) => {
  await gotoApp(page);
  await seedBakeable(page);
  await ruleOutput(page).fill('80');

  // A rescore-editor repaint can swallow the bake click; retry until the confirm
  // dialog opens (same race as wordlist-selector's bake-button test).
  await expect(async () => {
    await bakeBtn(page).click();
    await expect(page.locator('#confirm-dialog')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await page.locator('#confirm-dialog #btn-confirm-ok').click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await expect(page.locator('#rescore-editor')).toBeVisible();  // unlike Apply, stays open
  await expect.poll(() => page.evaluate(async () =>
    (await window.__grawlixTest.dumpSourceEntries('Mine')).map(e => e.score))).toEqual([80]);
  await expect(bakeBtn(page)).toBeDisabled();  // rules reset → nothing left to bake
});
