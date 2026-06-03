const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

function ser(page, entries, fmt) {
  return page.evaluate(([es, f]) => serializeEntries(es, f), [entries, fmt]);
}

const RICH    = { spaces: true,  punctuation: true,  accents: true,  comments: true };
const STRIPPED = { spaces: false, punctuation: false, accents: false, comments: true };

test.describe('output format serialization', () => {
  test('as-is preserves display, spaces, accents, case, and comments verbatim', async ({ page }) => {
    await gotoApp(page);
    const out = await ser(page, [
      { norm: 'theirs', display: 'the IRS', score: 60, comment: 'tax' },
      { norm: 'cafe',   display: 'café',    score: 50, comment: '' },
      { norm: 'cat',    display: null,      score: 40, comment: '' },
    ], RICH);
    expect(out).toBe('the IRS;60;tax\ncafé;50\ncat;40\n');
  });

  test('as-is writes same-norm distinct displays verbatim — no collapse', async ({ page }) => {
    await gotoApp(page);
    const out = await ser(page, [
      { norm: 'cafe', display: 'café', score: 60, comment: '' },
      { norm: 'cafe', display: 'cafe', score: 50, comment: '' },
    ], RICH);
    expect(out).toBe('café;60\ncafe;50\n');
  });

  test('strip everything removes spaces, punctuation, and accents (case untouched)', async ({ page }) => {
    await gotoApp(page);
    const out = await ser(page, [
      { norm: 'theirs', display: 'the IRS', score: 60, comment: '' },
      { norm: 'cafe',   display: 'café',    score: 50, comment: '' },
      { norm: 'coop',   display: 'co-op',   score: 45, comment: '' },
    ], STRIPPED);
    expect(out).toBe('theIRS;60\ncafe;50\ncoop;45\n');
  });

  test('stripping a single axis leaves the others intact', async ({ page }) => {
    await gotoApp(page);
    const out = await ser(page, [
      { norm: 'cafeaulait', display: 'café au lait', score: 50, comment: '' },
      { norm: 'coop',        display: 'co-op',        score: 45, comment: '' },
    ], { spaces: true, punctuation: true, accents: false, comments: true });
    expect(out).toBe('cafe au lait;50\nco-op;45\n');
  });

  test('collapse keeps the highest score and combines distinct comments', async ({ page }) => {
    await gotoApp(page);
    const out = await ser(page, [
      { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
      { norm: 'cafe', display: 'cafe', score: 50, comment: 'the band' },
    ], { spaces: true, punctuation: true, accents: false, comments: true });
    expect(out).toBe('cafe;60;drink / the band\n');
  });

  test('combined comments dedup and order by score descending', async ({ page }) => {
    await gotoApp(page);
    const out = await ser(page, [
      { norm: 'cafe', display: 'cafe', score: 40, comment: 'low' },
      { norm: 'cafe', display: 'café', score: 70, comment: 'high' },
      { norm: 'cafe', display: 'cafè', score: 55, comment: 'high' },
    ], { spaces: true, punctuation: true, accents: false, comments: true });
    expect(out).toBe('cafe;70;high / low\n');
  });

  test('comments off drops the third field even when stripping', async ({ page }) => {
    await gotoApp(page);
    const out = await ser(page, [
      { norm: 'cafe', display: 'café', score: 60, comment: 'drink' },
    ], { spaces: true, punctuation: true, accents: false, comments: false });
    expect(out).toBe('cafe;60\n');
  });

  test('empty list yields an empty string', async ({ page }) => {
    await gotoApp(page);
    expect(await ser(page, [], RICH)).toBe('');
    expect(await ser(page, [], STRIPPED)).toBe('');
  });
});

test.describe('output format setting', () => {
  test('getOutputFormat defaults to fully rich and round-trips through mergedSettings', async ({ page }) => {
    await gotoApp(page);
    expect(await page.evaluate(() => getOutputFormat())).toMatchObject(
      { spaces: true, punctuation: true, accents: true, comments: true });

    const got = await page.evaluate(() => {
      const stripped = { spaces: false, punctuation: false, accents: false, comments: false };
      Storage.writeMergedSettings({ ...Storage.readMergedSettings(), outputFormat: stripped });
      return getOutputFormat();
    });
    expect(got).toMatchObject({ spaces: false, punctuation: false, accents: false, comments: false });
  });
});

test.describe('output format UI', () => {
  test('Settings exposes the four flag checkboxes and no case toggle', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => SettingsDialog.open());
    await expect(page.locator('#output-format-ctrls .of-flag')).toHaveCount(4);
    await expect(page.locator('#output-format-ctrls .seg-btn')).toHaveCount(0);
  });

  test('changing a flag in Settings persists immediately, before closing', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => SettingsDialog.open());
    await page.locator('#output-format-ctrls input[data-flag="accents"]').uncheck();
    expect(await page.evaluate(() => getOutputFormat().accents)).toBe(false);
  });

  test('download dialog hides the format section for My Edits but shows it for sources', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Src', entries: ['cat'], scores: [50] }));

    await page.evaluate(() => { showDownloadDialog('Src', state.sources.find(w => w.name === 'Src')); });
    await expect(page.locator('#download-format-section')).toBeVisible();
    await page.locator('#download-dialog .dialog-cancel-btn').click();

    await page.evaluate(() => { showDownloadDialog('My Edits', getEditsWordlist()); });
    await expect(page.locator('#download-format-section')).toBeHidden();
    await page.locator('#download-dialog .dialog-cancel-btn').click();
  });
});
