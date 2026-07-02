// Provenance panel (unify redesign, Stage 3b). The atom panel's info section
// is a cross-wordlist provenance table: every wordlist's take on the clicked
// entry — including disabled and non-winning lists — since scoped views now
// show only their own data, leaving the panel the one place to compare lists.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo, setEnabledViaPanel } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Open the panel on a row by its visible entry text (the display string),
// clicking the entry cell. (In All Wordlists / My Edits the score cell opens the
// quick picker, not the panel; the entry cell opens the panel in any scope.)
// `data-entry` is the norm, which collides across spellings, so match the row by
// its rendered entry instead.
async function openPanelOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
}

// The provenance table as ordered [entry, score, comment, source] tuples,
// straight from the rendered cells in DOM (= priority) order. The source cell's
// raw text includes the wordlist icon's initials, so strip the icon span to get
// just the name.
async function readProvenance(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.entry-panel-prov tbody tr')].map(tr => {
      const src = tr.querySelector('.entry-panel-prov-source').cloneNode(true);
      src.querySelector('.wordlist-name-icon')?.remove();
      return {
        entry:   tr.querySelector('.entry-panel-prov-entry').textContent,
        score:   tr.querySelector('.entry-panel-prov-score').textContent,
        comment: tr.querySelector('.entry-panel-prov-comment').textContent,
        source:  src.textContent.trim(),
        disabled: tr.classList.contains('entry-panel-prov-row--disabled'),
      };
    })
  );
}

// The Related-entries display strings, in DOM order. Polls: the worker answers async.
async function readRelated(page) {
  await expect.poll(() => page.evaluate(() =>
    document.querySelectorAll('#entry-panel .entry-family-item').length
  )).toBeGreaterThan(0);
  return page.evaluate(() =>
    [...document.querySelectorAll('#entry-panel .entry-family-item .entry-family-entry')]
      .map(s => s.textContent));
}

test('a bare click is a wildcard: provenance lists every spelling of the norm', async ({ page }) => {
  await gotoApp(page);

  // W1 carries two spaced spellings of SEEINGASHOW; W2 carries the bare
  // lowercase form (display null). All three share the norm.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'W1', entries: ['seeing a show', 'seeing as how'], scores: [80, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'W2', entries: ['seeingashow'], scores: [60],
  }));

  // Scope to W2 and click its bare entry. A bare entry unifies with every spelling,
  // so provenance spans W1's two forms plus W2's own bare row; Related still offers
  // the concrete siblings to navigate to.
  await scopeTo(page, 'W2');
  await openPanelOnEntry(page, 'seeingashow');

  expect((await readProvenance(page)).map(r => ({ entry: r.entry, source: r.source })))
    .toEqual([
      { entry: 'seeing a show', source: 'W1' },
      { entry: 'seeing as how', source: 'W1' },
      { entry: 'seeingashow',   source: 'W2' },
    ]);
  // Order-independent: the worker's localeCompare may order differently per engine.
  expect((await readRelated(page)).sort())
    .toEqual(['seeing a show', 'seeing as how']);
});

test('clicking a specific spelling shows it plus a cross-source bare; siblings go to Related', async ({ page }) => {
  await gotoApp(page);

  // Await each add separately — addCustomWordlist is async, and two un-awaited in
  // one evaluate races scopeTo ahead of the data (a hard webkit timeout).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Rich',  entries: ['the IRS', 'Theirs'], scores: [90, 80] }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Plain', entries: ['theirs'],            scores: [70] }));

  await scopeTo(page, 'Rich');
  await openPanelOnEntry(page, 'the IRS');

  // 'the IRS' plus Plain's bare 'theirs' (a bare unifies with any spelling); the
  // 'Theirs' sibling moves to Related entries.
  expect((await readProvenance(page)).map(r => r.entry)).toEqual(['the IRS', 'theirs']);
  expect(await readRelated(page)).toEqual(['the IRS', 'Theirs']);
});

test('each concrete spelling scopes provenance to itself, but Related lists the whole norm', async ({ page }) => {
  await gotoApp(page);

  // Rich's mixed-case file makes even lowercase 'theirs' a concrete (off-convention)
  // display, so every one of these is a distinct spelling that scopes to itself.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Rich', entries: ['the IRS', 'Theirs', 'theirs'], scores: [90, 80, 70],
  }));

  await scopeTo(page, 'Rich');

  await openPanelOnEntry(page, 'the IRS');
  expect((await readProvenance(page)).map(r => r.entry)).toEqual(['the IRS']);
  expect((await readRelated(page)).sort()).toEqual(['Theirs', 'the IRS', 'theirs']);

  await page.keyboard.press('Escape');
  await openPanelOnEntry(page, 'theirs');
  expect((await readProvenance(page)).map(r => r.entry)).toEqual(['theirs']);
  expect((await readRelated(page)).sort()).toEqual(['Theirs', 'the IRS', 'theirs']);
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
  // panel still lists Off as a contributor — dimmed.
  await openPanelOnEntry(page, 'ocean');
  const rows = await readProvenance(page);
  expect(rows).toEqual([
    expect.objectContaining({ source: 'On',  disabled: false }),
    expect.objectContaining({ source: 'Off', disabled: true }),
  ]);
});

test('scoped to one source, the panel still lists other wordlists', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ocean'], scores: [90],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta',  entries: ['ocean'], scores: [60],
  }));

  // Scoped to Beta the table shows only Beta's data, yet the panel spans both.
  await scopeTo(page, 'Beta');
  await openPanelOnEntry(page, 'ocean');
  const rows = await readProvenance(page);
  expect(rows.map(r => r.source)).toEqual(['Alpha', 'Beta']);
});

test('a read-only foreign scope dims every row but the scoped one', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ocean'], scores: [90],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta',  entries: ['ocean'], scores: [60],
  }));

  // Scoped to Beta, every other row is muted so Beta's own row reads as the focus.
  await scopeTo(page, 'Beta');
  await openPanelOnEntry(page, 'ocean');
  const marks = await page.evaluate(() =>
    [...document.querySelectorAll('.entry-panel-prov tbody tr')].map(tr => {
      const src = tr.querySelector('.entry-panel-prov-source').cloneNode(true);
      src.querySelector('.wordlist-name-icon')?.remove();
      return { source: src.textContent.trim(), muted: tr.classList.contains('entry-panel-prov-row--muted') };
    }));
  expect(marks).toEqual([
    { source: 'Alpha', muted: true },
    { source: 'Beta',  muted: false },
  ]);
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

  await openPanelOnEntry(page, 'ocean');

  const rows = await readProvenance(page);
  expect(rows).toEqual([
    { entry: 'ocean', score: '90', comment: 'big',   source: 'Hi', disabled: false },
    { entry: 'ocean', score: '60', comment: 'small', source: 'Lo', disabled: false },
  ]);
});

test('an edit made through the panel still lands in My Edits', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));

  await openPanelOnEntry(page, 'bagel');
  await page.locator('#entry-panel-score').fill('77');
  await page.locator('#entry-panel-score').press('Enter');

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'bagel', display: null, score: 77, comment: '' }]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL')))
    .toMatchObject({ entry: 'bagel', score: 77, wordlist: 'My Edits' });
});
