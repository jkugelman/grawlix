// P5c — the edit panel's provenance table + preview footer resolve off the
// worker. previewWlEntry and gatherProvenance are corpus reads the worker answers
// instead (fetchProvenance → ownedMerged + ownedBuilt). The rendered table +
// footer fill from the worker's reply, at open and after typing into the entry
// field (async, so assert after a settle). The merged-view seed comes from the
// clicked row (no fetchEditSeed), so the panel does no corpus read for the seed.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo, setEnabledViaPanel } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// On (enabled) + Off (disabled) both carry OCEAN, so provenance lists a disabled
// row. Rich carries spelled variants + a bare form of THEIRS (the bare-display
// quirk). All custom (no publisher), so the merge is just these three.
async function seedCorpus(page) {
  await page.evaluate(() => {
    window.__grawlixTest.addCustomWordlist({ name: 'On',  entries: ['ocean'], scores: [90], comments: ['big'] });
    window.__grawlixTest.addCustomWordlist({ name: 'Off', entries: ['ocean'], scores: [50], comments: ['off'] });
    window.__grawlixTest.addCustomWordlist({
      name: 'Rich', entries: ['the IRS', 'Theirs', 'theirs'], scores: [90, 80, 70],
    });
  });
  await setEnabledViaPanel(page, 'Off', false);
}

async function openPanelOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
}

async function closePanel(page) {
  await page.keyboard.press('Escape');   // an explicit close: discards any edit silently
  await expect(page.locator('#entry-panel')).toBeHidden();
}

// The provenance table HTML + the footer + the seed fields — captured as
// innerHTML so byte-identity is exact.
function captureSurfaces(page) {
  return page.evaluate(() => ({
    prov: document.querySelector('#entry-panel .entry-panel-prov-wrap')?.innerHTML ?? '',
    foot: document.querySelector('#entry-panel .entry-panel-foot')?.innerHTML ?? '',
    seed: {
      entry: document.querySelector('#entry-panel-entry')?.value,
      score: document.querySelector('#entry-panel-score')?.value,
      comment: document.querySelector('#entry-panel-comment')?.value,
    },
  }));
}

const provDebug = page => page.evaluate(() => window.__grawlixTest.entryPanelProvenanceDebug());
const seedDebug = page => page.evaluate(() => window.__grawlixTest.entryPanelSeedDebug());

async function syncWorker(page) {
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

test('provenance table + preview footer come from the worker (incl. a disabled row)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // All Wordlists: OCEAN spans On (enabled) + Off (disabled).
  await syncWorker(page);
  const before = await provDebug(page);

  await openPanelOnEntry(page, 'ocean');
  // The table/footer fill a beat after open (async). Poll to the worker's reply.
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('#entry-panel .entry-panel-prov-row')?.outerHTML ?? ''
  )).not.toBe('');
  const surfaces = await captureSurfaces(page);
  // The disabled Off source contributes a dimmed row — non-vacuity for the fixture.
  expect(surfaces.prov).toContain('entry-panel-prov-row--disabled');
  expect(surfaces.foot).not.toBe('');

  // Non-vacuous: the worker actually answered the provenance query.
  const after = await provDebug(page);
  expect(after.provQueriesFired).toBeGreaterThan(before.provQueriesFired);
  expect(after.provRepliesApplied).toBeGreaterThan(before.provRepliesApplied);
  await closePanel(page);
});

test('typing into the entry field repaints provenance + preview off the worker', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // Open on OCEAN; the worker answers each keystroke (no debounce).
  await syncWorker(page);
  await openPanelOnEntry(page, 'ocean');
  const before = await provDebug(page);
  await page.locator('#entry-panel-entry').fill('theirs');
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('#entry-panel .entry-panel-prov-entry')?.textContent ?? ''
  )).not.toBe('');
  const provTable = await page.evaluate(() =>
    document.querySelector('#entry-panel .entry-panel-prov')?.innerHTML ?? '');
  expect(provTable).toContain('Theirs');
  expect(provTable).toContain('entry-panel-prov-row--added');

  // The worker answered the retype, not just the open.
  const after = await provDebug(page);
  expect(after.provQueriesFired).toBeGreaterThan(before.provQueriesFired);
  await closePanel(page);
});

test('merged-view seed comes from the clicked row: no fetchEditSeed, provenance still from the worker', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // Merged seed = the clicked row (no fetchEditSeed query); provenance from the
  // worker — so the panel does no buildMergedWordlist read on either path.
  await syncWorker(page);
  const seedBefore = await seedDebug(page);
  const provBefore = await provDebug(page);

  await openPanelOnEntry(page, 'ocean');
  await expect(page.locator('#entry-panel-score')).toHaveValue('90');
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('#entry-panel .entry-panel-prov-row')?.outerHTML ?? ''
  )).not.toBe('');
  const surfaces = await captureSurfaces(page);
  // On (enabled) wins the merge for OCEAN at 90/big.
  expect(surfaces.seed).toEqual({ entry: 'ocean', score: '90', comment: 'big' });

  // The merged seed fired NO fetchEditSeed (clicked IS the winner), yet provenance
  // WAS answered by the worker — the panel is corpus-free on both reads.
  const seedAfter = await seedDebug(page);
  const provAfter = await provDebug(page);
  expect(seedAfter.seedQueriesFired).toBe(seedBefore.seedQueriesFired);
  expect(provAfter.provRepliesApplied).toBeGreaterThan(provBefore.provRepliesApplied);
  await closePanel(page);
});
