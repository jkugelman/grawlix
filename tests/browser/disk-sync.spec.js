// The File System Access API can't be driven headless, so these tests install an
// in-memory fake for the file pickers and run the app's real attach/reconcile
// code against it. See site/index.html § Disk sync and docs/design.md § Disk sync.

const { test, expect } = require('@playwright/test');
const { gotoApp, stubPublisherFetches, scopeTo } = require('./helpers');

async function installFakeFS(page) {
  await page.addInitScript(() => {
    window.__fakeFS = { files: new Map(), nextName: null, granted: true };
    class FakeFileHandle {
      constructor(name) { this.name = name; }
      async queryPermission()   { return window.__fakeFS.granted ? 'granted' : 'prompt'; }
      async requestPermission() { return window.__fakeFS.granted ? 'granted' : 'denied'; }
      async getFile() {
        const f = window.__fakeFS.files.get(this.name);
        if (!f) { const e = new Error('gone'); e.name = 'NotFoundError'; throw e; }
        return { text: async () => f.content, lastModified: f.mtime };
      }
      async createWritable() {
        const name = this.name; let buf = '';
        return {
          write: async t => { buf = t; },
          close: async () => {
            const prev = window.__fakeFS.files.get(name);
            window.__fakeFS.files.set(name, { content: buf, mtime: (prev?.mtime ?? 0) + 1 });
          },
        };
      }
    }
    window.showSaveFilePicker = async ({ suggestedName } = {}) => {
      const name = window.__fakeFS.nextName ?? suggestedName ?? 'file.txt';
      if (!window.__fakeFS.files.has(name)) window.__fakeFS.files.set(name, { content: '', mtime: 1 });
      return new FakeFileHandle(name);
    };
    window.showOpenFilePicker = async () => [new FakeFileHandle(window.__fakeFS.nextName ?? 'file.txt')];
  });
}

const readFile = (page, name) =>
  page.evaluate(n => window.__fakeFS.files.get(n)?.content ?? null, name);
const writeFile = (page, name, content) =>
  page.evaluate(([n, c]) => {
    const prev = window.__fakeFS.files.get(n);
    window.__fakeFS.files.set(n, { content: c, mtime: (prev?.mtime ?? 0) + 10 });
  }, [name, content]);
const setNextName = (page, name) => page.evaluate(n => { window.__fakeFS.nextName = n; }, name);

// Raw IDB access against the live DB (cf. worker-edit-persist.spec.js): the oracle
// must seed and inspect records below the disk-sync API, at the bare IDB key level.
const idbPutRaw = (page, key, val) => page.evaluate(([k, v]) => new Promise(resolve => {
  const tx = window._db.transaction('data', 'readwrite');
  tx.objectStore('data').put(v, k);
  tx.oncomplete = resolve;
}), [key, val]);
const idbGetRaw = (page, key) => page.evaluate(k => new Promise(resolve => {
  const req = window._db.transaction('data', 'readonly').objectStore('data').get(k);
  req.onsuccess = () => resolve(req.result ?? null);
  req.onerror = () => resolve(null);
}), key);

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await installFakeFS(page);
});

test('a synced source mirrors its rescored output and rewrites on rule change', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', scores: [50, 50], entries: ['ALPHA', 'BETA'],
  }));

  await setNextName(page, 'Src.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachMirror('Src'));

  expect(await readFile(page, 'Src.txt')).toBe('ALPHA;50\nBETA;50\n');

  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Src', [{ input: '50', length: '', output: '80' }]));
  await page.evaluate(() => window.__grawlixTest.sync.flushWrites());

  expect(await readFile(page, 'Src.txt')).toBe('ALPHA;80\nBETA;80\n');
});

test('attaching a mirror to an existing file overwrites it with the rescored output', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Src', scores: [50], entries: ['ALPHA'] }));

  await writeFile(page, 'Src.txt', 'JUNK;1\n');
  await setNextName(page, 'Src.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachMirror('Src', { existing: true }));

  expect(await readFile(page, 'Src.txt')).toBe('ALPHA;50\n');
});

test('attaching My Edits to an existing file merges its entries in', async ({ page }) => {
  await gotoApp(page);
  await writeFile(page, 'mine.txt', 'FOO;10\n');
  await setNextName(page, 'mine.txt');

  await page.evaluate(() => window.__grawlixTest.sync.attachEditsExisting());

  const entries = await page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.map(e => e.entry));
  expect(entries).toEqual(['foo']);
  expect(await readFile(page, 'mine.txt')).toBe('FOO;10\n');
  expect(await page.evaluate(() => window.__grawlixTest.sync.isSynced('My Edits'))).toBe(true);
});

test('the poll tick applies an external edit even right after connect wrote the file', async ({ page }) => {
  await gotoApp(page);
  // Unsorted on disk, so connect()'s reconcile rewrites it (sorted) — an own
  // write whose mtime bump the first tick must absorb without swallowing the
  // next genuine external edit.
  await writeFile(page, 'edits.txt', 'FOO;10\nAAA;5\n');
  await setNextName(page, 'edits.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachEditsExisting());

  await page.evaluate(() => window.__grawlixTest.sync.tickEdits());   // establishes the mtime baseline
  await writeFile(page, 'edits.txt', 'AAA;5\nFOO;10\nBAR;20\n');      // external editor adds BAR
  await page.evaluate(() => window.__grawlixTest.sync.tickEdits());   // must reconcile, not skip

  const entries = await page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.map(e => e.entry).sort());
  expect(entries).toEqual(['aaa', 'bar', 'foo']);
});

test('the sync sign reflects the synced file', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Src', scores: [50], entries: ['ALPHA'] }));
  await scopeTo(page, 'Src');

  const syncSign = page.locator('#wordlist-bar #sync-sign');
  await expect(syncSign).not.toContainText('.txt');

  await setNextName(page, 'Src.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachMirror('Src'));

  await expect(syncSign).toContainText('Src.txt');
});

test('an external deletion in the synced file deletes the entry without resurrecting it', async ({ page }) => {
  await gotoApp(page);
  await writeFile(page, 'edits.txt', 'FOO;10\nBAR;20\n');
  await setNextName(page, 'edits.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachEditsExisting());

  let entries = await page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.map(e => e.entry).sort());
  expect(entries).toEqual(['bar', 'foo']);

  await writeFile(page, 'edits.txt', 'FOO;10\n');
  await page.evaluate(() => window.__grawlixTest.sync.reconcileEdits());

  entries = await page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.map(e => e.entry));
  expect(entries).toEqual(['foo']);
  expect(await readFile(page, 'edits.txt')).toBe('FOO;10\n');
});

test('v10→v11 migration splits the old sync_ record in two, deletes the old, and reads back', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Src', scores: [50], entries: ['ALPHA'] }));

  const editsKey = await page.evaluate(() => window.__grawlixTest.sync.keyOf('My Edits'));
  const srcKey   = await page.evaluate(() => window.__grawlixTest.sync.keyOf('Src'));

  // A plain { name } object stands in for the FileSystemFileHandle here: it survives
  // the IDB round-trip and loadSyncTargets only reads .name back off it.
  await idbPutRaw(page, 'sync_' + editsKey, { handle: { name: 'mine.txt' }, baseline: 'FOO;10\n' });
  await idbPutRaw(page, 'sync_' + srcKey,   { handle: { name: 'Src.txt' } });

  await page.evaluate(() => window.__grawlixTest.sync.migrateIdbRecords(10));

  expect(await idbGetRaw(page, 'sync_main_' + editsKey)).toEqual({ handle: { name: 'mine.txt' } });
  expect(await idbGetRaw(page, 'sync_worker_' + editsKey)).toEqual({ baseline: 'FOO;10\n' });
  expect(await idbGetRaw(page, 'sync_main_' + srcKey)).toEqual({ handle: { name: 'Src.txt' } });
  expect(await idbGetRaw(page, 'sync_worker_' + srcKey)).toBe(null);   // mirror list: no baseline record
  expect(await idbGetRaw(page, 'sync_' + editsKey)).toBe(null);         // old record deleted
  expect(await idbGetRaw(page, 'sync_' + srcKey)).toBe(null);

  await page.evaluate(() => window.__grawlixTest.sync.loadTargets());
  expect(await page.evaluate(() => window.__grawlixTest.sync.targetFor('My Edits')))
    .toEqual({ name: 'mine.txt', baseline: 'FOO;10\n' });
  expect(await page.evaluate(() => window.__grawlixTest.sync.targetFor('Src')))
    .toEqual({ name: 'Src.txt', baseline: undefined });
});
