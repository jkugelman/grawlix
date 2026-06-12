const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo } = require('./helpers');

// P7d/P7e/P7a oracle: the merged-corpus serialize + count off the worker. The
// merged download (M1, UNSORTED), the merged disk mirror (M2, SORTED), and the
// Welcome All-Wordlists count (C1) read the worker's ownedMerged (or its shipped
// count); the produced bytes/count must be BYTE-IDENTICAL to main's local serialize
// fallback (reached when ownedMerged is null) across output-format settings. See
// docs/worker-protocol.md § serializeFor.

// Fake File System Access API so the merged disk mirror can be driven headless
// and the written text captured. Mirrors disk-sync.spec.js's installFakeFS.
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
const setNextName = (page, name) => page.evaluate(n => { window.__fakeFS.nextName = n; }, name);

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await installFakeFS(page);
});

// Two overlapping lists: a shared stem makes the merge pick a priority winner per
// entry. Accents/spaces/punctuation/comments in the entries exercise
// serializeEntries's transforming + dedup branch under the stripped formats.
const SEED_A = [
  { entry: 'café', score: 60, comment: 'accent' },
  { entry: 'the IRS', score: 55, comment: 'space' },
  { entry: 'co-op', score: 50, comment: '' },
  { entry: 'ALPHA', score: 45, comment: 'a' },
  { entry: 'BETA', score: 40, comment: '' },
];
const SEED_B = [
  { entry: 'café', score: 30, comment: 'lower' },   // loses to A
  { entry: 'GAMMA', score: 70, comment: 'g' },
  { entry: 'DELTA', score: 65, comment: '' },
  { entry: 'theirs', score: 35, comment: 'norm-collide' },
];

async function seedCorpus(page) {
  await page.evaluate(([a, b]) => {
    const mk = rows => ({
      entries: rows.map(r => r.entry),
      scores: rows.map(r => r.score),
      comments: rows.map(r => r.comment),
    });
    window.__grawlixTest.addCustomWordlist({ name: 'Alpha', ...mk(a) });
    return window.__grawlixTest.addCustomWordlist({ name: 'Bravo', ...mk(b) });
  }, [SEED_A, SEED_B]);
}

const FORMATS = {
  rich:     { spaces: true,  punctuation: true,  accents: true,  comments: true },
  noAccent: { spaces: true,  punctuation: true,  accents: false, comments: true },
  noSpace:  { spaces: false, punctuation: true,  accents: true,  comments: true },
  stripped: { spaces: false, punctuation: false, accents: false, comments: true },
  noComment:{ spaces: true,  punctuation: true,  accents: true,  comments: false },
};

const setFormat = (page, fmt) => page.evaluate(f => setOutputFormat(f), fmt);

async function readDownload(download) {
  const stream = await download.createReadStream();
  let data = '';
  for await (const chunk of stream) data += chunk;
  return data;
}

// Trigger the real merged download and return the downloaded bytes.
async function captureMergedDownload(page) {
  const dl = page.waitForEvent('download');
  await page.evaluate(() => downloadMergedWordlistFromPanel());
  return readDownload(await dl);
}

const serializeFetches = page =>
  page.evaluate(() => window.__grawlixTest.serializeFetchesSent());

async function makeFresh(page) {
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

// ─── M1: merged download (UNSORTED) ──────────────────────────────────────────

test('M1 merged download: worker serialize is byte-identical to the local fallback across output formats', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await scopeTo(page, 'All Wordlists');

  // No syncWorkerConfig yet: ownedMerged is null, so every download falls back to
  // main's local serialize — the byte baseline, captured per format.
  const local = {};
  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    local[label] = await captureMergedDownload(page);
  }

  await makeFresh(page);
  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    const before = await serializeFetches(page);
    const worker = await captureMergedDownload(page);
    expect(await serializeFetches(page) - before, `${label}: one worker round-trip`).toBe(1);
    expect(worker, `format ${label}`).toBe(local[label]);
  }
});

// The not-fresh fallback: ownedMerged was never built (no syncWorkerConfig after
// seeding), so the worker replies text:null and main serializes locally. The
// round-trip still fires; it just replies null.
test('M1 not-fresh: the worker round-trip replies null and main serializes locally', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await scopeTo(page, 'All Wordlists');
  await setFormat(page, FORMATS.stripped);

  const before = await serializeFetches(page);
  const text = await captureMergedDownload(page);
  expect(await serializeFetches(page) - before).toBe(1);   // the round-trip happens; it just replies null
  expect(text.length).toBeGreaterThan(0);
});

// ─── M2: merged disk mirror (SORTED) ─────────────────────────────────────────

async function attachMergedMirror(page) {
  await setNextName(page, 'Merged.txt');
  await page.evaluate(() => window.__grawlixTest.sync.attachMirror('All Wordlists'));
}
async function flushAndRead(page) {
  await page.evaluate(() => window.__grawlixTest.sync.flushMerged());
  return readFile(page, 'Merged.txt');
}

test('M2 merged disk mirror: worker serialize is byte-identical to the local fallback across output formats', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await scopeTo(page, 'All Wordlists');
  await attachMergedMirror(page);

  // No sync yet: every flush falls back to main's local serialize — the baseline.
  const local = {};
  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    local[label] = await flushAndRead(page);
  }

  await makeFresh(page);
  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    const before = await serializeFetches(page);
    const worker = await flushAndRead(page);
    expect(await serializeFetches(page) - before, `${label}: one worker round-trip`).toBe(1);
    expect(worker, `format ${label}`).toBe(local[label]);
  }
});

test('M2 mirror not-fresh: the flush replies null and main serializes locally', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await scopeTo(page, 'All Wordlists');
  await setFormat(page, FORMATS.rich);
  await attachMergedMirror(page);

  const text = await flushAndRead(page);
  expect(text.length).toBeGreaterThan(0);
});

// ─── C1: Welcome All-Wordlists count ─────────────────────────────────────────

test('C1 Welcome merge count: worker count matches the local fallback', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await scopeTo(page, 'All Wordlists');

  const countText = page.locator('#welcome-dialog .welcome-merge-count');
  const openWelcome = () => page.evaluate(() => window.__grawlixTest.openWelcome());
  const closeWelcome = () => page.evaluate(() => document.getElementById('welcome-dialog').close());

  // No sync yet: the count comes from main's local merge — the baseline. Read via
  // the rendered dialog text so we exercise the real render path.
  await openWelcome();
  const localText = await countText.textContent();
  await closeWelcome();

  await makeFresh(page);
  await openWelcome();
  const workerText = await countText.textContent();

  expect(workerText).toBe(localText);
  expect(workerText).not.toBe('0 entries');   // guard against both paths reading an empty merge
});
