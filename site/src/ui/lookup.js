'use strict';

// ─── Lookup section ───────────────────────────────────────────────────────────
//
// Unlike a standard lifecycle component, this one renders into a host element
// AtomPopover provides rather than creating its own — it lives inside the
// popover's churny innerHTML, so the popover owns the node and re-mounts it.

import { LOOKUP_SOURCES, getLookupSource } from '../engine/lookup.js';
import { toNorm } from '../engine/norm.js';
import { esc } from '../core/util.js';

const INLINE = LOOKUP_SOURCES.filter(s => s.fetch);

export const LookupSection = (() => {
  let hostEl = null;
  let entry = '';
  let norm = '';
  let reposition = () => {};
  const cache = new Map();

  function key(entryStr, id) { return `${entryStr} ${id}`; }

  // AtomPopover rebuilds its innerHTML wholesale on open and on resetInputs, so
  // the host is a fresh node each time; remounting re-grabs it while the result
  // cache persists at module scope.
  function mount(host, entryStr, repositionFn) {
    hostEl = host;
    entry = (entryStr || '').trim();
    norm = toNorm(entry);
    reposition = repositionFn || (() => {});
    for (const s of INLINE) ensureLoaded(s.id);
    render();
  }

  function ensureLoaded(id) {
    if (!entry) return;
    const k = key(entry, id);
    if (cache.has(k)) return;
    cache.set(k, { status: 'loading' });
    // Guard the re-render on the entry, not the host node: a remount for the same
    // entry swaps hostEl but reuses this in-flight fetch (it's already cached as
    // loading), so the resolved reply must still paint into the current host. A
    // rename moves `entry`, dropping the now-stale reply instead.
    const myEntry = entry;
    getLookupSource(id).fetch(entry).then(
      data => cache.set(k, { status: 'ok', data }),
      err => cache.set(k, { status: 'err', error: err }),
    ).then(() => {
      if (hostEl && entry === myEntry) { render(); reposition(); }
    });
  }

  function render() {
    if (hostEl) hostEl.innerHTML = build();
  }

  function build() {
    if (!entry) return '';
    const sections = INLINE.map(s => sectionHTML(s.id)).filter(Boolean);
    const pending = INLINE.some(s => cache.get(key(entry, s.id))?.status === 'loading');
    const info = sections.length ? sections.join('')
      : pending ? `<div class="lookup-empty">Looking up “${esc(entry)}”…</div>`
      : '';
    const links = LOOKUP_SOURCES.map(s =>
      `<a class="lookup-link" href="${esc(s.url(entry, norm))}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`,
    ).join('');
    const searchSec = `<div class="lookup-sec"><div class="lookup-sec-head">Search</div><div class="lookup-links">${links}</div></div>`;
    return searchSec + info;
  }

  function sectionHTML(id) {
    const cell = cache.get(key(entry, id));
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

  return { mount };
})();
