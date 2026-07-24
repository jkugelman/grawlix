'use strict';

// ─── Lookup section ───────────────────────────────────────────────────────────
//
// Unlike a standard lifecycle component, this one renders into a host element
// the entry panel provides rather than creating its own — it lives inside the
// panel's churny innerHTML, so the panel owns the node and re-mounts it.

import { LOOKUP_SOURCES, getLookupSource } from '../engine/lookup.js';
import { toNorm } from '../engine/norm.js';
import { resolveEntryCanonical } from './canonical.js';
import { LruCache } from '../core/lru.js';
import { esc } from '../core/util.js';

const INLINE = LOOKUP_SOURCES.filter(s => s.fetch);
const LOOKUP_DEBOUNCE_MS = 1000;

export const LookupSection = (() => {
  let hostEl = null;
  let entry = '';        // live entry text — drives the (free) links immediately
  let norm = '';
  let shownEntry = '';   // entry whose inline results are on screen — swaps lazily
  let debounceTimer = null;
  const cache = new LruCache(300, 60 * 60 * 1000);
  // entry → resolved canonical form to fall back to (string), null (resolved, no
  // usable alternative), or undefined (not yet resolved). Keyed like `cache`, so
  // it persists across entries at module scope.
  const resolved = new LruCache(100, 60 * 60 * 1000);
  // Retry flags for degraded resolutions. Must share `resolved`'s lifetime: outlive it
  // and entries re-resolve for nothing, expire first and a degraded one stops retrying.
  const degraded = new LruCache(100, 60 * 60 * 1000);

  function key(entryStr, id) { return `${entryStr} ${id}`; }

  function inlineSettled(e) {
    return INLINE.every(s => {
      const cell = cache.get(key(e, s.id));
      return cell && cell.status !== 'loading';
    });
  }

  function dataHasContent(data) {
    if (data.kind === 'words') return data.words.length > 0;
    return !data.empty;  // prose / definitions
  }

  function hasAnyResult(e) {
    return INLINE.some(s => {
      const cell = cache.get(key(e, s.id));
      return cell?.status === 'ok' && dataHasContent(cell.data);
    });
  }

  function effectiveEntry() {
    if (!shownEntry || hasAnyResult(shownEntry)) return shownEntry;
    return resolved.get(shownEntry) || shownEntry;
  }

  function fallbackPending(e) {
    if (!inlineSettled(e) || hasAnyResult(e)) return false;
    const alt = resolved.get(e);
    if (alt === undefined) return true;   // resolution not done
    if (alt === null) return false;       // resolved: genuinely nothing to show
    return !inlineSettled(alt);           // fetching the alt's lookups
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
    ensureFallback(entry);
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
    else if (inlineSettled(entry)) { shownEntry = entry; ensureFallback(entry); }   // already fetched — show at once
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
        ensureFallback(myEntry);
        render();
      }
    });
  }

  // Entry drew a blank everywhere: fetch its canonical form's lookups instead, so
  // a concatenation/miscased entry still lights up. No usable alternative → null.
  function ensureFallback(entryStr) {
    if (inlineSettled(entryStr) && !hasAnyResult(entryStr)) ensureResolved(entryStr);
  }

  function ensureResolved(entryStr) {
    const alt = resolved.get(entryStr);
    // A cached alt can outlive its fetched lookups (the caches evict
    // independently), so re-ensure them — otherwise fallbackPending waits on
    // fetches nothing will start.
    if (alt) { for (const s of INLINE) fetchInto(alt, s.id); return; }
    if (resolved.has(entryStr) && !degraded.has(entryStr)) return;   // in flight (undefined) or no alternative (null)
    degraded.delete(entryStr);
    resolved.set(entryStr, undefined);
    resolveEntryCanonical(entryStr).then(({ value, complete }) => {
      const alt = value && value !== entryStr ? value : null;
      // Recorded even when degraded: a missing `resolved` entry reads as "still
      // resolving" to fallbackPending, stranding the card on its spinner. `degraded`
      // is the separate retry flag, so the answer settles the UI without sticking
      // for the cache's full hour.
      resolved.set(entryStr, alt);
      if (!complete) degraded.set(entryStr, true);
      if (alt) for (const s of INLINE) fetchInto(alt, s.id);
      if (hostEl && shownEntry === entryStr) render();
    });
  }

  function fetchInto(entryStr, id) {
    const k = key(entryStr, id);
    if (cache.has(k)) return;
    cache.set(k, { status: 'loading' });
    getLookupSource(id).fetch(entryStr).then(
      data => cache.set(k, { status: 'ok', data }),
      err => cache.set(k, { status: 'err', error: err }),
    ).then(() => { if (hostEl && effectiveEntry() === entryStr) render(); });
  }

  function render() {
    if (hostEl) hostEl.innerHTML = build();
  }

  function build() {
    if (!entry && !shownEntry) return '';
    const eff = effectiveEntry();
    const usingAlt = eff !== shownEntry;
    const sections = shownEntry ? INLINE.map(s => sectionHTML(s.id, eff)).filter(Boolean) : [];
    const loading = shownEntry && (!inlineSettled(shownEntry) || fallbackPending(shownEntry));
    const note = usingAlt && sections.length
      ? `<div class="lookup-alt-note">Showing results for “${esc(eff)}”</div>` : '';
    const info = sections.length ? note + sections.join('')
      : loading ? `<div class="lookup-empty">Looking up “${esc(shownEntry)}”…</div>`
      : '';
    // Wikipedia and Wiktionary need an exact page title, so their links (and
    // inline fetches) follow the resolved form once known — a raw `groundfrost`
    // 404s where `ground frost` resolves. Google/OneLook are searches; XWord is
    // letters-only — all fine on the raw text.
    const resolvedTarget = resolved.get(entry) || entry;
    const RESOLVED_LINKS = new Set(['wikipedia', 'wiktionary']);
    const links = LOOKUP_SOURCES.map(s => {
      const target = RESOLVED_LINKS.has(s.id) ? resolvedTarget : entry;
      return `<a class="lookup-link" href="${esc(s.url(target, norm))}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`;
    }).join('');
    const searchSec = `<div class="lookup-sec"><div class="lookup-sec-head">Search</div><div class="lookup-links">${links}</div></div>`;
    return searchSec + info;
  }

  function sectionHTML(id, forEntry) {
    const cell = cache.get(key(forEntry, id));
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
