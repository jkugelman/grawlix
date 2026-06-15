// Provenance panel (unify redesign, Stage 3b). The atom popover's info section
// is a cross-wordlist provenance table: every wordlist's take on the clicked
// entry — including disabled and non-winning lists — since scoped views now
// show only their own data, leaving the popover the one place to compare lists.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo, setEnabledViaPanel } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Open the popover on a row by its visible entry text (the display string),
// clicking the entry cell. (In All Wordlists / My Edits the score cell opens the
// quick picker, not the popover; the entry cell opens the popover in any scope.)
// `data-entry` is the norm, which collides across spellings, so match the row by
// its rendered entry instead.
async function openPopoverOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
}

// The provenance table as ordered [entry, score, comment, source] tuples,
// straight from the rendered cells in DOM (= priority) order. The source cell's
// raw text includes the wordlist icon's initials, so strip the icon span to get
// just the name.
async function readProvenance(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.atom-pop-prov tbody tr')].map(tr => {
      const src = tr.querySelector('.atom-pop-prov-source').cloneNode(true);
      src.querySelector('.wordlist-name-icon')?.remove();
      return {
        entry:   tr.querySelector('.atom-pop-prov-entry').textContent,
        score:   tr.querySelector('.atom-pop-prov-score').textContent,
        comment: tr.querySelector('.atom-pop-prov-comment').textContent,
        source:  src.textContent.trim(),
        disabled: tr.classList.contains('atom-pop-prov-row--disabled'),
      };
    })
  );
}

test('clicking a bare entry shows every spelling of the norm across all wordlists', async ({ page }) => {
  await gotoApp(page);

  // W1 carries two spaced spellings of SEEINGASHOW; W2 carries the bare
  // lowercase form (display null). All three share the norm.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'W1', entries: ['seeing a show', 'seeing as how'], scores: [80, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'W2', entries: ['seeingashow'], scores: [60],
  }));

  // Scope to W2 and click its bare entry — a bare click pulls in the whole norm.
  await scopeTo(page, 'W2');
  await openPopoverOnEntry(page, 'seeingashow');

  const rows = await readProvenance(page);
  expect(rows.map(r => ({ entry: r.entry, source: r.source }))).toEqual([
    { entry: 'seeing a show', source: 'W1' },
    { entry: 'seeing as how', source: 'W1' },
    { entry: 'seeingashow',   source: 'W2' },
  ]);
});

test('clicking a specific spelling shows that spelling plus a cross-source bare, not sibling spellings', async ({ page }) => {
  await gotoApp(page);

  // Rich spells the norm two ways; Plain (lower priority) carries only the bare
  // letter-run. A bare entry from a different list is still an ancestor of every
  // spelling, so 'the IRS' pulls in Plain's bare — but never the sibling 'Theirs'.
  // Await each add separately — addCustomWordlist is async, and two un-awaited in
  // one evaluate races scopeTo ahead of the data (a hard webkit timeout).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Rich',  entries: ['the IRS', 'Theirs'], scores: [90, 80] }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Plain', entries: ['theirs'],            scores: [70] }));

  await scopeTo(page, 'Rich');
  await openPopoverOnEntry(page, 'the IRS');

  const rows = await readProvenance(page);
  expect(rows.map(r => r.entry)).toEqual(['the IRS', 'theirs']);
});

test('a same-source bare sibling is its own row, not an ancestor of the spellings', async ({ page }) => {
  await gotoApp(page);

  // One list spells the norm three ways including the bare form, so the bare entry
  // is concretized to its own 'theirs' row instead of leaking onto every spelling.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Rich', entries: ['the IRS', 'Theirs', 'theirs'], scores: [90, 80, 70],
  }));

  await scopeTo(page, 'Rich');

  await openPopoverOnEntry(page, 'the IRS');
  expect((await readProvenance(page)).map(r => r.entry)).toEqual(['the IRS']);

  await page.keyboard.press('Escape');
  await openPopoverOnEntry(page, 'theirs');
  expect((await readProvenance(page)).map(r => r.entry)).toEqual(['theirs']);
});

test('a disabled wordlist still contributes a (dimmed) provenance row', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'On',  entries: ['ocean'], scores: [70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Off', entries: ['ocean'], scores: [50],
  }));
  await setEnabledViaPanel(page, 'Off', false);

  // From All Wordlists, OCEAN comes only from On (Off is excluded from the merge), but the
  // popover still lists Off as a contributor — dimmed.
  await openPopoverOnEntry(page, 'ocean');
  const rows = await readProvenance(page);
  expect(rows).toEqual([
    expect.objectContaining({ source: 'On',  disabled: false }),
    expect.objectContaining({ source: 'Off', disabled: true }),
  ]);
});

test('scoped to one source, the popover still lists other wordlists', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ocean'], scores: [90],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta',  entries: ['ocean'], scores: [60],
  }));

  // Scoped to Beta the table shows only Beta's data, yet the popover spans both.
  await scopeTo(page, 'Beta');
  await openPopoverOnEntry(page, 'ocean');
  const rows = await readProvenance(page);
  expect(rows.map(r => r.source)).toEqual(['Alpha', 'Beta']);
});

test('the table columns are Entry · Score · Comment · Source in that order, rows in priority order', async ({ page }) => {
  await gotoApp(page);

  // Hi added first = higher priority; both carry OCEAN with distinct
  // scores/comments so the cells are individually checkable.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean'], scores: [90], comments: ['big'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean'], scores: [60], comments: ['small'],
  }));

  await openPopoverOnEntry(page, 'ocean');

  const rows = await readProvenance(page);
  expect(rows).toEqual([
    { entry: 'ocean', score: '90', comment: 'big',   source: 'Hi', disabled: false },
    { entry: 'ocean', score: '60', comment: 'small', source: 'Lo', disabled: false },
  ]);
});

test('an edit made through the popover still lands in My Edits', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));

  await openPopoverOnEntry(page, 'bagel');
  await page.locator('#atom-pop-score').fill('77');
  await page.locator('#atom-pop-score').press('Enter');

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'bagel', display: 'bagel', score: 77, comment: '' }]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL')))
    .toMatchObject({ entry: 'bagel', score: 77, wordlist: 'My Edits' });
});
