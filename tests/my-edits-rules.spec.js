// My Edits' rescore-rule legend + import reconciliation — see docs/design.md § Rescore rules.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const myEdits = page => page.evaluate(() => window.__grawlixTest.getWordlist('My Edits'));

// applyWordlistText is the real path ingestFile takes when My Edits is still empty.
const importIntoEdits = (page, text) =>
  page.evaluate(t => applyWordlistText(getEditsWordlist(), t, { source: 'mine.txt', silent: true }), text);

test('My Edits ships with the default tier legend — passthrough rules, not dirty', async ({ page }) => {
  await gotoApp(page);
  const wl = await myEdits(page);
  expect(wl.rescoreRules.map(r => r.input)).toEqual(['60', '50', '40', '30', '20', '10', '0']);
  expect(wl.rescoreRules.every(r => r.output === '')).toBe(true);  // documents tiers, remaps nothing
  expect(wl.dirty).toBe(false);
});

test('importing a foreign-scaled list into My Edits drops the legend and auto-seeds its scale', async ({ page }) => {
  await gotoApp(page);
  await importIntoEdits(page, 'CAT;5\nDOG;7\nFOX;9\n');
  const wl = await myEdits(page);
  expect(wl.rescoreRules.map(r => r.input).sort()).toEqual(['5', '7', '9']);
  expect(wl.rescoreRules.every(r => r.output === '')).toBe(true);
  expect(wl.dirty).toBe(true);
});

test('importing a list already on Grawlix tiers keeps the legend', async ({ page }) => {
  await gotoApp(page);
  await importIntoEdits(page, 'CAT;60\nDOG;50\nFOX;40\n');
  const wl = await myEdits(page);
  expect(wl.rescoreRules.map(r => r.input)).toEqual(['60', '50', '40', '30', '20', '10', '0']);
  expect(wl.dirty).toBe(false);
});

test("customizing an All tier propagates into a non-dirty My Edits legend", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const i = state.scoring.findIndex(r => r.input === '60');
    saveScoringField(i, 'input', '65');
  });
  const wl = await myEdits(page);
  expect(wl.rescoreRules.map(r => r.input)).toContain('65');
  expect(wl.rescoreRules.map(r => r.input)).not.toContain('60');
  expect(wl.dirty).toBe(false);
});

test('baking My Edits writes rescored scores into the raw data and resets the rules', async ({ page }) => {
  await gotoApp(page);
  await importIntoEdits(page, 'CAT;5\nDOG;7\n');
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('My Edits', [
    { input: '5', length: '', output: '50', note: '' },
    { input: '7', length: '', output: '60', note: '' },
  ]));

  await page.evaluate(() => { window.__grawlixTest.bakeRescoring('My Edits'); });
  await page.locator('#confirm-dialog #btn-confirm-ok').click();

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.map(e => e.score).sort((a, b) => a - b)),
  ).toEqual([50, 60]);

  const wl = await myEdits(page);
  expect(wl.rescoreRules.map(r => r.input)).toEqual(['60', '50', '40', '30', '20', '10', '0']);
  expect(wl.rescoreRules.every(r => r.output === '')).toBe(true);
  expect(wl.dirty).toBe(false);

  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('CAT'))).toMatchObject({ score: 50 });

  await page.reload();
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits')?.entries.map(e => e.score).sort((a, b) => a - b) ?? null),
    { timeout: 10000 },
  ).toEqual([50, 60]);
});
