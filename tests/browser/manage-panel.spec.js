// Manage wordlists panel (Stage 5c-i of the unify redesign). The panel stages
// enable/disable changes on a shadow copy and only commits to canonical state on
// Apply — one merge rebuild behind the modal. These tests pin that staging
// contract: nothing canonical moves until Apply, Cancel discards, and a dirty X
// guards with a confirm.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openManagePanel } = require('./helpers');

// Taller viewport so every card fits without scrolling — else makeReorderable's
// drag auto-scroll flakes the reorder tests (as in wordlist-reorder.spec).
test.use({ viewport: { width: 1280, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// The native checkbox is hidden behind a custom slider; click the wrapping
// label (its toggle) rather than the invisible input.
function rowToggle(page, name) {
  return page.locator(`#manage-dialog .wordlist-card label.toggle[aria-label="Toggle ${name}"]`);
}

async function addTwoLists(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TestFruits', entries: ['APPLE', 'BANANA', 'CHERRY'], scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TestBerries', entries: ['BLUEBERRY', 'RASPBERRY', 'STRAWBERRY'], scores: [50, 50, 50],
  }));
}

const TEST_LISTS = ['TestFruits', 'TestBerries'];

function rowOrder(page) {
  return page.evaluate(names =>
    [...document.querySelectorAll('#manage-dialog .wordlist-card .card-name')]
      .map(n => n.textContent).filter(n => names.includes(n)), TEST_LISTS);
}

function testListOrder(page) {
  return page.evaluate(names =>
    state.sources.map(s => s.name).filter(n => names.includes(n)), TEST_LISTS);
}

// Same gesture as tests/wordlist-reorder.spec.js's dragCardBefore, retargeted at
// the panel's rows: the +10px nudge clears makeReorderable's drag-start
// threshold, and releasing in the target's top quarter selects insert-before.
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

test('toggling off in the panel changes nothing until Apply', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await rowToggle(page, 'TestBerries').click();

  // Still enabled despite the visible toggle-off: the change is staged in the
  // shadow, not canonical, so this is the staging contract working — not a bug to
  // "fix" to false. That contract is the whole point of the panel.
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestBerries').enabled)).toBe(true);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).not.toBeNull();

  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestBerries').enabled)).toBe(false);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).toBeNull();
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('APPLE'))).not.toBeNull();
});

test('Cancel discards the staged change', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await rowToggle(page, 'TestBerries').click();
  await page.locator('#manage-dialog .manage-cancel-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestBerries').enabled)).toBe(true);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).not.toBeNull();
});

test('a dirty X prompts to discard; cancelling the confirm keeps the panel open', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await rowToggle(page, 'TestBerries').click();

  await page.locator('#manage-dialog .manage-close-btn').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();

  await page.locator('#confirm-dialog #btn-confirm-cancel').click();
  await expect(page.locator('#confirm-dialog')).toBeHidden();
  await expect(page.locator('#manage-dialog')).toBeVisible();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestBerries').enabled)).toBe(true);

  await page.locator('#manage-dialog .manage-close-btn').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-dialog #btn-confirm-ok').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestBerries').enabled)).toBe(true);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).not.toBeNull();
});

test('a clean X closes immediately, no confirm', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await page.locator('#manage-dialog .manage-close-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
  await expect(page.locator('#confirm-dialog')).toBeHidden();
});

test('reordering rows stages into the panel but leaves state.sources frozen until Apply', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  expect(await testListOrder(page)).toEqual(['TestFruits', 'TestBerries']);

  await openManagePanel(page);
  await dragRowBefore(page, 'TestBerries', 'TestFruits');

  await expect.poll(() => rowOrder(page)).toEqual(['TestBerries', 'TestFruits']);
  expect(await testListOrder(page)).toEqual(['TestFruits', 'TestBerries']);

  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  expect(await testListOrder(page)).toEqual(['TestBerries', 'TestFruits']);
});

test('Cancel discards a staged reorder', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await dragRowBefore(page, 'TestBerries', 'TestFruits');
  await expect.poll(() => rowOrder(page)).toEqual(['TestBerries', 'TestFruits']);

  await page.locator('#manage-dialog .manage-cancel-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  expect(await testListOrder(page)).toEqual(['TestFruits', 'TestBerries']);
});

test('a disabled row reorders just like an enabled one', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await rowToggle(page, 'TestBerries').click();
  await expect(page.locator('#manage-dialog .wordlist-card', { hasText: 'TestBerries' }).first())
    .toHaveClass(/disabled/);

  await dragRowBefore(page, 'TestBerries', 'TestFruits');
  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  expect(await testListOrder(page)).toEqual(['TestBerries', 'TestFruits']);
});

// ─── Stage 5c-iii: add-wordlist into the open panel ─────────────────────────
//
// Adding is a real import — the new source lands in canonical state.sources
// immediately, so it can't be staged like enable/reorder. The panel absorbs it
// into the shadow (shows it, joins the staged batch) but keeps it out of
// shadow.enabled, so the enabled reads fall back to the source's own live value.
// Population is async and force-enables on first data. Cancel keeps added lists.
async function addViaPanelDialog(page, { name, entries }) {
  await page.locator('#manage-dialog .manage-add-row').click();
  await expect(page.locator('#configure-wordlist-dialog')).toBeVisible();

  await page.locator('#config-name-input').fill(name);
  await page.locator('#cfg-file-input').setInputFiles({
    name: `${name}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(entries.map(e => `${e};50`).join('\n')),
  });
  await page.locator('#btn-cfg-save').click();
  await expect(page.locator('#configure-wordlist-dialog')).toBeHidden();

  await page.evaluate(() => window.__grawlixTest.loadIdle());
}

function panelRowNames(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#manage-dialog .wordlist-card .card-name')].map(n => n.textContent));
}

test('adding via the panel absorbs the list; Apply keeps it enabled and merged', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await addViaPanelDialog(page, { name: 'TestGrains', entries: ['WHEAT', 'BARLEY', 'OAT'] });

  await expect.poll(() => panelRowNames(page)).toContain('TestGrains');
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('WHEAT'))).not.toBeNull();

  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('TestGrains'));
  expect(wl).not.toBeNull();
  expect(wl.enabled).toBe(true);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BARLEY'))).not.toBeNull();
});

test('adding then Cancel keeps the added list (it was really imported)', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await addViaPanelDialog(page, { name: 'TestGrains', entries: ['WHEAT', 'BARLEY', 'OAT'] });
  await expect.poll(() => panelRowNames(page)).toContain('TestGrains');

  await page.locator('#manage-dialog .manage-cancel-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('TestGrains'));
  expect(wl).not.toBeNull();
  expect(wl.enabled).toBe(true);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OAT'))).not.toBeNull();
});

// The footgun guard. Without the `?? wl.enabled` fallback, an added source —
// absent from shadow.enabled — reads undefined and Apply disables the list it
// just force-enabled. Toggling an unrelated list makes isDirty() true so
// apply()'s enable loop actually runs; without it Apply would no-op and never
// touch the added list's enabled flag, hiding the bug.
test('Apply does not disable a just-added, populated list (enabled fallback)', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await addViaPanelDialog(page, { name: 'TestGrains', entries: ['WHEAT', 'BARLEY', 'OAT'] });
  await expect.poll(() => panelRowNames(page)).toContain('TestGrains');

  await rowToggle(page, 'TestFruits').click();

  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestGrains').enabled)).toBe(true);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('WHEAT'))).not.toBeNull();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestFruits').enabled)).toBe(false);
});

// Drives the absorb via the cacheVersion$ effect rather than onAdded: adding
// through the API (no dialog) reaches the panel only through the cache bump.
test('a source added while the panel is open is absorbed via the cacheVersion effect', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TestGrains', entries: ['WHEAT', 'BARLEY', 'OAT'], scores: [50, 50, 50],
  }));

  await expect.poll(() => panelRowNames(page)).toContain('TestGrains');

  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestGrains').enabled)).toBe(true);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OAT'))).not.toBeNull();
});
