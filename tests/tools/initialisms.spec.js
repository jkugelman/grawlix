const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addRich(page, name, entries, scores) {
  await page.evaluate(([n, es, ss]) => window.__grawlixTest.addCustomWordlist({
    name: n, entries: es, scores: ss,
  }), [name, entries, scores]);
}

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

async function groups(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleGroups());
}

test.describe('Initialisms tool', () => {
  async function addLib(page) {
    await addRich(page, 'Initialisms', [
      'what the fuck', 'world tour finals', 'cat',
      'co-op', "don't", 'big easy',
    ], [50, 50, 50, 50, 50, 50]);
  }

  async function setInitialism(page, q) {
    await page.evaluate(target => window.__grawlixTest.setStack([
      { tool: 'initialisms', params: { word: target } },
    ]), q);
  }

  test('matches displays whose word-initial letters spell the initialism', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setInitialism(page, 'WTF');
    expect((await visible(page)).sort()).toEqual(['what the fuck', 'world tour finals']);
  });

  test('hyphens are optional word boundaries', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setInitialism(page, 'CO');
    expect(await visible(page)).toEqual(['co-op']);
  });

  test('single-letter pattern matches every entry whose first word starts with it', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setInitialism(page, 'C');
    expect((await visible(page)).sort()).toEqual(['cat', 'co-op']);
  });

  test("apostrophes aren't word boundaries — DT doesn't match \"don't\"", async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setInitialism(page, 'DT');
    expect(await visible(page)).toEqual([]);
  });
});

test.describe('Initialisms grouped mode', () => {
  async function setGrouped(page) {
    await page.evaluate(() => window.__grawlixTest.setStack([
      { tool: 'initialisms', grouped: true },
    ]));
  }

  test('clusters multi-word entries by their initialism when the initialism is an entry', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lib', [
      'WTF', 'what the fuck', 'where the front', 'who the fudge',
    ], [60, 50, 50, 50]);
    await setGrouped(page);
    const gs = await groups(page);
    expect(gs).toHaveLength(1);
    expect(gs[0].anchor).toEqual({ entry: 'WTF', score: 60 });
    expect(gs[0].count).toBe(3);
    expect(gs[0].chains.flat().sort()).toEqual([
      'what the fuck', 'where the front', 'who the fudge',
    ]);
  });

  test('drops clusters whose initialism is not an entry in the wordlist', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lib', ['cool cat', 'cow case'], [50, 50]);
    await setGrouped(page);
    expect(await groups(page)).toEqual([]);
  });

  test('skips single-word entries (one-letter initialisms are just prefix buckets)', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lib', ['C', 'cat', 'cow'], [60, 50, 50]);
    await setGrouped(page);
    expect(await groups(page)).toEqual([]);
  });

  test('hyphens are not word boundaries in grouped mode', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lib', [
      'CO', 'Cycle Op', 'Camera Op', 'co-op',
    ], [60, 50, 50, 50]);
    await setGrouped(page);
    const gs = await groups(page);
    expect(gs).toHaveLength(1);
    expect(gs[0].anchor).toEqual({ entry: 'CO', score: 60 });
    expect(gs[0].chains.flat().sort()).toEqual(['Camera Op', 'Cycle Op']);
  });
});
