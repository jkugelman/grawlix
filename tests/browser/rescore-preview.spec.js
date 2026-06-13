// The live rule-arrow preview: while the rescore editor is open and
// scoped to a source, rows a rule remapped show `raw → rescored` in the score
// cell; unaffected rows show a single badge. Closing the editor — or scoping to
// All Wordlists, where the editor edits tier labels, not scores — drops every arrow.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeViaSelector, openRescoreEditor, applyRescoreEditor } = require('./helpers');

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

test('editing a rule output previews live and only commits on Apply', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);
  await openRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('80');

  await ruleOutput(page).fill('90');
  await ruleOutput(page).blur();

  await expect(oceanScore(page).locator('.score-badge')).toHaveText('90');
  await expect(oceanScore(page).locator('.atom-score-raw')).toHaveText('350');
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules[0].output)).toBe('80');

  await applyRescoreEditor(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules[0].output)).toBe('90');
  await expect(oceanScore(page).locator('.score-badge')).toHaveText('90');
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
  .locator('.atom-pop-prov tbody tr', { has: page.locator('.atom-pop-prov-entry', { hasText: new RegExp(`^${entry}$`) }) })
  .locator('.atom-pop-prov-score');

test('the popover provenance shows raw → rescored without opening the editor', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);

  await oceanScore(page).click();
  await expect(page.locator('#atom-popover')).toBeVisible();

  await expect(provScore(page, 'ocean').locator('.atom-score-raw')).toHaveText('350');
  await expect(provScore(page, 'ocean').locator('.atom-score-arrow')).toHaveCount(1);
  await expect(provScore(page, 'ocean').locator('.score-badge')).toHaveText('80');
});

test('an unrescored source shows a single score in the popover provenance', async ({ page }) => {
  await gotoApp(page);
  await seedRemappedSource(page);

  await tideScore(page).click();
  await expect(page.locator('#atom-popover')).toBeVisible();

  await expect(provScore(page, 'tide').locator('.score-badge')).toHaveText('40');
  await expect(provScore(page, 'tide').locator('.atom-score-arrow')).toHaveCount(0);
  await expect(provScore(page, 'tide').locator('.atom-score-raw')).toHaveCount(0);
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
  const confirmDialog = page.locator('#confirm-dialog');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.locator('#btn-confirm-ok').click();

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
