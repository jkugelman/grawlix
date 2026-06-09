// Wordlist selector (Stage 2a of the unify redesign). Drives the real
// dropdown UI — not the setScope test API — to prove the control lists All Wordlists plus
// each source as rows, that clicking one scopes the table, and that a disabled
// source renders dimmed yet stays selectable (scope ≠ merge).

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo, scopeViaSelector, expectVisible, openRescoreEditor, setEnabledViaPanel } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function kebabItems(page) {
  const kebab = page.locator('#wordlist-bar .wls-actions .wls-kebab');
  await kebab.locator('.more-menu-btn').click();
  await expect(kebab).toHaveClass(/open/);
  return kebab.locator('.split-btn-menu button').allTextContents();
}

async function openMenu(page) {
  await page.locator('#wordlist-bar .wls-trigger').click();
  await expect(page.locator('#wordlist-bar .wls')).toHaveClass(/open/);
}

function optionLabels(page) {
  return page.locator('#wordlist-bar .wls-menu .wordlist-card .card-name').allTextContents();
}

test('the dropdown lists All Wordlists plus each added source as icon+name+count rows', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ocean'], scores: [70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta', entries: ['tide'], scores: [40],
  }));

  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');

  await openMenu(page);
  // My Edits and the four unpopulated publishers also appear, so assert the
  // meaningful subset rather than an exact list: All Wordlists first, then sources in order.
  const labels = await optionLabels(page);
  expect(labels[0]).toBe('All Wordlists');
  expect(labels).toContain('Alpha');
  expect(labels).toContain('Beta');
  expect(labels.indexOf('Alpha')).toBeLessThan(labels.indexOf('Beta'));

  const cards = page.locator('#wordlist-bar .wls-menu .wordlist-card');
  const optionCount = await cards.count();
  expect(await cards.locator('.wordlist-icon').count()).toBe(optionCount);
  expect(await cards.locator('.card-meta').count()).toBe(optionCount);
  expect(await cards.locator('input[type="checkbox"]').count()).toBe(0);
  expect(await cards.locator('.drag-handle').count()).toBe(0);
  // Only the 3 populated rows (All Wordlists, Alpha, Beta) say "entries"; unpopulated
  // publishers and empty My Edits read "No data", not "0 entries".
  expect(await page.locator('#wordlist-bar .wls-menu .card-meta', { hasText: 'entr' }).count()).toBe(3);
  for (const meta of await cards.locator('.card-meta').allTextContents()) {
    expect(meta.trim()).not.toBe('');
  }
});

test('a menu row shows contribution-aware meta when its entries partly lose to a higher-priority list', async ({ page }) => {
  await gotoApp(page);
  // Hi (added first) outranks Lo. Both carry OCEAN; Hi wins it, so Lo
  // contributes only TIDE — 1 of its 2 entries used.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean', 'zebra'], scores: [90, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  await openMenu(page);
  const cardMeta = name => page.locator('#wordlist-bar .wls-menu .wordlist-card')
    .filter({ has: page.locator('.card-name', { hasText: name }) })
    .locator('.card-meta');

  await expect(cardMeta('Hi')).toHaveText('2 entries used');
  await expect(cardMeta('Lo')).toHaveText('1 of 2 entries used');
});

test('an update-available source shows the info dot on its menu row and the collapsed trigger', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mine', entries: ['ocean'], scores: [70],
  }));
  await page.evaluate(() => window.__grawlixTest.setUpdateAvailable('Mine', true));

  await expect(page.locator('#wordlist-bar .wls-trigger .badge[data-severity="info"]')).toBeVisible();

  await openMenu(page);
  const mineRow = page.locator('#wordlist-bar .wls-menu .wordlist-card')
    .filter({ has: page.locator('.card-name', { hasText: 'Mine' }) });
  await expect(mineRow.locator('.badge[data-severity="info"]')).toBeVisible();
  expect(await page.locator('#wordlist-bar .wls-menu .badge[data-severity="info"]').count()).toBe(1);
});

test('clicking a source scopes the table to it; clicking All Wordlists restores the merge', async ({ page }) => {
  await gotoApp(page);
  // Two sources sharing OCEAN; Hi (added first) wins the All Wordlists merge and carries
  // ZEBRA, which Lo lacks.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean', 'zebra'], scores: [90, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  await expectVisible(page, ['ocean', 'tide', 'zebra']);

  await scopeViaSelector(page, 'Lo');
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('Lo');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 70, wordlist: 'Lo' });

  await scopeViaSelector(page, 'All Wordlists');
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
  await expectVisible(page, ['ocean', 'tide', 'zebra']);
});

test('a disabled source renders dimmed but is still selectable', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Off', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  await setEnabledViaPanel(page, 'Off', false);

  await openMenu(page);
  const offOption = page.locator('#wordlist-bar .wls-menu .wordlist-card')
    .filter({ has: page.locator('.card-name', { hasText: 'Off' }) });
  // Dimming is asserted via the shared .disabled class, never a computed color
  // (project rule: no toHaveCSS assertions).
  await expect(offOption).toHaveClass(/\bdisabled\b/);

  // Disabled does not mean unclickable — scope to it and the table shows it.
  await offOption.click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('Off');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 70, wordlist: 'Off' });
});

test('a URL-backed source kebab offers Fetch, Import, Configure, Delete — never bake', async ({ page }) => {
  await gotoApp(page);
  await scopeTo(page, 'John Kugelman');

  const items = await kebabItems(page);
  expect(items).toEqual(['Fetch', 'Import', 'Configure', 'Delete']);
  expect(items).not.toContain('Apply rescoring permanently');
});

test('an imported (file-based) source kebab offers Import, Configure, Delete — no Fetch, no bake', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mine', entries: ['ocean'], scores: [70],
  }));
  await scopeTo(page, 'Mine');

  const items = await kebabItems(page);
  expect(items).toEqual(['Import', 'Configure', 'Delete']);
});

test('the My Edits kebab offers only Import and Clear — no Fetch, no Delete, no bake', async ({ page }) => {
  await gotoApp(page);
  await scopeTo(page, 'My Edits');

  const items = await kebabItems(page);
  expect(items).toEqual(['Import', 'Clear']);
  expect(items).not.toContain('Delete');
  expect(items).not.toContain('Apply rescoring permanently');
});

test('All Wordlists shows no kebab — only its Download', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mine', entries: ['ocean'], scores: [70],
  }));
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
  await expect(page.locator('#wordlist-bar .wls-actions .wls-kebab')).toHaveCount(0);

  await scopeTo(page, 'Mine');
  await expect(page.locator('#wordlist-bar .wls-actions .wls-kebab')).toHaveCount(1);
});

test('the rescore panel bake button is enabled for a bakeable source and applies the rescoring', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mine', entries: ['cat', 'dog'], scores: [5, 7],
  }));
  await scopeTo(page, 'Mine');
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Mine', [
    { input: '5', length: '', output: '50', note: '' },
    { input: '7', length: '', output: '60', note: '' },
  ]));

  await openRescoreEditor(page);
  const bakeBtn = page.locator('#rescore-editor .rule-bake-btn');
  await expect(bakeBtn).toBeEnabled();

  await bakeBtn.click();
  await page.locator('#confirm-dialog #btn-confirm-ok').click();

  await expect.poll(() =>
    page.evaluate(() => window.__grawlixTest.getWordlist('Mine').entries.map(e => e.score).sort((a, b) => a - b))
  ).toEqual([50, 60]);
});

test('the rescore panel bake button is disabled for a publisher source', async ({ page }) => {
  await gotoApp(page);
  await scopeTo(page, 'John Kugelman');
  await openRescoreEditor(page);
  await expect(page.locator('#rescore-editor .rule-bake-btn')).toBeDisabled();
});

test('All Wordlists has no bake button — its panel is the scoring/tier editor', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mine', entries: ['ocean'], scores: [70],
  }));
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
  await openRescoreEditor(page);
  await expect(page.locator('#rescore-editor .rule-bake-btn')).toHaveCount(0);
});
