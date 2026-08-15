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
// Deliberate: sources settle separately, so painting each as it lands pops the
// section open once per source.
const REVEAL_HOLD_MS = 300;
// How long a superseded entry's results may stay up. No card names the entry it
// describes, so past this they read as answers about the text now in the box.
export const STALE_GRACE_MS = 200;

export const LookupSection = (() => {
  let hostEl = null;
  let entry = '';        // live entry text — the link-outs follow it verbatim
  let norm = '';
  let shownEntry = '';   // entry whose inline results are on screen — swaps lazily
  let debounceTimer = null;
  let holdTimer = null;
  let staleTimer = null;
  let holding = false;
  let onRender = null;
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
  // `settleMs` delays the fetches for an open that may be superseded at once (a
  // walk step): each entry costs three requests, so scrubbing would fan out.
  function mount(host, entryStr, { settleMs = 0, onChange = null } = {}) {
    hostEl = host;
    onRender = onChange;
    entry = shownEntry = (entryStr || '').trim();
    norm = toNorm(entry);
    clearTimeout(debounceTimer);
    debounceTimer = null;
    clearStale();
    clearTimeout(holdTimer);
    holding = true;
    holdTimer = setTimeout(() => { holding = false; render(); }, settleMs + REVEAL_HOLD_MS);
    if (settleMs) debounceTimer = setTimeout(runInlineLookups, settleMs);
    else runInlineLookups();
    ensureFallback(entry);
    render();
  }

  // The links repoint immediately; the inline results can't (the new entry's fetches
  // haven't answered), so they hold — but only for STALE_GRACE_MS. Blanking at the
  // keystroke instead flickers every already-cached swap.
  function setEntry(entryStr) {
    const next = (entryStr || '').trim();
    if (next === entry) return;
    entry = next;
    norm = toNorm(entry);
    clearTimeout(debounceTimer);
    debounceTimer = null;
    clearTimeout(holdTimer);
    holding = false;
    if (!entry) { clearStale(); shownEntry = ''; }
    else if (inlineSettled(entry)) { clearStale(); shownEntry = entry; ensureFallback(entry); }   // already fetched — show at once
    else {
      armStale();
      debounceTimer = setTimeout(runInlineLookups, LOOKUP_DEBOUNCE_MS);
    }
    render();
  }

  // Deliberately not restarted per keystroke: a per-keystroke timer would let a
  // continuous typist push the blank out forever — the lingering this exists to end.
  function armStale() {
    if (staleTimer || !shownEntry) return;
    staleTimer = setTimeout(() => {
      staleTimer = null;
      if (shownEntry === entry) return;
      shownEntry = '';
      render();
    }, STALE_GRACE_MS);
  }

  function clearStale() {
    clearTimeout(staleTimer);
    staleTimer = null;
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
    if (!hostEl) return;
    hostEl.innerHTML = build();
    onRender?.();
  }

  function build() {
    if (!entry && !shownEntry) return '';
    const eff = effectiveEntry();
    const usingAlt = eff !== shownEntry;
    const settled = shownEntry && inlineSettled(shownEntry) && !fallbackPending(shownEntry);
    // The whole section is withheld, links included, so it arrives as one animated
    // block; revealing the free links first just moves the shift to the cards.
    if (holding && !settled) return '';
    const sections = shownEntry ? INLINE.map(s => sectionHTML(s.id, eff)).filter(Boolean) : [];
    const note = usingAlt && sections.length
      ? `<div class="lookup-alt-note">Showing results for “${esc(eff)}”</div>` : '';
    // Deliberately no in-flight placeholder — sections only ever appear, never retract.
    const info = sections.length ? note + sections.join('') : '';
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
