// On narrow viewports the Library rail collapses into a dropdown opened by the
// title-bar trigger (paneTitleHTML / LibraryView.togglePicker). These pin the
// open → select → close cycle and that the desktop rail is left untouched.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await page.addInitScript(() => localStorage.setItem('grawlix_onboarded', '1'));
});

test('narrow viewport: the title trigger opens the dropdown and a pick closes it', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Zebra', entries: ['ZEBRA'], scores: [50],
  }));
  await openLibrary(page);                       // header nav isn't collapsed at the default width
  await page.setViewportSize({ width: 400, height: 800 });

  const rail = page.locator('.wld-list');
  const trigger = page.locator('.wld-pane-title');

  await expect(rail).toBeHidden();
  await trigger.click();
  await expect(rail).toBeVisible();

  await page.locator('.wld-list .wordlist-card[data-wordlist]', { hasText: 'Zebra' }).first().click();
  await expect(rail).toBeHidden();
  await expect(trigger).toContainText('Zebra');
});

test('wide viewport: the rail stays visible and the title trigger is inert', async ({ page }) => {
  await gotoApp(page);
  await openLibrary(page);

  const rail = page.locator('.wld-list');
  await expect(rail).toBeVisible();
  await page.locator('.wld-pane-title').click();
  await expect(rail).toBeVisible();
});
