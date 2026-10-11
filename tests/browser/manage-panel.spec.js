// Manage wordlists panel (Stage 5c-i of the unify redesign). The panel stages
// enable/disable changes on a shadow copy and only commits to canonical state on
// Apply — one merge rebuild behind the modal. These tests pin that staging
// contract: nothing canonical moves until Apply, Cancel discards, and a dirty X
// guards with a confirm.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, openManagePanel, scopeTo } from './helpers.js';

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

test('Save is disabled until something is staged, and re-disables on revert', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  const saveBtn = page.locator('#manage-dialog .manage-apply-btn');
  await expect(saveBtn).toBeDisabled();          // nothing staged on open

  await rowToggle(page, 'TestBerries').click();
  await expect(saveBtn).toBeEnabled();

  await rowToggle(page, 'TestBerries').click();   // back to the canonical state
  await expect(saveBtn).toBeDisabled();
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

  await page.locator('#manage-dialog .dialog-close-btn').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();

  await page.locator('#confirm-dialog #btn-confirm-cancel').click();
  await expect(page.locator('#confirm-dialog')).toBeHidden();
  await expect(page.locator('#manage-dialog')).toBeVisible();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestBerries').enabled)).toBe(true);

  await page.locator('#manage-dialog .dialog-close-btn').click();
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
  await page.locator('#manage-dialog .dialog-close-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
  await expect(page.locator('#confirm-dialog')).toBeHidden();
});

async function clickBackdrop(page) {
  await page.mouse.click(5, 5);
}

test('a clean backdrop click closes immediately, no confirm', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await clickBackdrop(page);
  await expect(page.locator('#manage-dialog')).toBeHidden();
  await expect(page.locator('#confirm-dialog')).toBeHidden();
});

test('a press inside that ends on the backdrop does not close the panel', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  const box = await page.locator('#manage-dialog h2').boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#manage-dialog')).toBeVisible();
});

test('a dirty backdrop click prompts to discard; cancelling keeps the panel and its staging', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await rowToggle(page, 'TestBerries').click();
  await clickBackdrop(page);
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-dialog #btn-confirm-cancel').click();
  await expect(page.locator('#manage-dialog')).toBeVisible();
  await expect(page.locator('#manage-dialog .manage-apply-btn')).toBeEnabled();

  await clickBackdrop(page);
  await page.locator('#confirm-dialog #btn-confirm-ok').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestBerries').enabled)).toBe(true);
});

test('a dirty Escape prompts to discard', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await rowToggle(page, 'TestBerries').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-dialog #btn-confirm-cancel').click();
  await expect(page.locator('#manage-dialog')).toBeVisible();
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
  const dialog = page.locator('#add-wordlist-dialog');
  await expect(dialog).toBeVisible();

  await dialog.locator('.config-name-input').fill(name);
  await dialog.locator('.cfg-file-input').setInputFiles({
    name: `${name}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(entries.map(e => `${e};50`).join('\n')),
  });
  await dialog.locator('.add-wordlist-btn').click();
  await expect(dialog).toBeHidden();

  await page.evaluate(() => window.__grawlixTest.loadIdle());
}

function panelRowNames(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#manage-dialog .manage-list .wordlist-card .card-name')].map(n => n.textContent));
}

test('adding via the panel commits immediately; the list stays after closing', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await addViaPanelDialog(page, { name: 'TestGrains', entries: ['WHEAT', 'BARLEY', 'OAT'] });

  await expect.poll(() => panelRowNames(page)).toContain('TestGrains');
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('WHEAT'))).not.toBeNull();

  // The add already committed to canonical, so the shadow matches it — nothing to save.
  await expect(page.locator('#manage-dialog .manage-apply-btn')).toBeDisabled();
  await page.locator('#manage-dialog .dialog-close-btn').click();
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

  await page.locator('#manage-dialog .dialog-close-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestGrains').enabled)).toBe(true);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OAT'))).not.toBeNull();
});

// ─── Each list's page ───────────────────────────────────────────────────────
//
// Clicking a row slides over to its page: a source's details and rescore rules,
// My Edits' rules, or All Wordlists' tiers and trash score. All of it stages
// into the one Save except Delete (the footer's bottom-left link), which
// commits at once like an add.
const detail = page => page.locator('#manage-dialog .manage-detail');
const home   = page => page.locator('#manage-dialog .manage-home');
const title  = page => page.locator('#manage-dialog-title .manage-title');

function rowCard(page, name) {
  return home(page).locator('.wordlist-card', { hasText: name }).first();
}

async function openRowPage(page, name) {
  await rowCard(page, name).locator('.card-name').click();
  await expect(title(page)).toContainText(name);
  await expect(detail(page)).toBeInViewport();
}

async function back(page) {
  await page.locator('#manage-dialog .dialog-back-btn').click();
  await expect(title(page)).toHaveText('Manage wordlists');
}

async function deleteViaPage(page, name) {
  await openRowPage(page, name);
  await page.locator('#manage-dialog .manage-delete-btn').click();
}

async function editFirstTierNote(page, note) {
  await detail(page).locator('#scoring-rules .rule-row').first().locator('.rule-note-wrap').click();
  await detail(page).locator('.rule-note-input').fill(note);
  await detail(page).locator('.rule-note-input').press('Enter');
}

async function save(page) {
  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
}

test('clicking a row slides to its page, and Back returns to the list', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);
  await openManagePanel(page);
  await expect(page.locator('#manage-dialog .dialog-back-btn')).toBeHidden();

  await openRowPage(page, 'TestFruits');
  await expect(detail(page).locator('.config-name-input')).toHaveValue('TestFruits');
  await expect(detail(page).locator('#rescore-rules')).toBeVisible();
  await expect(detail(page).locator('.rules-select')).toBeHidden();
  await expect(page.locator('#manage-dialog .manage-delete-btn')).toBeVisible();
  await back(page);
  await expect(page.locator('#manage-dialog .manage-delete-btn')).toBeHidden();

  await openRowPage(page, 'My Edits');
  await expect(detail(page).locator('.config-name-input')).toHaveCount(0);
  await expect(detail(page).locator('#rescore-rules')).toBeVisible();
  await expect(page.locator('#manage-dialog .manage-delete-btn')).toBeHidden();
  await back(page);

  await openRowPage(page, 'All Wordlists');
  await expect(detail(page).locator('#scoring-rules .rule-row').first()).toBeVisible();
  await expect(detail(page).locator('.trash-score-input')).toBeVisible();
});

test('clicking a row\'s toggle stages it without opening the page', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);
  await openManagePanel(page);
  await rowToggle(page, 'TestFruits').click();
  await expect(title(page)).toHaveText('Manage wordlists');
});

test('a rename stages until Save, badging the row and naming it in the footer', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);
  await openManagePanel(page);

  await openRowPage(page, 'TestFruits');
  await detail(page).locator('.config-name-input').fill('TestOrchard');
  await expect(title(page)).toContainText('TestOrchard');
  await expect(page.locator('#manage-dialog .manage-status')).toHaveText('Unsaved changes: TestOrchard');
  await back(page);
  await expect(rowCard(page, 'TestOrchard').locator('.badge[data-severity="pending"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestOrchard'))).toBeNull();

  await save(page);
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestOrchard'))).not.toBeNull();
});

test('Save with a blank name opens that list\'s page instead', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);
  await openManagePanel(page);

  await openRowPage(page, 'TestFruits');
  await detail(page).locator('.config-name-input').fill('');
  await back(page);
  await page.locator('#manage-dialog .manage-apply-btn').click();

  await expect(page.locator('#manage-dialog')).toBeVisible();
  await expect(detail(page).locator('.config-name-input')).toHaveClass(/invalid/);
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestFruits'))).not.toBeNull();
});

test('a staged rename: X prompts, Cancel discards without a prompt', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await openRowPage(page, 'TestFruits');
  await detail(page).locator('.config-name-input').fill('TestOrchard');
  await page.locator('#manage-dialog .dialog-close-btn').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-dialog #btn-confirm-cancel').click();
  await expect(detail(page).locator('.config-name-input')).toHaveValue('TestOrchard');

  await page.locator('#manage-dialog .manage-cancel-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
  await expect(page.locator('#confirm-dialog')).toBeHidden();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestOrchard'))).toBeNull();
});

test('Escape with the icon picker open closes only the picker', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await openRowPage(page, 'TestFruits');
  await detail(page).locator('.config-name-input').fill('TestOrchard');
  await detail(page).locator('.icon-picker-trigger').click();
  const picker = detail(page).locator('.icon-picker-popup');
  await expect(picker).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(page.locator('#confirm-dialog')).toBeHidden();
  await expect(page.locator('#manage-dialog')).toBeVisible();
});

test("picking a publisher offers its rules through the editor's reset link, and Save commits both", async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await openRowPage(page, 'TestFruits');
  await detail(page).locator('.publisher-chip', { hasText: 'Nediger' }).click();
  const reset = detail(page).locator('.rule-reset-btn');
  await expect(reset).toHaveText("Use Will Nediger's rules");
  await detail(page).locator('.rescore-kebab .more-menu-btn').click();
  await reset.click();
  await page.locator('#confirm-dialog #btn-confirm-ok').click();
  const ruleCount = await detail(page).locator('#rescore-rules .rule-row').count();
  expect(ruleCount).toBeGreaterThan(0);
  await expect(reset).toHaveCount(0);

  await save(page);
  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('TestFruits'));
  expect(wl.publisherId).toBe('nediger');
  expect(wl.rescoreRules.length).toBe(ruleCount);
});

test('rules and tiers edited on different pages commit in one Save', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await openRowPage(page, 'All Wordlists');
  await editFirstTierNote(page, 'Gold');
  await back(page);
  await openRowPage(page, 'TestFruits');
  await detail(page).locator('#rescore-rules .rule-add-btn').click();
  const row = detail(page).locator('#rescore-rules .rule-row').last();
  await row.locator('.rule-query').fill('score: 50');
  await row.locator('.rule-out').fill('40');
  await row.locator('.rule-out').blur();
  await expect(page.locator('#manage-dialog .manage-status')).toHaveText('Unsaved changes: All Wordlists, TestFruits');

  await save(page);
  expect(await page.evaluate(() => state.scoring[0].note)).toBe('Gold');
  expect((await page.evaluate(() => window.__grawlixTest.getWordlist('TestFruits'))).rescoreRules)
    .toContainEqual({ query: 'score: 50', output: '40' });
});

test('a tier change leaves an untouched My Edits clean and following the tiers', async ({ page }) => {
  await gotoApp(page);
  await openManagePanel(page);
  await openRowPage(page, 'All Wordlists');
  await editFirstTierNote(page, 'Gold');
  await save(page);

  const edits = await page.evaluate(() => {
    const wl = state.sources.find(w => w.type === 'edits');
    return { dirty: !!wl.dirty, note: wl.rescoreRules[0].note };
  });
  expect(edits).toEqual({ dirty: false, note: 'Gold' });
});

test('the trash score is staged on the All Wordlists page', async ({ page }) => {
  await gotoApp(page);
  await openManagePanel(page);
  await openRowPage(page, 'All Wordlists');
  await detail(page).locator('.trash-score-input').fill('7');
  await detail(page).locator('.trash-score-input').blur();
  await expect(page.locator('#manage-dialog .manage-status')).toHaveText('Unsaved changes: All Wordlists');
  expect(await page.evaluate(() => Storage.readMergedSettings().trashScore)).not.toBe(7);

  await save(page);
  expect(await page.evaluate(() => Storage.readMergedSettings().trashScore)).toBe(7);
});

test("the bar's ⋮ › Rescoring rules… opens Manage on that list's page", async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);
  await scopeTo(page, 'TestBerries');
  await page.locator('#wordlist-bar .wls-kebab .more-menu-btn').click();
  await page.locator('#wordlist-bar .wls-kebab .split-btn-menu button', { hasText: 'Rescoring rules…' }).click();
  await expect(title(page)).toContainText('TestBerries');
  await expect(detail(page).locator('#rescore-rules')).toBeVisible();
  await back(page);
  await expect(rowCard(page, 'TestBerries')).toBeVisible();
});

test('Make permanent is blocked while anything is staged', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);
  await openManagePanel(page);
  await openRowPage(page, 'TestFruits');
  await detail(page).locator('#rescore-rules .rule-add-btn').click();
  await expect(detail(page).locator('.rescore-menu .rule-bake-btn')).toBeDisabled();
  await expect(detail(page).locator('.rescore-menu .rule-bake-btn')).toHaveAttribute('title', 'Save first');
});

test('Delete removes the list, returns to the list, and falls back to All Wordlists when it was scoped', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);
  await scopeTo(page, 'TestBerries');

  await openManagePanel(page);
  await deleteViaPage(page, 'TestBerries');
  await page.locator('#confirm-dialog #btn-confirm-ok').click();

  await expect.poll(() => panelRowNames(page)).not.toContain('TestBerries');
  await expect(title(page)).toHaveText('Manage wordlists');
  await expect(page.locator('#manage-dialog .manage-apply-btn')).toBeDisabled();
  expect(await page.evaluate(() => state.sources.some(w => w.name === 'TestBerries'))).toBe(false);
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
});

test('cancelling the delete confirm keeps the list', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await deleteViaPage(page, 'TestBerries');
  await page.locator('#confirm-dialog #btn-confirm-cancel').click();

  await expect(title(page)).toContainText('TestBerries');
  expect(await panelRowNames(page)).toContain('TestBerries');
  expect(await page.evaluate(() => state.sources.some(w => w.name === 'TestBerries'))).toBe(true);
});

test('a staged toggle survives deleting another row and still commits on Save', async ({ page }) => {
  await gotoApp(page);
  await addTwoLists(page);

  await openManagePanel(page);
  await rowToggle(page, 'TestFruits').click();
  await deleteViaPage(page, 'TestBerries');
  await page.locator('#confirm-dialog #btn-confirm-ok').click();
  await expect.poll(() => panelRowNames(page)).not.toContain('TestBerries');

  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestFruits').enabled)).toBe(true);
  await save(page);
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('TestFruits').enabled)).toBe(false);
});
