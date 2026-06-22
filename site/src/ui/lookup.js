'use strict';

// ─── Lookup section ───────────────────────────────────────────────────────────
//
// Unlike a standard lifecycle component, this one renders into a host element
// the entry panel provides rather than creating its own — it lives inside the
// panel's churny innerHTML, so the panel owns the node and re-mounts it.

import { LOOKUP_SOURCES, getLookupSource } from '../engine/lookup.js';
import { toNorm } from '../engine/norm.js';
import { esc } from '../core/util.js';

const INLINE = LOOKUP_SOURCES.filter(s => s.fetch);
const LOOKUP_DEBOUNCE_MS = 1000;

export const LookupSection = (() => {
  let hostEl = null;
  let entry = '';        // live entry text — drives the (free) links immediately
  let norm = '';
  let shownEntry = '';   // entry whose inline results are on screen — swaps lazily
  let debounceTimer = null;
  const cache = new Map();

  function key(entryStr, id) { return `${entryStr} ${id}`; }

  function inlineSettled(e) {
    return INLINE.every(s => {
      const cell = cache.get(key(e, s.id));
      return cell && cell.status !== 'loading';
    });
  }

  // EntryPanel rebuilds its innerHTML wholesale on open and on resetInputs, so
  // the host is a fresh node each time; remounting re-grabs it while the result
  // cache persists at module scope.
  function mount(host, entryStr) {
    hostEl = host;
    entry = shownEntry = (entryStr || '').trim();
    norm = toNorm(entry);
    clearTimeout(debounceTimer);
    debounceTimer = null;
    for (const s of INLINE) ensureLoaded(s.id);
    render();
  }

  // The links repoint immediately, but the inline results keep showing the
  // previous entry until the new entry's fetches all settle — swapping early to a
  // spinner or blank flickers the results region on every keystroke.
  function setEntry(entryStr) {
    const next = (entryStr || '').trim();
    if (next === entry) return;
    entry = next;
    norm = toNorm(entry);
    clearTimeout(debounceTimer);
    debounceTimer = null;
    if (!entry) shownEntry = '';
    else if (inlineSettled(entry)) shownEntry = entry;   // already fetched — show at once
    else debounceTimer = setTimeout(runInlineLookups, LOOKUP_DEBOUNCE_MS);
    render();
  }

  function runInlineLookups() {
    debounceTimer = null;
    for (const s of INLINE) ensureLoaded(s.id);
  }

  function ensureLoaded(id) {
    if (!entry) return;
    const k = key(entry, id);
    if (cache.has(k)) return;
    cache.set(k, { status: 'loading' });
    // Guard on the entry, not the host node: a remount for the same entry reuses
    // this in-flight fetch, so its reply must still land; a later edit moves `entry`
    // on, dropping the now-stale reply.
    const myEntry = entry;
    getLookupSource(id).fetch(entry).then(
      data => cache.set(k, { status: 'ok', data }),
      err => cache.set(k, { status: 'err', error: err }),
    ).then(() => {
      if (entry !== myEntry || !hostEl) return;
      // Render once this is the shown entry (open/initial load, fill in as replies
      // arrive) or once it has fully settled and can replace the stale content.
      if (shownEntry === myEntry || inlineSettled(myEntry)) {
        shownEntry = myEntry;
        render();
      }
    });
  }

  function render() {
    if (hostEl) hostEl.innerHTML = build();
  }

  function build() {
    if (!entry && !shownEntry) return '';
    const sections = shownEntry ? INLINE.map(s => sectionHTML(s.id)).filter(Boolean) : [];
    const loading = shownEntry && !inlineSettled(shownEntry);
    const info = sections.length ? sections.join('')
      : loading ? `<div class="lookup-empty">Looking up “${esc(shownEntry)}”…</div>`
      : '';
    const links = LOOKUP_SOURCES.map(s =>
      `<a class="lookup-link" href="${esc(s.url(entry, norm))}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`,
    ).join('');
    const searchSec = `<div class="lookup-sec"><div class="lookup-sec-head">Search</div><div class="lookup-links">${links}</div></div>`;
    return searchSec + info;
  }

  function sectionHTML(id) {
    const cell = cache.get(key(shownEntry, id));
    if (!cell || cell.status !== 'ok') return '';
    const inner = renderData(cell.data);
    return inner ? `<div class="lookup-sec"><div class="lookup-sec-head">${esc(getLookupSource(id).name)}</div>${inner}</div>` : '';
  }

  function renderData(data) {
    if (data.kind === 'definitions') return data.empty ? '' : renderDefinitions(data);
    if (data.kind === 'prose') return data.empty ? '' : renderProse(data);
    if (data.kind === 'words') return data.words.length ? renderWords(data) : '';
    return '';
  }

  function renderWords({ words }) {
    return `<div>${words.map(esc).join(' · ')}</div>`;
  }

  function renderProse({ title, description, extract, thumbnail, pageUrl, disambiguation }) {
    const thumb = thumbnail ? `<img class="lookup-thumb" src="${esc(thumbnail)}" alt="">` : '';
    const desc = description ? `<div class="lookup-prose-desc">${esc(description)}</div>` : '';
    const disamb = disambiguation ? `<div class="lookup-prose-desc">(disambiguation)</div>` : '';
    const more = pageUrl ? `<a class="lookup-more" href="${esc(pageUrl)}" target="_blank" rel="noopener">Read more ↗</a>` : '';
    return `<div class="lookup-prose">${thumb}<div class="lookup-prose-body"><div class="lookup-prose-title">${esc(title)}</div>${desc}${disamb}<p>${esc(extract)}</p>${more}</div></div>`;
  }

  function renderDefinitions({ word, phonetic, meanings }) {
    const head = `<div class="lookup-def-head">${esc(word)}${phonetic ? ` <span class="lookup-phon">${esc(phonetic)}</span>` : ''}</div>`;
    const body = meanings.map(m => {
      const defs = m.defs.map(d => `<li>${esc(d)}</li>`).join('');
      return `<div class="lookup-def"><span class="lookup-pos">${esc(m.pos)}</span><ol>${defs}</ol></div>`;
    }).join('');
    return head + body;
  }

  return { mount, setEntry };
})();
