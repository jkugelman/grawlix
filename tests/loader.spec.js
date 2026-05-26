const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function slowDownAnagrams(page, ms) {
  await page.evaluate((delayMs) => {
    TOOLS.anagrams.prepare = async (params) => {
      await new Promise(r => setTimeout(r, delayMs));
      return params.entry
        ? params.entry.toLowerCase().split('').sort().join('')
        : null;
    };
  }, ms);
}

test('adding a slow tool dims the entries panel via .pipeline-running', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Loader',
    entries: ['CAT', 'ACT', 'DOG'],
    scores: [50, 50, 50],
  }));

  await slowDownAnagrams(page, 250);

  await page.locator('.gallery-card[data-tool="anagrams"]').click();
  await page.locator('.tool-row input[data-key="entry"]').fill('CAT');

  await expect(page.locator('#entries-table-panel')).toHaveClass(/pipeline-running/, { timeout: 500 });

  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#entries-table-panel')).not.toHaveClass(/pipeline-running/);
});

test('a CPU-bound slow run still trips .pipeline-running (scheduler.yield doesnt starve the indicator)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'CpuBound',
    entries: ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'],
    scores: [50, 50, 50, 50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => {
    TOOLS.anagrams.run = () => {
      const end = performance.now() + 60;
      while (performance.now() < end) { /* burn CPU per row */ }
      return true;
    };
    window.__sawPipelineRunning = false;
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.attributeName === 'class' && m.target.id === 'entries-table-panel'
            && m.target.classList.contains('pipeline-running')) {
          window.__sawPipelineRunning = true;
        }
      }
    });
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });

  await page.locator('.gallery-card[data-tool="anagrams"]').click();

  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await page.evaluate(() => window.__sawPipelineRunning)).toBe(true);
  await expect(page.locator('#entries-table-panel')).not.toHaveClass(/pipeline-running/);
});

test('a slow run shows a spinner over the entries table in addition to the dim', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Loader',
    entries: ['CAT', 'ACT', 'DOG'],
    scores: [50, 50, 50],
  }));

  await slowDownAnagrams(page, 300);

  await page.locator('.gallery-card[data-tool="anagrams"]').click();
  await page.locator('.tool-row input[data-key="entry"]').fill('CAT');

  await expect(page.locator('#entries-table-panel .pipeline-spinner')).toBeVisible({ timeout: 500 });

  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#entries-table-panel .pipeline-spinner')).toBeHidden();
});
