const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addRich(page, name, entries, scores) {
  await page.evaluate(([n, es, ss]) => window.__grawlixTest.addCustomWordlist({
    name: n, entries: es, scores: ss,
  }), [name, entries, scores]);
}

async function setSearch(page, query) {
  await page.evaluate(q =>
    window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: q } }]), query);
}

test.describe('parser casing autodetect', () => {
  test('a large all-uppercase wordlist renders lowercase (display = null)', async ({ page }) => {
    await gotoApp(page);
    const entries = Array.from({ length: 1500 }, (_, i) => `WORD${i}`);
    await addRich(page, 'Upper', entries, Array(entries.length).fill(50));
    const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Upper'));
    expect(wl.entries.every(e => e.display === null)).toBe(true);
  });

  test('a small all-uppercase wordlist is kept verbatim — too little to be a convention', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Tiny', ['BAGEL', 'CAR', 'DOG'], [50, 50, 50]);
    const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Tiny'));
    expect(wl.entries.map(e => e.display)).toEqual(['BAGEL', 'CAR', 'DOG']);
  });

  test('in a lowercase file, bare lowercase collapses; spaces, accents, and caps stay verbatim', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Mix', ['cat', 'NEW YEAR', 'Mötley Crüe', 'FBI', 'café'], [50, 50, 50, 50, 50]);
    const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Mix'));
    expect(wl.entries.map(e => e.display)).toEqual([null, 'NEW YEAR', 'Mötley Crüe', 'FBI', 'café']);
  });
});

test.describe('norm + display', () => {
  test('distinct rich variants of one norm produce distinct merged rows', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Variants', ['Theirs', 'the IRS'], [50, 60]);
    await expectVisible(page, ['Theirs', 'the IRS']);
  });

  test('a bare lowercase entry collapses into a richer same-norm variant', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Collapse', ['helenoftroy', 'Helen of Troy'], [50, 60]);
    await expectVisible(page, ['Helen of Troy']);
  });

  test('length column counts norm letters, not display chars', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lengths', ['the IRS'], [50]);
    await expect.poll(async () => page.evaluate(() =>
      [...document.querySelectorAll('#vs-host .atom-len')].map(el => el.textContent))
    ).toEqual(['6']);
  });
});

test.describe('display-aware search', () => {
  async function addLib(page) {
    await addRich(page, 'Search', [
      'theirs', 'the IRS', 'coop', 'co-op', 'résumé', 'Resume',
    ], [50, 50, 50, 50, 50, 50]);
  }

  test('a glue-free pattern matches across a space in the display', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'theirs');
    await expectVisible(page, ['the IRS']);
  });

  test('a pattern with a literal space requires that space in the display', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'the IRS');
    await expectVisible(page, ['the IRS']);
  });

  test('a pattern with a literal hyphen requires that hyphen in the display', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'co-op');
    await expectVisible(page, ['co-op']);
  });

  test('a bare letter pattern matches both accented and unaccented displays', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'resume');
    await expectVisible(page, ['Resume', 'résumé']);
  });

  test('an accent in the pattern requires that accent in the display', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setSearch(page, 'résumé');
    await expectVisible(page, ['résumé']);
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
    await expectVisible(page, [['Helen of Troy', 'Bob of Troy']]);
  });
});
