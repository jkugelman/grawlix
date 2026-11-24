#!/usr/bin/env node
// Checks that every external resource Grawlix fetches still answers the way the
// app needs: publisher wordlists, data assets, icons, and lookup APIs. Each URL is
// read from the module that uses it, so a relocated resource is checked at its
// new address. Exits non-zero if any check fails.

import { appendFileSync } from 'node:fs';
import { WORDLIST_PUBLISHERS } from '../site/src/core/constants.js';
import { revalidatesOnGet } from '../site/src/core/util.js';
import { CMU_DICT_URL } from '../site/src/engine/phonetics.js';
import { UNIGRAM_CORPUS_URL } from '../site/src/engine/segmenter.js';
import { DATAMUSE, WIKI_SUMMARY, WIKTIONARY_DEF } from '../site/src/engine/lookup.js';
import { WIKTIONARY_API, WIKIPEDIA_API } from '../site/src/engine/canonical.js';

const ORIGIN = 'https://grawlix.wtf';
// Wikimedia rejects requests without a descriptive User-Agent.
const HEADERS = { Origin: ORIGIN, 'User-Agent': 'GrawlixLinkCheck/1.0 (+https://grawlix.wtf)' };
const TIMEOUT_MS = 60_000;

// ─── Checks ───────────────────────────────────────────────────────────────────

class CheckError extends Error {}
const fail = msg => { throw new CheckError(msg); };

async function get(url, method = 'GET') {
  const resp = await fetch(url, { method, headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) fail(`${method} returned ${resp.status} ${resp.statusText}`);
  return resp;
}

// The browser discards a cross-origin response without a matching
// Access-Control-Allow-Origin, so a 200 alone doesn't mean the app can read it.
function requireCors(resp) {
  const acao = resp.headers.get('access-control-allow-origin');
  if (acao !== '*' && acao !== ORIGIN) fail(`no CORS access (Access-Control-Allow-Origin: ${acao ?? 'missing'})`);
}

// The update checks compare a HEAD's Content-Length against the stored size, so a
// host that stops answering HEAD silently stops delivering updates.
async function requireHeadSize(url) {
  const resp = await get(url, 'HEAD');
  if (!resp.headers.get('content-length')) fail('HEAD has no Content-Length, so update checks would never fire');
}

async function checkWordlist(url) {
  const resp = await get(url);
  requireCors(resp);
  const lines = (await resp.text()).split('\n').filter(l => l.trim());
  const valid = lines.filter(l => /^[^;]+;\d+(;|\s*$)/.test(l)).length;
  if (lines.length < 10_000) fail(`only ${lines.length} lines`);
  if (valid / lines.length < 0.95) fail(`only ${valid} of ${lines.length} lines look like ENTRY;SCORE`);
  if (!revalidatesOnGet(url)) await requireHeadSize(url);
  return `${lines.length.toLocaleString()} entries`;
}

async function checkDataAsset(url) {
  const resp = await get(url);
  requireCors(resp);
  const bytes = (await resp.arrayBuffer()).byteLength;
  if (bytes < 1_000_000) fail(`only ${bytes} bytes`);
  await requireHeadSize(url);
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

// <img> loads need no CORS.
async function checkImage(url) {
  const resp = await get(url);
  const type = resp.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) fail(`Content-Type is ${type || 'missing'}`);
  await resp.arrayBuffer();
  return type;
}

async function checkJsonApi(url, isValid) {
  const resp = await get(url);
  requireCors(resp);
  let data;
  try { data = await resp.json(); } catch { fail('response is not JSON'); }
  if (!isValid(data)) fail('JSON response has an unexpected shape');
  return 'ok';
}

// ─── Resources ────────────────────────────────────────────────────────────────

const checks = [
  ...WORDLIST_PUBLISHERS.filter(p => p.url).map(p => ({
    name: `${p.name} wordlist`, url: p.url, run: () => checkWordlist(p.url),
  })),
  ...WORDLIST_PUBLISHERS.filter(p => p.icon?.type === 'img').map(p => ({
    name: `${p.name} icon`, url: p.icon.url, run: () => checkImage(p.icon.url),
  })),
  { name: 'CMU dictionary', url: CMU_DICT_URL, run: () => checkDataAsset(CMU_DICT_URL) },
  { name: 'wordfreq unigrams', url: UNIGRAM_CORPUS_URL, run: () => checkDataAsset(UNIGRAM_CORPUS_URL) },
  ...[
    ['Datamuse synonyms', `${DATAMUSE}?max=18&rel_syn=happy`, d => Array.isArray(d) && d.length > 0],
    ['Wikipedia summary', `${WIKI_SUMMARY}Crossword`, d => typeof d?.extract === 'string'],
    ['Wiktionary definition', `${WIKTIONARY_DEF}crossword`, d => Array.isArray(d?.en)],
    ['Wiktionary search', `${WIKTIONARY_API}?action=query&list=search&srsearch=crossword&srlimit=8&format=json&origin=*`,
      d => Array.isArray(d?.query?.search)],
    ['Wikipedia opensearch', `${WIKIPEDIA_API}?action=opensearch&search=crossword&limit=8&format=json&origin=*`,
      d => Array.isArray(d?.[1])],
  ].map(([name, url, isValid]) => ({ name, url, run: () => checkJsonApi(url, isValid) })),
];

// ─── Report ───────────────────────────────────────────────────────────────────

const results = await Promise.all(checks.map(async c => {
  try { return { ...c, ok: true, detail: await c.run() }; }
  catch (err) { return { ...c, ok: false, detail: err instanceof CheckError ? err.message : `${err.name}: ${err.cause?.message ?? err.message}` }; }
}));

for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}: ${r.detail}\n      ${r.url}`);

const failed = results.filter(r => !r.ok);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map(r => `| ${r.ok ? '✅' : '❌'} | [${r.name}](${encodeURI(r.url)}) | ${r.detail} |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Resource links: ${failed.length ? `${failed.length} failing` : 'all ok'}\n\n| | Resource | Result |\n|-|-|-|\n${rows.join('\n')}\n`);
}
for (const r of failed) console.log(`::error title=${r.name} is broken::${r.detail} (${r.url})`);
process.exit(failed.length ? 1 : 0);
