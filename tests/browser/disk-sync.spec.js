// The File System Access API can't be driven headless, so these tests install an
// in-memory fake for the file pickers and run the app's real attach/reconcile
// code against it. See site/index.html § Disk sync and docs/design.md § Disk sync.

import { test, expect } from '@playwright/test';
import { gotoApp, stubPublisherFetches, scopeTo } from './helpers.js';

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
    .toEqual({ name: 'mine.txt' });
  expect(await idbGetRaw(page, 'sync_worker_' + editsKey)).toEqual({ baseline: 'FOO;10\n' });
  expect(await page.evaluate(() => window.__grawlixTest.sync.targetFor('Src')))
    .toEqual({ name: 'Src.txt' });
  expect(await idbGetRaw(page, 'sync_worker_' + srcKey)).toBe(null);
});

// ─── Worker owns the baseline (sync_worker_) in BOTH directions ──────────────
// Post-flip the worker runs the 3-way merge and is the sole writer of the
// sync_worker_<editsKey> baseline; main only writes the file and seeds its
// resident copy. The oracle proves all four observable surfaces stay byte-
// identical: the file bytes, the worker-owned baseline record, the worker's
// data_<editsKey> corpus, and main's shown My Edits entries.

const editsKey = page => page.evaluate(() => window.__grawlixTest.sync.keyOf('My Edits'));
const workerBaseline = (page, key) => idbGetRaw(page, 'sync_worker_' + key);
const mainEntries = page => page.evaluate(() =>
  window.__grawlixTest.getWordlist('My Edits').entries.map(e => e.entry).sort());

test('inbound reconcile: the worker writes the baseline, the corpus IDB, and the file', async ({ page }) => {
  await gotoApp(page);
  await writeFile(page, 'edits.txt', 'FOO;10\n');
  await setNextName(page, 'edits.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachEditsExisting());

  const key = await editsKey(page);
  expect(await workerBaseline(page, key)).toEqual({ baseline: 'FOO;10\n' });

  await writeFile(page, 'edits.txt', 'FOO;10\nBAR;20\n');   // external editor adds BAR
  await page.evaluate(() => window.__grawlixTest.sync.reconcileEdits());

  const mergedText = 'BAR;20\nFOO;10\n';                    // sorted serialize
  expect(await readFile(page, 'edits.txt')).toBe(mergedText);                 // (a) file bytes
  expect(await workerBaseline(page, key)).toEqual({ baseline: mergedText });  // (b) worker wrote the baseline
  expect(await idbGetRaw(page, 'data_' + key)).toBe(mergedText);             // (c) worker wrote the corpus IDB
  expect(await mainEntries(page)).toEqual(['bar', 'foo']);                    // (d) main's resident copy
});

// The reason the merge moved to the worker: with the baseline worker-owned, a
// locally-edited-then-flushed entry that's later changed externally auto-merges
// (takes the file) with NO spurious conflict. A stale/main-side baseline would
// see both the device and file diverge from the ancestor and pop the dialog.
test('no spurious conflict: local edit → flush → external edit auto-merges', async ({ page }) => {
  await gotoApp(page);
  await writeFile(page, 'edits.txt', 'ABLE;50\n');
  await setNextName(page, 'edits.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachEditsExisting());

  await page.evaluate(() => window.__grawlixTest.sync.trackConflict());

  // Local edit ABLE 50 → 80, then flush (file := corpus, baseline advances to it).
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ABLE', 'ABLE', 80, ''));
  await page.evaluate(() => window.__grawlixTest.sync.flushWrites());
  expect(await readFile(page, 'edits.txt')).toBe('ABLE;80\n');

  // External editor changes ABLE again (80 → 90). The baseline advanced past the
  // flush, so only the file diverges from it → auto-merge, no conflict.
  await writeFile(page, 'edits.txt', 'ABLE;90\n');
  await page.evaluate(() => window.__grawlixTest.sync.reconcileEdits());

  expect(await page.evaluate(() => window.__conflictRaised)).toBe(false);   // no dialog
  expect(await page.evaluate(() => window.__grawlixTest.sync.isSynced('My Edits'))).toBe(true);
  const able = await page.evaluate(() =>
    window.__grawlixTest.getWordlist('My Edits').entries.find(e => e.entry === 'able'));
  expect(able.score).toBe(90);                             // took the file
});

test('conflict two-phase: choosing file vs device resolves deterministically', async ({ page }) => {
  for (const [choice, expectedScore, expectedFile] of [['file', 90, 'ABLE;90\n'], ['device', 80, 'ABLE;80\n']]) {
    await gotoApp(page);
    await writeFile(page, 'edits.txt', 'ABLE;50\n');
    await setNextName(page, 'edits.txt');
    await page.evaluate(() => window.__grawlixTest.sync.attachEditsExisting());

    // Diverge BOTH sides from the baseline=ABLE;50 on the SAME norm → a real conflict.
    await page.evaluate(() => window.__grawlixTest.saveMyEdit('ABLE', 'ABLE', 80, ''));  // device side
    // Disarm the edit's debounced outbound write: left armed it fires (on slow webkit)
    // before the reconcile, clobbering the file back to 80 and advancing the baseline,
    // which erases the conflict this test sets up — the webkit flake (got 80).
    await page.evaluate(() => window.__grawlixTest.sync.cancelPendingWrites());
    await writeFile(page, 'edits.txt', 'ABLE;90\n');                                     // file side
    await page.evaluate(c => window.__grawlixTest.sync.setConflictResolver(c), choice);
    await page.evaluate(() => window.__grawlixTest.sync.reconcileEdits());

    const able = await page.evaluate(() =>
      window.__grawlixTest.getWordlist('My Edits').entries.find(e => e.entry === 'able'));
    expect(able.score).toBe(expectedScore);
    expect(await readFile(page, 'edits.txt')).toBe(expectedFile);
    const key = await editsKey(page);
    expect(await workerBaseline(page, key)).toEqual({ baseline: expectedFile });
  }
});

// Distinct from the conflict test above: this forces the syncConfig async-rebuild gap
// (corpus freed, not yet rebuilt) deterministically, which that test only reached
// flakily. Pre-fix the merge no-opped in the gap and `able` kept the device 80.
test('a conflict reconcile in a syncConfig rebuild gap still applies the file choice', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Src', scores: [50], entries: ['ZEBRA'] }));
  await writeFile(page, 'edits.txt', 'ABLE;50\n');
  await setNextName(page, 'edits.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachEditsExisting());

  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ABLE', 'ABLE', 80, ''));   // device side
  await writeFile(page, 'edits.txt', 'ABLE;90\n');                                       // file side
  await page.evaluate(() => window.__grawlixTest.sync.setConflictResolver('file'));

  // Fire a syncConfig (enable toggle) WITHOUT awaiting it, then reconcile in the same
  // turn: signal effects are synchronous, so the syncConfig is posted before the
  // reconcile's mergeDisk, and FIFO runs mergeDisk inside that build's async gap.
  await page.evaluate(() => {
    window.__grawlixTest.setEnabled('Src', false);
    return window.__grawlixTest.sync.reconcileEdits();
  });

  const able = await page.evaluate(() =>
    window.__grawlixTest.getWordlist('My Edits').entries.find(e => e.entry === 'able'));
  expect(able.score).toBe(90);
  expect(await readFile(page, 'edits.txt')).toBe('ABLE;90\n');
  const key = await editsKey(page);
  expect(await workerBaseline(page, key)).toEqual({ baseline: 'ABLE;90\n' });
});

test('outbound flush: a local edit pushes to the file and advances the baseline; a no-op flush writes nothing', async ({ page }) => {
  await gotoApp(page);
  await writeFile(page, 'edits.txt', 'ABLE;50\n');
  await setNextName(page, 'edits.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachEditsExisting());
  const key = await editsKey(page);

  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ABLE', 'ABLE', 80, ''));
  await page.evaluate(() => window.__grawlixTest.sync.flushWrites());

  expect(await readFile(page, 'edits.txt')).toBe('ABLE;80\n');
  expect(await workerBaseline(page, key)).toEqual({ baseline: 'ABLE;80\n' });

  // A redundant flush (no corpus change) writes nothing — file mtime is unchanged.
  const mtimeBefore = await page.evaluate(() => window.__fakeFS.files.get('edits.txt').mtime);
  await page.evaluate(() => window.__grawlixTest.sync.scheduleEditsWrite());
  await page.evaluate(() => window.__grawlixTest.sync.flushWrites());
  expect(await page.evaluate(() => window.__fakeFS.files.get('edits.txt').mtime)).toBe(mtimeBefore);
});

test('outbound flush merges a concurrent external edit instead of clobbering it', async ({ page }) => {
  await gotoApp(page);
  await writeFile(page, 'edits.txt', 'ABLE;50\n');
  await setNextName(page, 'edits.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachEditsExisting());
  const key = await editsKey(page);

  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ABLE', 'ABLE', 80, ''));  // local edit, arms the flush
  await writeFile(page, 'edits.txt', 'ABLE;50\nZEBRA;30\n');                            // external editor adds ZEBRA

  // Fire the armed write with the file externally changed: a blind push would drop
  // ZEBRA (write only the corpus) and advance the baseline past it — the silent loss.
  await page.evaluate(() => window.__grawlixTest.sync.flushWrites());

  const merged = 'ABLE;80\nZEBRA;30\n';
  expect(await readFile(page, 'edits.txt')).toBe(merged);
  expect(await workerBaseline(page, key)).toEqual({ baseline: merged });
  expect(await mainEntries(page)).toEqual(['able', 'zebra']);
});
