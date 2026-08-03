import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

// P7d/P7e/P7a oracle: the merged-corpus serialize + count off the worker. The
// merged download (M1), the merged disk mirror (M2), and the Welcome All-Wordlists
// count (C1) read the worker's ownedMerged (or its shipped count); the produced
// bytes/count must be BYTE-IDENTICAL to main's local serialize fallback (reached
// when ownedMerged is null) across output-format settings. Download and mirror are
// the same artifact, so they also serialize identically to each other (section D).
// See docs/worker-protocol.md § serializeFor.

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
  rich:     { spaces: true, punctuation: true, diacritics: true, unicode: true, comments: true },
  noAccent: { spaces: true, punctuation: true, diacritics: false, unicode: true, comments: true },
  noSpace:  { spaces: false, punctuation: true, diacritics: true, unicode: true, comments: true },
  stripped: { spaces: false, punctuation: false, diacritics: false, unicode: true, comments: true },
  noComment:{ spaces: true, punctuation: true, diacritics: true, unicode: true, comments: false },
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

// Drive the worker corpus-less (next build throws, config frees the corpus and never
// rebuilds), so serialize replies `retry`. The search run rides along to give
// pipelineIdle a deferred run to await the failing build on — without it the test
// races the async build and flakes.
async function makeNotFresh(page) {
  await page.evaluate(() => window.__grawlixTest.failNextWorkerBuildForTest());
  await page.evaluate(() => {
    window.__grawlixTest.syncWorkerConfig();
    window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'a' } }]);
  });
  await expect.poll(
    () => page.evaluate(async () => { await window.__grawlixTest.pipelineIdle(); return true; }),
    { timeout: 5000 }
  ).toBe(true);
}

// ─── M1: merged download ─────────────────────────────────────────────────────

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

// M1 guard: a merged download with no fresh corpus must never save a 0-byte file —
// every serialize replies `retry`, so the download is suppressed, not saved empty.
test('M1 not-fresh: a not-ready merged download saves no empty file', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await scopeTo(page, 'All Wordlists');
  await makeNotFresh(page);

  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.evaluate(() => downloadMergedWordlistFromPanel());
  expect(downloaded, 'no empty file is saved when the merge is not ready').toBe(false);
});

// ─── M2: merged disk mirror ──────────────────────────────────────────────────

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

// M2 guard: the regression. A merged-mirror flush with no fresh corpus must skip the
// write and leave the last-good file intact — never truncate it to 0 bytes, the failure
// that silently zeroed users' All-Wordlists files during a rebuild.
test('M2 mirror not-fresh: a not-ready flush never truncates the synced file', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await scopeTo(page, 'All Wordlists');
  await setFormat(page, FORMATS.rich);
  await attachMergedMirror(page);
  await makeFresh(page);

  const good = await flushAndRead(page);
  expect(good.length).toBeGreaterThan(0);

  await makeNotFresh(page);
  await page.evaluate(() => window.__grawlixTest.sync.flushMerged());
  expect(await readFile(page, 'Merged.txt'), 'file survives a not-ready flush').toBe(good);
});

// ─── C1: Help All-Wordlists count ────────────────────────────────────────────

test('C1 Help merge count: worker count matches the local fallback', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await scopeTo(page, 'All Wordlists');

  const countText = page.locator('#help-dialog .faq-merge-count');
  const openHelp = () => page.evaluate(() => window.__grawlixTest.openHelp());
  const closeHelp = () => page.evaluate(() => document.getElementById('help-dialog').close());

  // No sync yet: the count comes from main's local merge — the baseline. Read via
  // the rendered dialog text so we exercise the real render path.
  await openHelp();
  const localText = await countText.textContent();
  await closeHelp();

  await makeFresh(page);
  await openHelp();
  const workerText = await countText.textContent();

  expect(workerText).toBe(localText);
  expect(workerText).not.toBe('0 entries');   // guard against both paths reading an empty merge
});

// ─── S1: individual source download ──────────────────────────────────────────
// The per-source sibling of M1: downloadSourceWordlist serializes ONE source's
// full rescored entry list off the worker. The bytes must be BYTE-IDENTICAL to
// main's local serialize fallback (reached when the worker isn't fresh) across
// output formats. See docs/worker-protocol.md.

async function captureSourceDownload(page, name) {
  const dl = page.waitForEvent('download');
  await page.evaluate(n => downloadSourceWordlist(state.sources.find(w => w.name === n)), name);
  return readDownload(await dl);
}

test('S1 individual download: worker serialize is byte-identical to the local fallback across output formats', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // No syncWorkerConfig yet: ownedBuilt is null, so every download falls back to
  // main's local serialize — the byte baseline, captured per format.
  const local = {};
  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    local[label] = await captureSourceDownload(page, 'Alpha');
  }

  await makeFresh(page);
  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    const before = await serializeFetches(page);
    const worker = await captureSourceDownload(page, 'Alpha');
    expect(await serializeFetches(page) - before, `${label}: one worker round-trip`).toBe(1);
    expect(worker, `format ${label}`).toBe(local[label]);
  }
});

// ─── S2: individual source disk mirror ───────────────────────────────────────

async function attachSourceMirror(page, name, file) {
  await setNextName(page, file);
  await page.evaluate(n => window.__grawlixTest.sync.attachMirror(n), name);
}
async function flushSourceAndRead(page, name, file) {
  await page.evaluate(n => window.__grawlixTest.sync.flushSource(n), name);
  return readFile(page, file);
}

test('S2 individual disk mirror: worker serialize is byte-identical to the local fallback across output formats', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await attachSourceMirror(page, 'Alpha', 'Alpha.txt');

  // No sync yet: every flush falls back to main's local serialize — the baseline.
  const local = {};
  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    local[label] = await flushSourceAndRead(page, 'Alpha', 'Alpha.txt');
  }

  await makeFresh(page);
  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    const before = await serializeFetches(page);
    const worker = await flushSourceAndRead(page, 'Alpha', 'Alpha.txt');
    expect(await serializeFetches(page) - before, `${label}: one worker round-trip`).toBe(1);
    expect(worker, `format ${label}`).toBe(local[label]);
  }
});

// ─── D: download === disk mirror ─────────────────────────────────────────────
// M1/M2 and S1/S2 each prove worker == local-fallback WITHIN one path; these prove
// the download and the disk mirror produce the same bytes ACROSS paths — a distinct
// invariant, not a duplicate of those. They are the same wordlist file for one
// scope + format, so a sort divergence between the two paths fails here.

test('D merged: the download and the disk mirror serialize identically across formats', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await scopeTo(page, 'All Wordlists');
  await attachMergedMirror(page);
  await makeFresh(page);

  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    const download = await captureMergedDownload(page);
    const mirror = await flushAndRead(page);
    expect(download, `merged ${label}: download === mirror`).toBe(mirror);
  }
});

test('D individual: the download and the disk mirror serialize identically across formats', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await attachSourceMirror(page, 'Alpha', 'Alpha.txt');
  await makeFresh(page);

  for (const [label, fmt] of Object.entries(FORMATS)) {
    await setFormat(page, fmt);
    const download = await captureSourceDownload(page, 'Alpha');
    const mirror = await flushSourceAndRead(page, 'Alpha', 'Alpha.txt');
    expect(download, `source ${label}: download === mirror`).toBe(mirror);
  }
});
