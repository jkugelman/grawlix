// Storage migrations — see docs/migration.md, data/migrations.js, data/storage.js.
//
// Each migrated SCHEMA_VERSION ships a frozen before→after fixture, captured
// verbatim and never edited again: the day a shared helper churns and a step
// silently starts producing wrong output, only a frozen fixture catches it.
// Editing a fixture to make a test pass defeats the test.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const V9_BEFORE = {
  sources: [
    {
      type: 'edits', dbKey: 'k-edits', name: 'My Edits',
      icon: { type: 'emoji', value: '✏️' },
      url: null, enabled: true, populated: true, lastUpdated: null,
      rescoreRules: [
        { input: '0',  length: '', output: 'ignore', note: 'junk' },
        { input: '50', length: '', output: '',       note: 'Fine' },
      ],
    },
    {
      dbKey: 'k-broda', publisherId: 'broda', name: 'Peter Broda', icon: null,
      url: 'https://grawlix.wtf/peter-broda-wordlist.txt',
      enabled: true, populated: true, lastUpdated: 1700000000000, dirty: false,
      rescoreRules: [
        { input: '76-100', length: '7+', output: '60', scoring: false },
        { input: '0-100',  length: '',   output: 'ignore' },
      ],
    },
    {
      dbKey: 'k-custom', publisherId: null, name: 'Mine', icon: null,
      url: null, enabled: true, populated: true, lastUpdated: 1700000000000,
      rescoreRules: [
        { input: '5', length: '', output: 'IGNORE',   note: 'cased' },
        { input: '6', length: '', output: ' ignore ', note: 'padded' },
        { input: '7', length: '', output: '30',       note: 'kept' },
      ],
    },
  ],
  scoring: [
    { input: '60', note: 'Great' },
    { input: '50', note: 'Fine' },
  ],
  scoringDirty: false,
  mergedSettings: { outputFormat: { spaces: true, punctuation: true, accents: true, comments: true } },
};

const V10_AFTER = {
  sources: [
    {
      type: 'edits', dbKey: 'k-edits', name: 'My Edits',
      icon: { type: 'emoji', value: '✏️' },
      url: null, enabled: true, populated: true, lastUpdated: null,
      rescoreRules: [
        { input: '0',  length: '', output: '0', note: 'junk' },
        { input: '50', length: '', output: '',  note: 'Fine' },
      ],
    },
    {
      dbKey: 'k-broda', publisherId: 'broda', name: 'Peter Broda', icon: null,
      url: 'https://grawlix.wtf/peter-broda-wordlist.txt',
      enabled: true, populated: true, lastUpdated: 1700000000000, dirty: false,
      rescoreRules: [
        { input: '76-100', length: '7+', output: '60', scoring: false },
        { input: '0-100',  length: '',   output: '0' },
      ],
    },
    {
      dbKey: 'k-custom', publisherId: null, name: 'Mine', icon: null,
      url: null, enabled: true, populated: true, lastUpdated: 1700000000000,
      rescoreRules: [
        { input: '5', length: '', output: '0',  note: 'cased' },
        { input: '6', length: '', output: '0',  note: 'padded' },
        { input: '7', length: '', output: '30', note: 'kept' },
      ],
    },
  ],
  scoring: [
    { input: '60', note: 'Great' },
    { input: '50', note: 'Fine' },
  ],
  scoringDirty: false,
  mergedSettings: { outputFormat: { spaces: true, punctuation: true, diacritics: true, unicode: true, comments: true } },
};

test('migration v9→v10 rewrites every "ignore" rescore output to "0"', async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(
    (before) => window.__grawlixTest.migrateLs(structuredClone(before), 9),
    V9_BEFORE,
  );
  expect(result).toEqual(V10_AFTER);
});

test('a relocated wordlist URL is remapped in stored data on boot', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Relo', entries: ['KEEP'], scores: [50],
  }));

  // Schema version left current: the remap must run on every boot, not only
  // when a shape migration also runs.
  await page.evaluate(() => {
    const meta = JSON.parse(localStorage.getItem('grawlix_meta'));
    meta.find(w => w.name === 'Relo').url = 'https://grawlix.wtf/peter-broda-wordlist.txt';
    localStorage.setItem('grawlix_meta', JSON.stringify(meta));
  });
  await page.reload();
  await page.evaluate(() => window.__grawlixTest.whenReady());

  const NEW_URL = 'https://raw.githubusercontent.com/jkugelman/wordlist/refs/heads/main/peter-broda-wordlist.txt';
  const live = await page.evaluate(() => state.sources.find(w => w.name === 'Relo')?.url);
  expect(live).toBe(NEW_URL);

  const stored = await page.evaluate(() => {
    const meta = JSON.parse(localStorage.getItem('grawlix_meta'));
    return meta.find(w => w.name === 'Relo').url;
  });
  expect(stored).toBe(NEW_URL);
});

test('an old v9 store migrates forward on boot and stamps the new version', async ({ page }) => {
  // Downgrade a freshly-seeded meta to a v9 shape so the reload drives the real
  // load-path migration, not a direct migrateLs call (the first test's job).
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Aged', entries: ['KEEP', 'JUNK'], scores: [50, 70],
  }));

  await page.evaluate(() => {
    const meta = JSON.parse(localStorage.getItem('grawlix_meta'));
    const aged = meta.find(w => w.name === 'Aged');
    aged.rescoreRules = [{ input: '70', length: '', output: 'ignore', note: '' }];
    localStorage.setItem('grawlix_meta', JSON.stringify(meta));
    localStorage.setItem('grawlix_schemaVersion', '9');
  });
  await page.reload();
  await page.evaluate(() => window.__grawlixTest.whenReady());

  await expect(page.locator('#confirm-dialog')).toBeHidden();

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Aged'));
  expect(wl.rescoreRules).toEqual([{ input: '70', length: '', output: '0' }]);

  const stamped = await page.evaluate(() => localStorage.getItem('grawlix_schemaVersion'));
  expect(stamped).toBe(String(await page.evaluate(() => window.__grawlixTest.SCHEMA_VERSION)));
});
