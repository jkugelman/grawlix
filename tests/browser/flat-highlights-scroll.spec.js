const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// B5: the flat tier ships no highlights — the main thread re-derives them for the
// visible window only. This guards that the re-derivation is correct AFTER
// scrolling (a window-position bug would mark stale or wrong letters mid-list).

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// 400 distinct, sortable entries all containing the literal QX, but at a varying
// offset (1–8 leading A's). A `qx` search marks QX in every row; because the
// offset differs, a re-derivation that reused one row's ranges for another would
// slice the wrong characters and the marked text would stop equalling "QX".
async function addBroadFixture(page) {
  await page.evaluate(() => {
    const entries = [], scores = [];
    for (let i = 0; i < 400; i++) {
      entries.push('A'.repeat(1 + (i % 8)) + 'QX' + String(i).padStart(3, '0'));
      scores.push(10 + (i % 50));
    }
    window.__grawlixTest.addCustomWordlist({ name: 'Broad', entries, scores });
  });
}

function setSearch(page, pattern) {
  return page.evaluate(p => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: p } }]), pattern);
}

function rowMarks(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleRowMarks());
}

function assertMarksMatchText(rows) {
  expect(rows.length).toBeGreaterThan(0);
  for (const { text, marks } of rows) {
    expect(text).toContain('QX');
    expect(marks).toEqual(['QX']);
  }
}

test('flat-tier search highlights are correct on the initial window', async ({ page }) => {
  await gotoApp(page);
  await addBroadFixture(page);
  await setSearch(page, 'qx');
  assertMarksMatchText(await rowMarks(page));
});

test('flat-tier search highlights stay correct after scrolling deep into a broad result', async ({ page }) => {
  await gotoApp(page);
  await addBroadFixture(page);
  await setSearch(page, 'qx');

  const top = await rowMarks(page);
  assertMarksMatchText(top);

  await page.evaluate(() => window.scrollTo(0, 7000));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  const deep = await rowMarks(page);
  assertMarksMatchText(deep);
  expect(deep[0].text).not.toBe(top[0].text);   // we actually scrolled onto new rows
});
