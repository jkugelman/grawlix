import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'ExportTest',
    entries: ['scar', 'car', 'swing', 'wing', 'post', 'stop', 'spot', 'tops', 'cat', 'cot'],
    scores:  [50,     60,    70,      30,     50,     60,     55,     40,     70,    30],
    comments:['',     'auto', '',     '',     '',     '',     '',     '',     '',    ''],
  }));
}

async function setStack(page, stack) {
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
}

async function getExport(page, format) {
  return page.evaluate(f => window.__grawlixTest.exportText(f), format);
}

test('Copy header is a markdown link with backtick-quoted params', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'c?t' } }]);

  const text = await getExport(page, 'copy');
  expect(text).toMatch(/^\[Search `c\?t`\]\(http/);
});

test('Copy header prefixes an inverted filter with a 🚫', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'c?t' }, invert: true }]);

  const text = await getExport(page, 'copy');
  expect(text).toMatch(/^\[🚫 Search `c\?t`\]\(http/);
});

test('Copy header prefixes a grouped tool with a ✱', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'letter_bank', grouped: true }]);

  const text = await getExport(page, 'copy');
  expect(text).toMatch(/^\[✱ Letter bank\]\(http/);
});

test('Copy renders multi-entry chains inline with their glyphs', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'behead', params: { count: '1' } }]);

  const text = await getExport(page, 'copy');
  expect(text).toContain('4 SCAR  → 3 CAR');
  expect(text).toContain('5 SWING → 4 WING');
});

test('Copy lists group members per line, no group key', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'letter_bank', grouped: true }]);

  const text = await getExport(page, 'copy');
  expect(text).not.toContain('opst:');
  const memberLine = text.split('\n').find(l => {
    const members = l.split(', ').sort();
    return members.length === 4 && members.join(',') === '4 POST,4 SPOT,4 STOP,4 TOPS';
  });
  expect(memberLine).toBeTruthy();
});

test('Copy header omits backticks around numeric params', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'behead', params: { count: '1' } }]);

  const text = await getExport(page, 'copy');
  expect(text).toMatch(/^\[Behead 1\]\(http/);
});

test('Copy header for empty pipeline uses [All Wordlists](URL)', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, []);

  const text = await getExport(page, 'copy');
  expect(text).toMatch(/^\[All Wordlists\]\(http/);
});

test('Wordlist dumps tail entries with chain-min score, alphabetically sorted', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'behead', params: { count: '1' } }]);

  const { text, count, skipped } = await getExport(page, 'wordlist');
  expect(skipped).toBe(0);
  expect(count).toBe(2);
  expect(text).toBe('car;50;auto\nwing;30\n');   // comments ride along at the default format
});

test('CSV flat one-entry rows: header is entry,length,score,comment,source', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'c?t' } }]);

  const text = await getExport(page, 'csv');
  const headerRow = text.split('\r\n')[0];
  expect(headerRow).toBe('entry,length,score,comment,source');
});

test('CSV chain rows: header interleaves entry/length/score/comment/source per atom with min/max prefix', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'behead', params: { count: '1' } }]);

  const text = await getExport(page, 'csv');
  const headerRow = text.split('\r\n')[0];
  expect(headerRow).toBe(
    'min_score,max_score,' +
    'entry_1,length_1,score_1,comment_1,source_1,' +
    'entry_2,length_2,score_2,comment_2,source_2'
  );
});

test('CSV grouped rows: header has group_key, count, catalog cols, no comment/source', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'letter_bank', grouped: true }]);

  const text = await getExport(page, 'csv');
  const headerRow = text.split('\r\n')[0];
  expect(headerRow).toBe('group_key,count,letters,entry,length,score');
});

test('CSV quotes cells containing commas or quotes per RFC 4180', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'CSVQuote',
    entries: ['alpha', 'bravo', 'charlie'],
    scores:  [50, 50, 50],
    comments: ['plain', 'has,commas', 'has "quotes"'],
  }));
  await setStack(page, []);

  const text = await getExport(page, 'csv');
  expect(text).toContain('"has,commas"');
  expect(text).toContain('"has ""quotes"""');
});

test('CSV body row matches the declared chain shape (entry,length,score,comment,source)', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'swing' } }]);

  const text = await getExport(page, 'csv');
  const lines = text.split('\r\n');
  expect(lines[1]).toBe('swing,5,70,,ExportTest');
});

test('JSON has uniform shape: groups → chains → entries (flat is one mega-group)', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'c?t' } }]);

  const json = await getExport(page, 'json');
  expect(json).toHaveProperty('groups');
  expect(json.groups).toHaveLength(1);
  expect(json.groups[0]).not.toHaveProperty('group_key');
  expect(json.groups[0].chains.length).toBeGreaterThan(0);
  expect(json.groups[0].chains[0]).toHaveProperty('entries');
});

test('JSON drops generically-computed fields (length, count, min_score, max_score)', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'behead', params: { count: '1' } }]);

  const json = await getExport(page, 'json');
  const chain = json.groups[0].chains[0];
  expect(chain).not.toHaveProperty('min_score');
  expect(chain).not.toHaveProperty('max_score');
  expect(chain.entries[0]).not.toHaveProperty('length');
});

test('JSON keeps catalog group cols on grouped pipelines but drops `count`', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'letter_bank', grouped: true }]);

  const json = await getExport(page, 'json');
  const opst = json.groups.find(g => g.group_key === 'opst');
  expect(opst).toBeTruthy();
  expect(opst).toHaveProperty('letters', 4);
  expect(opst).not.toHaveProperty('count');
  expect(opst.chains).toHaveLength(4);
});

test('JSON omits comment/source on grouped chains, includes on flat', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await setStack(page, [{ tool: 'letter_bank', grouped: true }]);
  let json = await getExport(page, 'json');
  const groupedEntry = json.groups[0].chains[0].entries[0];
  expect(groupedEntry).not.toHaveProperty('comment');
  expect(groupedEntry).not.toHaveProperty('source');

  await setStack(page, []);
  json = await getExport(page, 'json');
  const flatEntry = json.groups[0].chains[0].entries[0];
  expect(flatEntry).toHaveProperty('comment');
  expect(flatEntry).toHaveProperty('source');
});

test('JSON metadata: tools array reflects pipeline order with params', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [
    { tool: 'behead', params: { count: '1' } },
    { tool: 'search', params: { pattern: 'a' } },
  ]);

  const json = await getExport(page, 'json');
  expect(json.tools).toEqual([
    { name: 'behead', params: { count: '1' } },
    { name: 'search', params: { pattern: 'a' } },
  ]);
});

test('JSON metadata: tools array flags an inverted filter with invert:true', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'a' }, invert: true }]);

  const json = await getExport(page, 'json');
  expect(json.tools).toEqual([
    { name: 'search', params: { pattern: 'a' }, invert: true },
  ]);
});

test('JSON metadata: tools array skips the inert permanent search bar', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'behead', params: { count: '1' } }]);

  const json = await getExport(page, 'json');
  expect(json.tools.map(t => t.name)).toEqual(['behead']);
});

test('JSON metadata: score_range is {min, max} when fully specified', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, []);
  await page.evaluate(() => AppView.onScoreRange('40-60'));

  const json = await getExport(page, 'json');
  expect(json.score_range).toEqual({ min: 40, max: 60 });
});

test('JSON metadata: score_range omitted when no range set', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, []);
  await page.evaluate(() => AppView.onScoreRange(''));

  const json = await getExport(page, 'json');
  expect(json).not.toHaveProperty('score_range');
});

test('JSON metadata: score_range omits open-ended bound', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, []);
  await page.evaluate(() => AppView.onScoreRange('40+'));

  const json = await getExport(page, 'json');
  expect(json.score_range).toEqual({ min: 40 });
});

test('Filename includes tool keys for chained pipeline', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [
    { tool: 'behead', params: { count: '1' } },
    { tool: 'search', params: { pattern: 'a' } },
  ]);

  const name = await page.evaluate(() => window.__grawlixTest.exportFilename('json'));
  expect(name).toBe('grawlix-behead-1-search-a.json');
});
