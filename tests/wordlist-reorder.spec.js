// Drag-to-reorder runs on pointer events (native HTML5 drag never fires from
// touch), so these drive the real pointer path rather than the moveBefore API.
// The disabled-card test pins that the drag path has no enabled-gate.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

function sourceOrder(page) {
  return page.evaluate(() => state.sources.map(s => s.name));
}

// Two couplings to makeReorderable: the +10px nudge clears the drag-start
// threshold, and releasing in the target's top half selects insert-before —
// the adjacency the assertions below check.
async function dragCardBefore(page, fromName, beforeName) {
  const card   = name => page.locator('.wordlist-card[data-wordlist]', { hasText: name }).first();
  const handle = card(fromName).locator('.drag-handle');
  await handle.scrollIntoViewIfNeeded();
  const h = await handle.boundingBox();
  await card(beforeName).scrollIntoViewIfNeeded();
  const t = await card(beforeName).boundingBox();

  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 10);
  await page.mouse.move(t.x + t.width / 2, t.y + t.height * 0.25, { steps: 12 });
  await page.mouse.up();
}

async function addThree(page) {
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await page.evaluate(n => window.__grawlixTest.addCustomWordlist({
      name: n, entries: ['ENTRY' + n.toUpperCase()], scores: [50],
    }), name);
  }
}

test('dropping a card before an earlier one reorders state.sources', async ({ page }) => {
  await gotoApp(page);
  await addThree(page);
  await openLibrary(page);

  await dragCardBefore(page, 'Gamma', 'Alpha');

  await expect.poll(async () => {
    const order = await sourceOrder(page);
    return order.filter(n => ['Alpha', 'Beta', 'Gamma'].includes(n));
  }).toEqual(['Gamma', 'Alpha', 'Beta']);
});

test('a disabled card reorders just like an enabled one', async ({ page }) => {
  await gotoApp(page);
  await addThree(page);
  await openLibrary(page);

  await page.getByLabel('Toggle Gamma').uncheck();
  await expect(page.locator('.wordlist-card[data-wordlist]', { hasText: 'Gamma' }).first())
    .toHaveClass(/disabled/);

  await dragCardBefore(page, 'Gamma', 'Alpha');

  await expect.poll(async () => {
    const order = await sourceOrder(page);
    return order.filter(n => ['Alpha', 'Beta', 'Gamma'].includes(n));
  }).toEqual(['Gamma', 'Alpha', 'Beta']);
});
