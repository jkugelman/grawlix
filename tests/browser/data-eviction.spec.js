import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, reloadApp } from './helpers.js';

// localStorage (meta) and IndexedDB (wordlist text) evict independently, so a
// browser reclaiming best-effort storage can drop the IDB text and leave the
// meta — with its `populated`/`lastUpdated` — intact. Boot must then re-fetch
// off the missing IDB record, not trust that stale flag, or a URL-backed list
// strands on "No data" for good.

const JK = 'alpha;50\nbeta;60\n';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page, { jkugelman: JK });
});

async function evictWordlistData(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('grawlix', 1);
    open.onsuccess = () => {
      const tx = open.result.transaction('data', 'readwrite');
      const store = tx.objectStore('data');
      store.getAllKeys().onsuccess = e => {
        for (const k of e.target.result) if (String(k).startsWith('data_')) store.delete(k);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }));
}

const jkEntries = page =>
  page.evaluate(() => window.__grawlixTest.dumpSourceEntries('John Kugelman'))
    .then(rows => rows.map(r => r.entry).sort());

test('a URL list whose IDB data was evicted re-fetches on next boot', async ({ page }) => {
  await gotoApp(page);
  expect(await jkEntries(page)).toEqual(['alpha', 'beta']);

  await evictWordlistData(page);
  // Prove the data really is gone, so the reload's re-fetch — not surviving
  // IDB — is what repopulates. Meta still says populated with a lastUpdated.
  expect(await jkEntries(page)).toEqual([]);

  await reloadApp(page);

  await expect.poll(() => jkEntries(page)).toEqual(['alpha', 'beta']);
});
