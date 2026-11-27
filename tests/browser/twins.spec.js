import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await page.route(/cmudict\.dict/, route => route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
});

test('keeps entries that look like the query, the query itself first and then most alike', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.addCustomWordlist({
      name: 'Twins',
      entries: ['submarket', 'ball marker', 'zebra crossing', 'bull markets', 'bulwarked', 'bull market'],
      scores: [50, 50, 50, 50, 50, 50],
    });
    await T.setStack([{ tool: 'twins', params: { entry: 'bull market' } }]);
  });
  await expectVisible(page, ['bull market', 'ball marker', 'bulwarked', 'submarket'], { ordered: true });
  await expect(page.locator('#vs-host .entry-row .tool-meter--special')).toHaveAttribute('aria-label', 'Similarity: the typed entry');
  await expect(page.locator('.entry-headers .col-tool')).toHaveText('Similarity ↓');
  await expect(page.locator('.col-tool .col-sort')).toContainText('↓');
  await expect(page).not.toHaveURL(/sort=/);
  const levels = await page.locator('#vs-host .entry-row .tool-meter:not(.tool-meter--special)').evaluateAll(cells => cells
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(c => c.dataset.level));
  expect(levels).toEqual(['6', '6', '5']);
});

test('an Entry pick holds against the default and lands in the URL', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.addCustomWordlist({ name: 'Twins', entries: ['submarket', 'ball marker', 'bulwarked'], scores: [50, 50, 50] });
    await T.setStack([{ tool: 'twins', params: { entry: 'bull market' } }]);
  });
  await expectVisible(page, ['ball marker', 'bulwarked', 'submarket'], { ordered: true });
  await page.locator('.col-entry .col-sort').click();
  await expect(page).toHaveURL(/sort=entry/);
  await expectVisible(page, ['ball marker', 'bulwarked', 'submarket'], { ordered: true });
  await page.locator('.col-entry .col-sort').click();
  await expectVisible(page, ['submarket', 'bulwarked', 'ball marker'], { ordered: true });
});

test('🎲 fills the entry with a random entry and shows its twins', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.addCustomWordlist({ name: 'Twins', entries: ['bull market', 'ball marker'], scores: [50, 50] });
    await T.setStack([{ tool: 'twins', params: { entry: '' } }]);
  });
  await expect(page.locator('.tool-row .clearable-input .tool-row-dice')).toHaveCount(0);
  await page.locator('.tool-row-dice').click();
  const input = page.locator('.tool-row input[data-key="entry"]');
  await expect(input).toHaveValue(/^(bull market|ball marker)$/);
  const typed = await input.inputValue(), other = typed === 'bull market' ? 'ball marker' : 'bull market';
  await expectVisible(page, [typed, other], { ordered: true });
});

test('🎲 rolls from the visible wordlist within the score filter', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.addCustomWordlist({ name: 'Other', entries: ['zebra crossing'], scores: [60] });
    await T.addCustomWordlist({ name: 'Mine', entries: ['bull market', 'ball marker', 'bulwarked'], scores: [60, 20, 60] });
    await T.setScope('Mine');
    await T.setStack([{ tool: 'twins', params: { entry: '' } }]);
  });
  await page.evaluate(() => {
    const input = document.querySelector('#score-range-input');
    input.value = '50+';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const input = page.locator('.tool-row input[data-key="entry"]');
  for (let i = 0; i < 12; i++) {
    await page.locator('.tool-row-dice').click();
    await expect(input).not.toHaveValue('');
    expect(['bull market', 'bulwarked']).toContain(await input.inputValue());
    await input.fill('');
  }
});

test('a pair found by sound gets its similarity too', async ({ page }) => {
  await page.unroute(/cmudict\.dict/);
  await page.route(/cmudict\.dict/, route => route.fulfill({ status: 200, contentType: 'text/plain',
    body: 'midnight M IH1 D N AY2 T\nride R AY1 D\ndid D IH1 D\nright R AY1 T\nby B AY1\nzebra Z IY1 B R AH0\n' }));
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.addCustomWordlist({ name: 'Twins', entries: ['did right by', 'zebra'], scores: [50, 50] });
    await T.setStack([{ tool: 'twins', params: { entry: 'midnight ride' } }]);
  });
  await expectVisible(page, ['did right by']);
  await expect(page.locator('#vs-host .entry-row .tool-meter')).not.toHaveAttribute('data-level', '0');
});

test('an unspaced entry CMU lacks is read through its split, as Rhymes reads it', async ({ page }) => {
  await page.unroute(/cmudict\.dict/);
  await page.route(/cmudict\.dict/, route => route.fulfill({ status: 200, contentType: 'text/plain',
    body: 'flower F L AW1 ER0\nbed B EH1 D\nshower SH AW1 ER0\nhead HH EH1 D\nzebra Z IY1 B R AH0\n' }));
  await gotoApp(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Twins', entries: ['flowerbed', 'flower', 'bed', 'zebra'], scores: [50, 50, 50, 50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), { flowerbed: -4, flower: -3, bed: -3, shower: -3, head: -3 });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'twins', params: { entry: 'shower head' } }]));
  await expectVisible(page, ['flowerbed']);
});

// Production serves the click from the Twins prefix tile: the finished cache
// prices a result by its cheap tail past that tile and refuses it. The tiny
// list's Twins stage is under the tile's floor, so only that floor is lowered.
test('🎲 rolls ahead while the page is quiet, and a click seeds from that roll\'s cached Twins stage', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    T.configurePrefixCacheForTest({ minMs: 0 });
    T.setDiceQuietMs(50);
    await T.addCustomWordlist({ name: 'Twins', entries: ['bull market', 'ball marker', 'bulwarked'], scores: [50, 50, 50] });
    await T.setStack([{ tool: 'twins', params: { entry: '' } }]);
  });
  const die = page.locator('.tool-row-dice');
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.dicePrerollView()?.head ?? null)).not.toBeNull();
  expect(await page.evaluate(() => window.__grawlixTest.dicePrerollView().strong)).toBe(false);
  // Probes still rolling would seed from these entries' tiles too.
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.dicePrerollView().gaveUp)).toBe(true);
  const { head } = await page.evaluate(() => window.__grawlixTest.dicePrerollView());
  const before = await page.evaluate(() => window.__grawlixTest.prefixCacheState());
  await die.click();
  await expect(page.locator('.tool-row input[data-key="entry"]')).toHaveValue(head);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const after = await page.evaluate(() => window.__grawlixTest.prefixCacheState());
  expect(after.hits).toBe(before.hits + 1);
  expect(after.seedFrom).toBe(1);
});

test('🎲 puts a roll with a twin at seven bars or more first', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    T.setDiceQuietMs(50);
    await T.addCustomWordlist({ name: 'Twins', entries: ['lactose', 'lactase'], scores: [50, 50] });
    await T.setStack([{ tool: 'twins', params: { entry: '' } }]);
  });
  const die = page.locator('.tool-row-dice');
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.dicePrerollView()?.strong ?? false)).toBe(true);
  const { head, strong } = await page.evaluate(() => window.__grawlixTest.dicePrerollView());
  expect(strong).toBe(true);
  await die.click();
  await expect(page.locator('.tool-row input[data-key="entry"]')).toHaveValue(head);
});

test('🎲 drops its pre-roll when the stack it was rolled for changes', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    T.setDiceQuietMs(50);
    await T.addCustomWordlist({ name: 'Twins', entries: ['bull market', 'ball marker', 'bulwarked'], scores: [50, 50, 50] });
    await T.setStack([{ tool: 'twins', params: { entry: '' } }]);
  });
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.dicePrerollView()?.head ?? null)).not.toBeNull();
  await page.evaluate(() => window.__grawlixTest.setDiceQuietMs(60000));
  await page.locator('.search-bar input[data-key="pattern"]').fill('bu');
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.dicePrerollView().queue.length)).toBe(0);
});

test('🎲 queues up to four rolls, strong ones first', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    T.setDiceQuietMs(50);
    await T.addCustomWordlist({ name: 'Twins',
      entries: ['lactose', 'lactase', 'bull market', 'ball marker', 'bulwarked', 'zebra crossing'], scores: [50, 50, 50, 50, 50, 50] });
    await T.setStack([{ tool: 'twins', params: { entry: '' } }]);
  });
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.dicePrerollView().gaveUp)).toBe(true);
  const { queue } = await page.evaluate(() => window.__grawlixTest.dicePrerollView());
  expect(queue).toHaveLength(4);
  expect(queue.slice(0, 2).map(r => r.display).sort()).toEqual(['lactase', 'lactose']);
  expect(queue.map(r => r.strong)).toEqual([true, true, false, false]);
});

test('🎲 clicked mid-roll takes that roll over and shows what it has found so far', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.addCustomWordlist({ name: 'Twins', entries: ['bull market', 'ball marker', 'bulwarked'], scores: [50, 50, 50] });
    T.holdPreroll();
    T.setDiceQuietMs(50);
    await T.setStack([{ tool: 'twins', params: { entry: '' } }]);
  });
  await expect.poll(() => page.evaluate(() => typeof window.__grawlixTest.dicePrerollView()?.probing)).toBe('string');
  const { probing } = await page.evaluate(() => window.__grawlixTest.dicePrerollView());
  await page.locator('.tool-row-dice').click();
  await expect(page.locator('.tool-row input[data-key="entry"]')).toHaveValue(probing);
  await expect(page.locator('#vs-host .entry-row').first()).toContainText(probing);
  await page.evaluate(() => window.__grawlixTest.releasePreroll());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#vs-host .entry-row').first()).toContainText(probing);
  const view = await page.evaluate(() => window.__grawlixTest.dicePrerollView());
  expect(view.adoptions).toBe(1);
});

test('🎲 judges a roll only by the twins the filters show', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.addCustomWordlist({ name: 'Twins', entries: ['lactose', 'lactase'], scores: [50, 0] });
    const input = document.querySelector('#score-range-input');
    input.value = '1+';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await T.pipelineIdle();
    T.setDiceQuietMs(50);
    await T.setStack([{ tool: 'twins', params: { entry: '' } }]);
  });
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.dicePrerollView().gaveUp)).toBe(true);
  const { queue } = await page.evaluate(() => window.__grawlixTest.dicePrerollView());
  expect(queue).toEqual([{ display: 'lactose', strong: false }]);
});
