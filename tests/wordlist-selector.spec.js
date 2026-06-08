// Workshop wordlist selector (Stage 2a of the unify redesign). Drives the real
// dropdown UI — not the setScope test API — to prove the control lists All plus
// each source as icon+label rows, that clicking one scopes the table, and that a
// disabled source renders grayed-out yet stays selectable (scope ≠ merge).

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeViaSelector, expectVisible } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function openMenu(page) {
  await page.locator('#workshop-wordlist-bar .wls-trigger').click();
  await expect(page.locator('#workshop-wordlist-bar .wls')).toHaveClass(/open/);
}

function optionLabels(page) {
  return page.locator('#workshop-wordlist-bar .wls-option .wls-option-label').allTextContents();
}

test('the dropdown lists All plus each added source as icon+label rows', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ocean'], scores: [70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta', entries: ['tide'], scores: [40],
  }));

  await expect(page.locator('#workshop-wordlist-bar .wls-trigger-label')).toHaveText('All');

  await openMenu(page);
  // My Edits and the four unpopulated publishers also appear, so assert the
  // meaningful subset rather than an exact list: All first, then sources in order.
  const labels = await optionLabels(page);
  expect(labels[0]).toBe('All');
  expect(labels).toContain('Alpha');
  expect(labels).toContain('Beta');
  expect(labels.indexOf('Alpha')).toBeLessThan(labels.indexOf('Beta'));

  // Icon + label only — every option has an icon, none has a checkbox/toggle.
  const optionCount = await page.locator('#workshop-wordlist-bar .wls-option').count();
  const iconCount = await page.locator('#workshop-wordlist-bar .wls-option .wordlist-icon').count();
  expect(iconCount).toBe(optionCount);
  expect(await page.locator('#workshop-wordlist-bar .wls-option input[type="checkbox"]').count()).toBe(0);
});

test('clicking a source scopes the table to it; clicking All restores the merge', async ({ page }) => {
  await gotoApp(page);
  // Two sources sharing OCEAN; Hi (added first) wins the All merge and carries
  // ZEBRA, which Lo lacks.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean', 'zebra'], scores: [90, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  await expectVisible(page, ['ocean', 'tide', 'zebra']);

  await scopeViaSelector(page, 'Lo');
  await expect(page.locator('#workshop-wordlist-bar .wls-trigger-label')).toHaveText('Lo');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 70, wordlist: 'Lo' });

  await scopeViaSelector(page, 'All');
  await expect(page.locator('#workshop-wordlist-bar .wls-trigger-label')).toHaveText('All');
  await expectVisible(page, ['ocean', 'tide', 'zebra']);
});

test('a disabled source renders grayed-out but is still selectable', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Off', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  // Importing data force-enables a list, so disable through the real Library
  // toggle after population (mirrors scope.spec.js / merge.spec.js).
  await page.locator('.header-nav-item[data-view="library"]').click();
  await page.getByLabel('Toggle Off').uncheck();
  await page.locator('.header-nav-item[data-view="workshop"]').click();

  await openMenu(page);
  const offOption = page.locator('#workshop-wordlist-bar .wls-option', { hasText: 'Off' });
  // Grayed-out is asserted via the modifier class, never a computed color
  // (project rule: no toHaveCSS assertions).
  await expect(offOption).toHaveClass(/wls-option--disabled/);

  // Disabled does not mean unclickable — scope to it and the table shows it.
  await offOption.click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#workshop-wordlist-bar .wls-trigger-label')).toHaveText('Off');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 70, wordlist: 'Off' });
});
