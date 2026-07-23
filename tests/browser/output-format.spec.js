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

test.describe('results exports follow the output format', () => {
  async function addRichFixture(page) {
    await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
      name: 'Rich',
      entries:  ['BLUE JAY', 'café', 'co-op'],
      scores:   [50,         60,     40],
      comments: ['bird',     'drink', ''],
    }));
  }

  const STRIP = { spaces: false, punctuation: false, accents: false, comments: true };

  test('Results as wordlist strips spaces, punctuation, and accents', async ({ page }) => {
    await gotoApp(page);
    await addRichFixture(page);
    await page.evaluate(f => setOutputFormat(f), STRIP);

    const { text } = await page.evaluate(() => window.__grawlixTest.exportText('wordlist'));
    expect(text).toContain('BLUEJAY;50;bird');
    expect(text).toContain('cafe;60;drink');
    expect(text).toContain('coop;40');
    expect(text).not.toContain('BLUE JAY');
    expect(text).not.toContain('café');
  });

  test('Results as wordlist drops comments when the comments flag is off', async ({ page }) => {
    await gotoApp(page);
    await addRichFixture(page);
    await page.evaluate(() => setOutputFormat({ spaces: true, punctuation: true, accents: true, comments: false }));

    const { text } = await page.evaluate(() => window.__grawlixTest.exportText('wordlist'));
    expect(text).toContain('BLUE JAY;50\n');
    expect(text).not.toContain('bird');
  });

  test('Results as CSV formats the entry cell but keeps its comment and source columns', async ({ page }) => {
    await gotoApp(page);
    await addRichFixture(page);
    await page.evaluate(f => setOutputFormat(f), STRIP);

    const text = await page.evaluate(() => window.__grawlixTest.exportText('csv'));
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('entry,length,score,comment,source');
    expect(lines).toContain('BLUEJAY,7,50,bird,Rich');
    expect(lines).toContain('cafe,4,60,drink,Rich');
    expect(text).not.toContain('BLUE JAY');
  });

  test('Results as JSON is a programmatic format — the output format never touches it', async ({ page }) => {
    await gotoApp(page);
    await addRichFixture(page);
    await page.evaluate(f => setOutputFormat(f), STRIP);

    const obj = await page.evaluate(() => window.__grawlixTest.exportText('json'));
    const entries = obj.groups.flatMap(g => g.chains.flatMap(c => c.entries)).map(e => e.entry);
    expect(entries).toContain('BLUE JAY');
    expect(entries).toContain('café');
  });
});

test.describe('stats-bar Share control and download menu', () => {
  test('Share is the only stats-bar control', async ({ page }) => {
    await gotoApp(page);
    const controls = page.locator('#stats .stats-bar-controls');
    await expect(controls.locator('.more-menu-labeled')).toHaveCount(1);
    await expect(controls.locator('.more-menu-labeled', { hasText: 'Share' })).toHaveCount(1);
    await expect(controls).not.toContainText('Export');
  });

  test('the Results row splits Copy from the three file downloads', async ({ page }) => {
    await gotoApp(page);
    await page.locator('#stats .stats-bar-controls .more-menu-labeled', { hasText: 'Share' }).click();
    const pop = page.locator('.copy-popover.open');
    await expect(pop).toBeVisible();

    const split = pop.locator('.copy-row-split');
    await expect(split.locator('.split-btn-main')).toHaveText('Copy');
    await split.locator('.split-btn-arrow').click();
    await expect(split.locator('.split-btn-menu button')).toHaveText([
      'Download as wordlist', 'Download as CSV', 'Download as JSON',
    ]);
  });

  test('Share opens a copy popover with markdown link, plain link, and results', async ({ page }) => {
    await gotoApp(page);
    await page.locator('#stats .stats-bar-controls .more-menu-labeled', { hasText: 'Share' }).click();

    const pop = page.locator('.copy-popover.open');
    await expect(pop).toBeVisible();

    await expect(pop.locator('[data-field="mdlink"]')).toHaveValue(/^\[All Wordlists\]\(http/);
    await expect(pop.locator('[data-field="link"]')).toHaveValue(page.url());
    await expect(pop.locator('[data-label="results"]')).toHaveText('Results');
  });

  test('Copy buttons write their own field to the clipboard', async ({ page }) => {
    await gotoApp(page);
    // Stub writeText: reading the real clipboard needs a permission webkit won't grant, so it flakes in the full matrix.
    await page.evaluate(() => {
      window.__copied = [];
      navigator.clipboard.writeText = t => { window.__copied.push(t); return Promise.resolve(); };
    });
    await page.locator('#stats .stats-bar-controls .more-menu-labeled', { hasText: 'Share' }).click();
    const pop = page.locator('.copy-popover.open');
    await expect(pop).toBeVisible();

    await pop.locator('.copy-row-btn[data-copy="link"]').click();
    await pop.locator('.copy-row-btn[data-copy="mdlink"]').click();
    await pop.locator('.copy-row-btn[data-copy="results"]').click();
    // The results copy awaits the async fill, so wait for all three writes to land.
    await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(3);

    const copied = await page.evaluate(() => window.__copied);
    expect(copied[0]).toBe(page.url());
    expect(copied[1]).toMatch(/^\[All Wordlists\]\(http/);
    expect(copied[2]).not.toMatch(/^\[/);   // results body carries no link header
  });
});
