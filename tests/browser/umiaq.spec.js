import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Umiaq is one polymorphic tool: a single pattern filters per word (arity 1, flat
// table), several patterns find arity-N tuples rendered as
// side-by-side lanes. These specs drive both shapes against a small fixture and
// assert the user-visible render, since the engine logic itself is unit-tested.

const WORDS = {
  entries: ['abba', 'noon', 'deed', 'level', 'ape', 'pea', 'bro', 'rob', 'cat', 'dog', 'mama', 'tutu', 'gaga'],
  scores:  [100,     90,     80,     70,      60,    50,    40,    30,    20,    10,    95,     85,     75],
};

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function setup(page) {
  await gotoApp(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist({ name: 'UmiaqWL', ...w }), WORDS);
  await page.evaluate(() => window.__grawlixTest.setScope('UmiaqWL'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function run(page, patterns) {
  await page.evaluate(p => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { patterns: p } }]), patterns);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const tier = page => page.evaluate(() => window.__grawlixTest.windowedFlatDebug().sortTier);
const entries = page => page.evaluate(() => window.__grawlixTest.getVisibleEntries());
const tuples = async page =>
  (await page.evaluate(() => window.__grawlixTest.getVisibleGroups())).map(g => g.chains.map(c => c.join('')));

test('a single pattern is a flat per-word filter', async ({ page }) => {
  await setup(page);
  await run(page, 'ABBA');
  expect(await tier(page)).toBe('single');
  expect(await entries(page)).toEqual(['abba', 'deed', 'noon']);
});

test('a length constraint narrows a single pattern', async ({ page }) => {
  await setup(page);
  await run(page, 'AA;|A|=2');
  expect(await entries(page)).toEqual(['gaga', 'mama', 'tutu']);
});

test('a comparison operator bounds a single pattern length', async ({ page }) => {
  await setup(page);
  await run(page, 'A;|A|<=3');
  expect(await entries(page)).toEqual(['ape', 'bro', 'cat', 'dog', 'pea', 'rob']);
});

test('a single pattern highlights its variables in the flat row', async ({ page }) => {
  await setup(page);
  await run(page, 'ABCBA');                         // matches only 'level' (l·e·v·e·l)
  const marks = await page.evaluate(() => {
    for (const cell of document.querySelectorAll('#vs-host .atom-entry')) {
      if (cell.textContent.trim() === 'level') {
        return [...cell.querySelectorAll('[class^="hl-umiaq-var-"]')]
          .map(s => ({ text: s.textContent, cls: s.className }));
      }
    }
    return null;
  });
  expect(marks).not.toBeNull();
  const colorOf = t => marks.find(m => m.text === t)?.cls;
  expect(colorOf('v')).toBeTruthy();                       // C is lit
  expect(colorOf('l')).not.toBe(colorOf('e'));             // A ≠ B
  expect(colorOf('e')).not.toBe(colorOf('v'));             // B ≠ C
  const lSpans = marks.filter(m => m.text === 'l');
  expect(lSpans.map(s => s.cls)).toEqual([lSpans[0].cls, lSpans[0].cls]);  // A repeats one color
});

test('a multi-pattern query yields side-by-side tuples, lane order preserved', async ({ page }) => {
  await setup(page);
  await run(page, 'AB;BA');
  expect(await tier(page)).toBe('tuple');

  const result = await tuples(page);
  expect(result.length).toBe(7);
  // APE/PEA and PEA/APE are distinct solutions: a regression that reordered lanes
  // would collapse them into one duplicated row.
  expect(result).toContainEqual(['ape', 'pea']);
  expect(result).toContainEqual(['pea', 'ape']);
  expect(result).toContainEqual(['gaga', 'gaga']);

  const laneCounts = await page.evaluate(() =>
    [...document.querySelectorAll('#vs-host .group-row.tuple-row')].map(r => r.querySelectorAll('.group-chain').length));
  expect(laneCounts.length).toBeGreaterThan(0);
  for (const n of laneCounts) expect(n).toBe(2);
  const more = await page.evaluate(() => document.querySelectorAll('#vs-host .tuple-row .group-more:not([hidden])').length);
  expect(more).toBe(0);
});

test('a score sort reorders tuples without reordering their lanes', async ({ page }) => {
  await setup(page);
  await run(page, 'AB;BA');
  await page.evaluate(() => window.__grawlixTest.applySort('max-score', 'desc'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const result = await tuples(page);
  expect(result[0]).toEqual(['mama', 'mama']);   // highest max-score
  expect(result).toContainEqual(['ape', 'pea']);
  expect(result).toContainEqual(['pea', 'ape']);
});

test('tuple export lays each tuple across one row of per-lane columns', async ({ page }) => {
  await setup(page);
  await run(page, 'AB;BA');

  const csv = await page.evaluate(() => window.__grawlixTest.exportText('csv'));
  const lines = csv.trim().split('\n').map(l => l.replace(/\r$/, ''));
  expect(lines[0]).toBe('entry_1,length_1,score_1,comment_1,source_1,entry_2,length_2,score_2,comment_2,source_2');
  expect(lines.length).toBe(8);   // header + 7 tuples, one row each
  expect(lines).toContain('ape,3,60,,UmiaqWL,pea,3,50,,UmiaqWL');

  const json = await page.evaluate(() => window.__grawlixTest.exportText('json'));
  expect(json.tuples.length).toBe(7);
  expect(json.tuples[0].words.map(w => w.entry)).toEqual(['ape', 'pea']);
});

test('tuple lanes highlight each variable in a stable color across lanes', async ({ page }) => {
  await setup(page);
  await run(page, 'AB;BA');

  // ape = A('a') + B('pe'); pea = B('pe') + A('a'). The same variable must wear the
  // same hl-umiaq-var-N class in both lanes — that consistency is the whole point.
  const colors = await page.evaluate(() => {
    for (const row of document.querySelectorAll('#vs-host .tuple-row')) {
      const lanes = [...row.querySelectorAll('.group-chain')];
      const text = l => l.querySelector('.atom-entry')?.textContent ?? '';
      if (text(lanes[0]) === 'ape' && text(lanes[1]) === 'pea') {
        const spans = l => [...l.querySelectorAll('[class^="hl-umiaq-var-"]')]
          .map(s => ({ text: s.textContent, cls: s.className }));
        return { ape: spans(lanes[0]), pea: spans(lanes[1]) };
      }
    }
    return null;
  });
  expect(colors).not.toBeNull();

  const clsOf = (lane, t) => lane.find(s => s.text === t)?.cls;
  const aColor = clsOf(colors.ape, 'a');
  const bColor = clsOf(colors.ape, 'pe');
  expect(aColor).toBeTruthy();
  expect(bColor).toBeTruthy();
  expect(aColor).not.toBe(bColor);                 // A and B are distinct colors
  expect(clsOf(colors.pea, 'a')).toBe(aColor);     // A keeps its color in the other lane
  expect(clsOf(colors.pea, 'pe')).toBe(bColor);    // B keeps its color in the other lane
});

test('an invalid query keeps results transparent but flags the error', async ({ page }) => {
  await setup(page);
  await run(page, '/abc');   // anagram token — unsupported in v1
  expect((await entries(page)).length).toBe(WORDS.entries.length);
  const errBtn = page.locator('.tool-row-error-btn');
  await expect(errBtn).toBeVisible();
  await expect(errBtn).toHaveAttribute('title', 'anagram (/) is not supported yet');
});

// Guards against the range trimming an out-of-range lane and keeping the rest, which
// rendered an arity-3 tuple with one low lane as a 2-lane row instead of dropping it.
test('the score range keeps or drops a whole tuple, never trims a lane', async ({ page }) => {
  await gotoApp(page);
  // blueball (20) is the only lane below the 40+ range applied later.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Tup',
    entries: ['dogcat', 'dogball', 'catchain', 'bluelight', 'blueball', 'lightchain'],
    scores:  [50,        50,        50,         50,           20,         50],
  }));
  await page.evaluate(() => window.__grawlixTest.setScope('Tup'));
  await run(page, 'AB;Aball;Bchain');

  const laneCounts = page => page.evaluate(() =>
    [...document.querySelectorAll('#vs-host .group-row.tuple-row')].map(r => r.querySelectorAll('.group-chain').length));

  expect(await laneCounts(page)).toEqual([3, 3]);

  await page.evaluate(() => AppView.onScoreRange('40+'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  expect(await laneCounts(page)).toEqual([3]);
  expect(await tuples(page)).toEqual([['dogcat', 'dogball', 'catchain']]);
});
