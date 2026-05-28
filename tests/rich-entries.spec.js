const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addPlain(page, entries) {
  await page.evaluate(es => window.__grawlixTest.addCustomWordlist({
    name: 'Plain', entries: es, scores: Array(es.length).fill(50),
  }), entries);
}

async function addRich(page, name, entries, scores) {
  await page.evaluate(([n, es, ss]) => window.__grawlixTest.addCustomWordlist({
    name: n, entries: es, scores: ss,
  }), [name, entries, scores]);
}

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

async function setSearch(page, query) {
  await page.evaluate(q =>
    window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: q } }]), query);
}

test.describe('parser richness autodetect', () => {
  test('a uniformly-uppercase wordlist is classified as plain (display=null)', async ({ page }) => {
    await gotoApp(page);
    await addPlain(page, ['BAGEL', 'CAR', 'DOG']);
    const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Plain'));
    expect(wl.entries.every(e => e.display === null)).toBe(true);
  });

  test('a single rich entry (a space) flips the file to rich', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Rich', ['BAGEL', 'NEW YEAR', 'CAR', 'DOG'], [50, 50, 50, 50]);
    const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Rich'));
    expect(wl.entries.map(e => e.display)).toEqual(['BAGEL', 'NEW YEAR', 'CAR', 'DOG']);
  });

  test('a mixed-case file is rich even without spaces or accents', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Mixed', ['BAGEL', 'Helen', 'CAR'], [50, 50, 50]);
    const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Mixed'));
    expect(wl.entries.map(e => e.display)).toEqual(['BAGEL', 'Helen', 'CAR']);
  });
});

test.describe('norm + display', () => {
  test('rich variants of the same norm produce distinct merged rows', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Variants', ['theirs', 'the IRS'], [50, 60]);
    const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
    expect(visible.sort()).toEqual(['the IRS', 'theirs']);
  });

  test('length column counts norm letters, not display chars', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lengths', ['the IRS'], [50]);
    const lens = await page.evaluate(() =>
      [...document.querySelectorAll('#vs-host .atom-len')].map(el => el.textContent));
    expect(lens).toEqual(['6']);
  });
});

test.describe('display-aware search', () => {
  async function addLib(page) {
    await addRich(page, 'Search', [
      'theirs', 'the IRS', 'coop', 'co-op', 'résumé', 'resume',
    ], [50, 50, 50, 50, 50, 50]);
  }

  test('a glue-free pattern matches across a space in the display', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'theirs');
    expect((await visible(page)).sort()).toEqual(['the IRS', 'theirs']);
  });

  test('a pattern with a literal space requires that space in the display', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'the IRS');
    expect(await visible(page)).toEqual(['the IRS']);
  });

  test('a pattern with a literal hyphen requires that hyphen in the display', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'co-op');
    expect(await visible(page)).toEqual(['co-op']);
  });

  test('a bare letter pattern matches both accented and unaccented displays', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'resume');
    expect((await visible(page)).sort()).toEqual(['resume', 'résumé']);
  });

  test('an accent in the pattern requires that accent in the display', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'résumé');
    expect(await visible(page)).toEqual(['résumé']);
  });
});

test.describe('UI-typed entries preserve case', () => {
  test('Add-it from the search empty state lands a verbatim display', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.search-bar input[data-key="pattern"]').fill('Helen of Troy');
    await page.locator('.entries-empty-add').click();
    await expect(page.locator('#atom-pop-entry')).toHaveValue('Helen of Troy');
    await page.locator('#atom-pop-score').fill('70');
    await page.locator('#atom-pop-score').press('Enter');
    await expect.poll(async () =>
      page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
    ).toEqual([{ entry: 'helenoftroy', display: 'Helen of Troy', score: 70, comment: '' }]);
  });

  test('Search-replace preserves the replacement string case', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Replace', ['Bob of Troy', 'Helen of Troy'], [50, 50]);
    await page.evaluate(() => window.__grawlixTest.setStack([
      { tool: 'search', params: { pattern: 'Helen', replace: 'Bob' } },
    ]));
    const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
    expect(visible).toEqual([['Helen of Troy', 'Bob of Troy']]);
  });
});
