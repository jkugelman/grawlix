// Drag-to-reorder runs on pointer events (native HTML5 drag never fires from
// touch), so these drive the real pointer path rather than the moveBefore API.
// Reorder lives in the Manage panel: a drag stages into the shadow and Apply
// commits to state.sources. The disabled-row test pins that the drag path has
// no enabled-gate.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openManagePanel } = require('./helpers');

// A taller viewport so the panel's full row list fits without scrolling. With
// the default 720px height the 9-row list overflows its 50vh cap and the drag's
// edge-auto-scroll shifts every row mid-gesture, landing the drop a slot off.
test.use({ viewport: { width: 1280, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const TEST_LISTS = ['Alpha', 'Beta', 'Gamma'];

function sourceOrder(page) {
  return page.evaluate(names =>
    state.sources.map(s => s.name).filter(n => names.includes(n)), TEST_LISTS);
}

// Two couplings to makeReorderable: the +10px nudge clears the drag-start
// threshold, and releasing in the target's top quarter selects insert-before —
// the adjacency the assertions below check.
async function dragRowBefore(page, fromName, beforeName) {
  const row    = name => page.locator('#manage-dialog .wordlist-card', { hasText: name }).first();
  const handle = row(fromName).locator('.drag-handle');
  const h = await handle.boundingBox();
  const t = await row(beforeName).boundingBox();

  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 10);
  await page.mouse.move(t.x + t.width / 2, t.y + t.height * 0.25, { steps: 12 });
  await page.mouse.up();
}

async function addThree(page) {
  for (const name of TEST_LISTS) {
    await page.evaluate(n => window.__grawlixTest.addCustomWordlist({
      name: n, entries: ['ENTRY' + n.toUpperCase()], scores: [50],
    }), name);
  }
}

test('dropping a row before an earlier one reorders state.sources on Apply', async ({ page }) => {
  await gotoApp(page);
  await addThree(page);

  await openManagePanel(page);
  await dragRowBefore(page, 'Gamma', 'Alpha');
  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  await expect.poll(() => sourceOrder(page)).toEqual(['Gamma', 'Alpha', 'Beta']);
});

test('a disabled row reorders just like an enabled one', async ({ page }) => {
  await gotoApp(page);
  await addThree(page);

  await openManagePanel(page);
  await page.locator('#manage-dialog .wordlist-card label.toggle[aria-label="Toggle Gamma"]').click();
  await expect(page.locator('#manage-dialog .wordlist-card', { hasText: 'Gamma' }).first())
    .toHaveClass(/disabled/);

  await dragRowBefore(page, 'Gamma', 'Alpha');
  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  await expect.poll(() => sourceOrder(page)).toEqual(['Gamma', 'Alpha', 'Beta']);
});
