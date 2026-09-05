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

test('Markdown link uses backtick-quoted params', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'c?t' } }]);

  const text = await getExport(page, 'markdown-link');
  expect(text).toMatch(/^\[Search `c\?t`\]\(http/);
});

test('Markdown link prefixes an inverted filter with a 🚫', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'c?t' }, invert: true }]);

  const text = await getExport(page, 'markdown-link');
  expect(text).toMatch(/^\[🚫 Search `c\?t`\]\(http/);
});

test('Markdown link prefixes a grouped tool with a ✱', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'letter_bank', grouped: true }]);

  const text = await getExport(page, 'markdown-link');
  expect(text).toMatch(/^\[✱ Letter bank\]\(http/);
});

test('Copy renders multi-entry chains inline with their glyphs', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'head_off', params: { pattern: '?' } }]);

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

// Seed after the tool-less run settles: that run evicts the unigram asset, and a
// seed it wipes silently sends Space out to the real multi-MB network fetch.
async function addSpaceOutFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SpaceOutTest',
    entries: ['abarreloflaughs', 'barrel', 'laughs'],
    scores:  [80, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.setWorkerUnigramCorpus(
    { a: -3, barrel: -11, of: -3, laughs: -10 }));
}

test('Copy keeps a Space out re-spacing beside its glued input', async ({ page }) => {
  await gotoApp(page);
  await addSpaceOutFixture(page);
  await setStack(page, [{ tool: 'space_out' }]);

  const text = await getExport(page, 'copy');
  expect(text).toContain('15 ABARRELOFLAUGHS → 15 A BARREL OF LAUGHS');
});

test('Copy folds a trailing search\'s highlight slot but keeps the re-spacing it sits on', async ({ page }) => {
  await gotoApp(page);
  await addSpaceOutFixture(page);
  await setStack(page, [{ tool: 'space_out' }, { tool: 'search', params: { pattern: 'abarreloflaughs' } }]);

  const text = await getExport(page, 'copy');
  expect(text).toBe('15 ABARRELOFLAUGHS → 15 A BARREL OF LAUGHS');
});

test('Wordlist exports a Space out re-spacing as the spaced tail', async ({ page }) => {
  await gotoApp(page);
  await addSpaceOutFixture(page);
  await setStack(page, [{ tool: 'space_out' }]);

  const { text } = await getExport(page, 'wordlist');
  expect(text).toContain('a barrel of laughs;80\n');
  expect(text).not.toContain('abarreloflaughs;80');
});

test('CSV carries a Space out re-spacing as entry_2 with blank comment and source', async ({ page }) => {
  await gotoApp(page);
  await addSpaceOutFixture(page);
  await setStack(page, [{ tool: 'space_out' }]);

  const text = await getExport(page, 'csv');
  expect(text).toContain('80,80,abarreloflaughs,15,80,,SpaceOutTest,a barrel of laughs,15,80,,\r\n');
});

test('Markdown link omits backticks around numeric params', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'caesar', params: { shift: '3' } }]);

  const text = await getExport(page, 'markdown-link');
  expect(text).toMatch(/^\[Caesar shift 3\]\(http/);
});

test('Markdown link for empty pipeline uses [Grawlix](URL)', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, []);

  const text = await getExport(page, 'markdown-link');
  expect(text).toMatch(/^\[Grawlix\]\(http/);
});

test('Wordlist dumps tail entries with chain-min score, alphabetically sorted', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setStack(page, [{ tool: 'head_off', params: { pattern: '?' } }]);

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
  await setStack(page, [{ tool: 'head_off', params: { pattern: '?' } }]);

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
  await setStack(page, [{ tool: 'head_off', params: { pattern: '?' } }]);

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
    { tool: 'head_off', params: { pattern: '?' } },
    { tool: 'search', params: { pattern: 'a' } },
  ]);

  const json = await getExport(page, 'json');
  expect(json.tools).toEqual([
    { name: 'head_off', params: { pattern: '?' } },
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
  await setStack(page, [{ tool: 'head_off', params: { pattern: '?' } }]);

  const json = await getExport(page, 'json');
  expect(json.tools.map(t => t.name)).toEqual(['head_off']);
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
    { tool: 'head_off', params: { pattern: '?' } },
    { tool: 'search', params: { pattern: 'a' } },
  ]);

  const name = await page.evaluate(() => window.__grawlixTest.exportFilename('json'));
  expect(name).toBe('grawlix-head_off-search-a.json');
});
