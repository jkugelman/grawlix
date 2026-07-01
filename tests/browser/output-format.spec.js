import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function readDownload(download) {
  const stream = await download.createReadStream();
  let data = '';
  for await (const chunk of stream) data += chunk;
  return data;
}

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

  test('a source downloads immediately, applying the global output format with no dialog', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Src', entries: ['BLUE JAY'], scores: [50] }));
    await page.evaluate(() => window.__grawlixTest.setRescoreRules('Src', [{ input: '50', length: '', output: '80' }]));

    const richDl = page.waitForEvent('download');
    await page.evaluate(() => downloadSourceWordlist(state.sources.find(w => w.name === 'Src')));
    const rich = await richDl;
    expect(rich.suggestedFilename()).toBe('Src rescored.txt');
    expect(await readDownload(rich)).toContain('BLUE JAY;80');

    await page.evaluate(() => setOutputFormat({ spaces: false, punctuation: false, accents: false, comments: true }));
    const strippedDl = page.waitForEvent('download');
    await page.evaluate(() => downloadSourceWordlist(state.sources.find(w => w.name === 'Src')));
    expect(await readDownload(await strippedDl)).toContain('BLUEJAY;80');
  });

  test('My Edits Download applies the output format like any source; Download original is the editable file verbatim', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => saveEdit({ norm: '', display: '', score: 0, comment: '' }, { raw: 'BLUE JAY', score: 50, comment: '' }));
    await page.evaluate(() => setOutputFormat({ spaces: false, punctuation: false, accents: false, comments: true }));
    await page.evaluate(async () => { await persistEdits(state.sources.find(w => w.type === 'edits')); });

    const dl = page.waitForEvent('download');
    await page.evaluate(() => downloadSourceWordlist(state.sources.find(w => w.type === 'edits')));
    const file = await dl;
    expect(file.suggestedFilename()).toBe('My Edits rescored.txt');
    expect(await readDownload(file)).toContain('BLUEJAY;50');

    const origDl = page.waitForEvent('download');
    await page.evaluate(() => downloadOriginalWordlist(state.sources.find(w => w.type === 'edits')));
    const orig = await origDl;
    expect(orig.suggestedFilename()).toBe('My Edits.txt');
    expect(await readDownload(orig)).toContain('BLUE JAY;50');
  });

  test('a source with rules gets a split Download with Download-rescored and Download-original doors; one without is a plain button', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Ruled', entries: ['cat'], scores: [50] }));
    await page.evaluate(() => window.__grawlixTest.setRescoreRules('Ruled', [{ input: '50', length: '', output: '80' }]));
    await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Plain', entries: ['dog'], scores: [50] }));
    await page.evaluate(() => window.__grawlixTest.setRescoreRules('Plain', []));  // custom lists auto-seed rules; clear them

    const downloadBtn = page.locator('#wordlist-bar #download-btn');
    const menuItems = downloadBtn.locator('.split-btn-menu button');

    await scopeTo(page, 'Ruled');
    await expect(menuItems.filter({ hasText: 'Download rescored' })).toHaveCount(1);
    await expect(menuItems.filter({ hasText: 'Download original' })).toHaveCount(1);

    await scopeTo(page, 'Plain');
    await expect(menuItems).toHaveCount(0);

    await scopeTo(page, 'All Wordlists');
    await expect(menuItems).toHaveCount(0);
  });

  test('Download original saves the imported file verbatim, not the rule output', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Src', entries: ['ALPHA', 'BETA'], scores: [50, 50] }));
    await page.evaluate(() => window.__grawlixTest.setRescoreRules('Src', [{ input: '50', length: '', output: '80' }]));

    const originalDl = page.waitForEvent('download');
    await page.evaluate(() => downloadOriginalWordlist(state.sources.find(w => w.name === 'Src')));
    const original = await originalDl;
    expect(original.suggestedFilename()).toBe('Src.txt');
    const text = await readDownload(original);
    expect(text).toContain('ALPHA;50');
    expect(text).not.toContain('80');
  });
});

test.describe('stats-bar Share and Export menus', () => {
  test('Share holds only Copy; Export holds the three file downloads', async ({ page }) => {
    await gotoApp(page);
    const controls = page.locator('#stats .stats-bar-controls');
    await expect(controls.locator('.more-menu-labeled')).toHaveCount(2);

    const share  = controls.locator('.split-btn', { has: page.locator('.more-menu-labeled', { hasText: 'Share' }) });
    const exportM = controls.locator('.split-btn', { has: page.locator('.more-menu-labeled', { hasText: 'Export' }) });

    await expect(share.locator('.split-btn-menu button')).toHaveText(['Copy to clipboard']);
    await expect(exportM.locator('.split-btn-menu button')).toHaveText([
      'Results as wordlist', 'Results as CSV', 'Results as JSON',
    ]);
  });
});
