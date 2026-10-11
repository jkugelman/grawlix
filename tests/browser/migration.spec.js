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
        { query: 'score: 0',  output: '0', note: 'junk' },
        { query: 'score: 50', output: '',  note: 'Fine' },
      ],
    },
    {
      dbKey: 'k-broda', publisherId: 'broda', name: 'Peter Broda', icon: null,
      url: 'https://grawlix.wtf/peter-broda-wordlist.txt',
      enabled: true, populated: true, lastUpdated: 1700000000000, dirty: false,
      rescoreRules: [
        { query: 'score: 76-100 and length: 7+', output: '60', note: '', scoring: false },
        { query: 'score: 0-100',                 output: '0',  note: '' },
      ],
    },
    {
      dbKey: 'k-custom', publisherId: null, name: 'Mine', icon: null,
      url: null, enabled: true, populated: true, lastUpdated: 1700000000000,
      rescoreRules: [
        { query: 'score: 5', output: '0',  note: 'cased' },
        { query: 'score: 6', output: '0',  note: 'padded' },
        { query: 'score: 7', output: '30', note: 'kept' },
      ],
    },
  ],
  scoring: [
    { input: '60', note: 'Great' },
    { input: '50', note: 'Fine' },
  ],
  scoringDirty: false,
  mergedSettings: { outputFormat: { spaces: true, punctuation: true, digits: true, diacritics: true, symbols: true, comments: true } },
};

test('migration v9→v10 rewrites every "ignore" rescore output to "0"', async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(
    (before) => window.__grawlixTest.migrateLs(structuredClone(before), 9),
    V9_BEFORE,
  );
  expect(result).toEqual(V10_AFTER);
});

// v17 persisted each rule's compiled fields beside it (_scoreIntervals,
// _lenIntervals, _output), so a real v17 store carries them.
const V17_BEFORE = {
  sources: [
    {
      type: 'edits', dbKey: 'k-edits', name: 'My Edits',
      icon: { type: 'emoji', value: '✏️' },
      url: null, enabled: true, populated: true, lastUpdated: null, fetchedSize: null,
      rescoreRules: [
        { input: '60', length: '', output: '', note: 'Good', _scoreIntervals: [{ min: 60, max: 60 }], _lenIntervals: null, _output: 'unchanged' },
        { input: '50', length: '', output: '', note: 'Average', _scoreIntervals: [{ min: 50, max: 50 }], _lenIntervals: null, _output: 'unchanged' },
      ],
      originalFilename: null,
    },
    {
      dbKey: 'k-nediger', publisherId: 'nediger', name: 'Will Nediger', icon: null,
      url: 'https://raw.codeberg.page/bewilderingly/Nediger-list/@main/nediger list.txt',
      enabled: true, populated: true, lastUpdated: 1760000000000, fetchedSize: 5000000,
      rescoreRules: [
        { input: '99', length: '1-2', output: '40', note: 'Short fill', scoring: false, _scoreIntervals: [{ min: 99, max: 99 }], _lenIntervals: [{ min: 1, max: 2 }], _output: 40 },
        { input: '99', length: '',    output: '50', note: 'Good for any venue', _scoreIntervals: [{ min: 99, max: 99 }], _lenIntervals: null, _output: 50 },
      ],
      dirty: true,
      originalFilename: 'nediger list.txt',
    },
    {
      dbKey: 'k-custom', name: 'Mine', icon: null,
      url: null, enabled: false, populated: true, lastUpdated: 1760000000000, fetchedSize: null,
      rescoreRules: [
        { input: '50+',   length: '',  output: '60+',   note: 'shift', _scoreIntervals: [{ min: 50, max: null }], _lenIntervals: null, _output: { min: 60, max: null } },
        { input: '50,60', length: '',  output: '10',    note: 'never matched', _scoreIntervals: null, _lenIntervals: null, _output: 10 },
        { input: '10-40', length: '8+', output: '0-30', note: 'scale', _scoreIntervals: [{ min: 10, max: 40 }], _lenIntervals: [{ min: 8, max: null }], _output: { min: 0, max: 30 } },
      ],
      originalFilename: 'mine.txt',
    },
  ],
  scoring: [
    { input: '60', note: 'Good' },
    { input: '50', note: 'Average' },
  ],
  scoringDirty: true,
  mergedSettings: { trashScore: 20, outputFormat: { spaces: true, punctuation: true, digits: true, diacritics: true, symbols: true, comments: true } },
};

const V18_AFTER = {
  sources: [
    {
      type: 'edits', dbKey: 'k-edits', name: 'My Edits',
      icon: { type: 'emoji', value: '✏️' },
      url: null, enabled: true, populated: true, lastUpdated: null, fetchedSize: null,
      rescoreRules: [
        { query: 'score: 60', output: '', note: 'Good' },
        { query: 'score: 50', output: '', note: 'Average' },
      ],
      originalFilename: null,
    },
    {
      dbKey: 'k-nediger', publisherId: 'nediger', name: 'Will Nediger', icon: null,
      url: 'https://raw.codeberg.page/bewilderingly/Nediger-list/@main/nediger list.txt',
      enabled: true, populated: true, lastUpdated: 1760000000000, fetchedSize: 5000000,
      rescoreRules: [
        { query: 'score: 99 and length: 1-2', output: '40', note: 'Short fill', scoring: false },
        { query: 'score: 99',                 output: '50', note: 'Good for any venue' },
      ],
      dirty: true,
      originalFilename: 'nediger list.txt',
    },
    {
      dbKey: 'k-custom', name: 'Mine', icon: null,
      url: null, enabled: false, populated: true, lastUpdated: 1760000000000, fetchedSize: null,
      rescoreRules: [
        { query: 'score: 50+',                  output: '60+',  note: 'shift' },
        { query: 'score: 10-40 and length: 8+', output: '0-30', note: 'scale' },
      ],
      originalFilename: 'mine.txt',
    },
  ],
  scoring: [
    { input: '60', note: 'Good' },
    { input: '50', note: 'Average' },
  ],
  scoringDirty: true,
  mergedSettings: { trashScore: 20, outputFormat: { spaces: true, punctuation: true, digits: true, diacritics: true, symbols: true, comments: true } },
};

test('migration v17→v18 folds rule score and length into a query and drops dead rules', async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(
    (before) => window.__grawlixTest.migrateLs(structuredClone(before), 17),
    V17_BEFORE,
  );
  expect(result).toEqual(V18_AFTER);
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
  expect(wl.rescoreRules).toEqual([{ query: 'score: 70', output: '0' }]);

  const stamped = await page.evaluate(() => localStorage.getItem('grawlix_schemaVersion'));
  expect(stamped).toBe(String(await page.evaluate(() => window.__grawlixTest.SCHEMA_VERSION)));
});
