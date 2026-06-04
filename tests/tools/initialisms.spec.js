const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible, expectGroups } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addRich(page, name, entries, scores) {
  await page.evaluate(([n, es, ss]) => window.__grawlixTest.addCustomWordlist({
    name: n, entries: es, scores: ss,
  }), [name, entries, scores]);
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
    await expectVisible(page, ['what the fuck', 'world tour finals']);
  });

  test('hyphens are optional word boundaries', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setInitialism(page, 'CO');
    await expectVisible(page, ['co-op']);
  });

  test('single-letter pattern matches every entry whose first word starts with it', async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setInitialism(page, 'C');
    await expectVisible(page, ['cat', 'co-op']);
  });

  test("apostrophes aren't word boundaries — DT doesn't match \"don't\"", async ({ page }) => {
    await gotoApp(page);
    await addLib(page);
    await setInitialism(page, 'DT');
    await expectVisible(page, []);
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
    await expectGroups(page, gs => gs.map(g => ({
      anchor: g.anchor,
      count: g.count,
      chains: g.chains.flat().sort(),
    })), [{
      anchor: { entry: 'WTF', score: 60 },
      count: 3,
      chains: ['what the fuck', 'where the front', 'who the fudge'],
    }]);
  });

  test('drops clusters whose initialism is not an entry in the wordlist', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lib', ['cool cat', 'cow case'], [50, 50]);
    await setGrouped(page);
    await expectGroups(page, gs => gs, []);
  });

  test('skips single-word entries (one-letter initialisms are just prefix buckets)', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lib', ['C', 'cat', 'cow'], [60, 50, 50]);
    await setGrouped(page);
    await expectGroups(page, gs => gs, []);
  });

  test('hyphens are not word boundaries in grouped mode', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lib', [
      'CO', 'Cycle Op', 'Camera Op', 'co-op',
    ], [60, 50, 50, 50]);
    await setGrouped(page);
    await expectGroups(page, gs => gs.map(g => ({
      anchor: g.anchor,
      chains: g.chains.flat().sort(),
    })), [{
      anchor: { entry: 'CO', score: 60 },
      chains: ['Camera Op', 'Cycle Op'],
    }]);
  });
});
