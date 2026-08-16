'use strict';

// ─── Update summary dialog ──────────────────────────────────────────────────────

import { ROW_HEIGHT, VS_BUFFER } from '../../core/constants.js';
import { displayOf } from '../../engine/norm.js';
import { buildScoreBadgeHTML } from '../../model/score-display.js';
import { showDialog, enableDismissClicks } from './dialog.js';
import { fetchWorkerDiffRows, sendFreeDiff } from '../pipeline-worker.js';

// Windows a retained diff: only the inline first window of each section is resident,
// the rest fetched on scroll. The point is memory — a full-replace re-import must
// never re-materialize its ~600k rows on the main thread (this whole stage exists to
// stop that), so the scroller can't fall back to holding the full arrays.
class UpdateSummaryScroller {
  constructor(container) {
    this.container = container;
    this.diffId = null;
    this.sections = [];        // [{ kind, headerLabel, count, headerIndex }]
    this.total = 0;
    this.cache = new Map();    // kind -> (row | undefined)[], sized to count, seeded inline
    this.pending = new Set();  // kinds with an in-flight window fetch (coalescing)

    this.sizer = document.createElement('div');
    this.sizer.className = 'usd-sizer';
    container.appendChild(this.sizer);

    container.addEventListener('scroll', () => this._render(), { passive: true });
    new ResizeObserver(() => this._render()).observe(container);
  }

  setLayout(diffId, sections, seeds) {
    this.diffId = diffId;
    this.sections = sections;
    this.cache = new Map();
    this.pending = new Set();
    let total = 0;
    for (const s of sections) {
      s.headerIndex = total;
      const arr = new Array(s.count);
      const seed = seeds[s.kind] || [];
      for (let i = 0; i < seed.length; i++) arr[i] = seed[i];
      this.cache.set(s.kind, arr);
      total += 1 + s.count;
    }
    this.total = total;
    this.sizer.style.height = (total * ROW_HEIGHT) + 'px';
    this.container.scrollTop = 0;
    this._render();
  }

  headerIndexFor(kind) {
    const s = this.sections.find(s => s.kind === kind);
    return s ? s.headerIndex : 0;
  }

  scrollToIndex(i) {
    this.container.scrollTop = i * ROW_HEIGHT;
  }

  _locate(i) {
    for (const s of this.sections) {
      if (i === s.headerIndex) return { header: s };
      if (i > s.headerIndex && i <= s.headerIndex + s.count) return { kind: s.kind, local: i - s.headerIndex - 1 };
    }
    return null;
  }

  _render() {
    const n = this.total;
    const scrollTop = this.container.scrollTop;
    const viewH = this.container.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VS_BUFFER);
    const end   = Math.min(n, Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + VS_BUFFER);

    this.sizer.innerHTML = '';
    const frag = document.createDocumentFragment();
    const misses = new Map();   // kind -> { lo, hi }

    for (let i = start; i < end; i++) {
      const loc = this._locate(i);
      if (!loc) continue;
      const div = document.createElement('div');
      div.className = 'usd-row';
      div.style.top = (i * ROW_HEIGHT) + 'px';

      if (loc.header) {
        div.classList.add('usd-section-header');
        div.textContent = loc.header.headerLabel;
      } else {
        const row = this.cache.get(loc.kind)[loc.local];
        if (row === undefined) {
          div.classList.add('usd-entry-row', 'usd-skel');
          div.innerHTML = '<span class="skeleton-bar usd-skel-bar"></span>';
          const m = misses.get(loc.kind);
          if (m) { m.lo = Math.min(m.lo, loc.local); m.hi = Math.max(m.hi, loc.local); }
          else misses.set(loc.kind, { lo: loc.local, hi: loc.local });
        } else {
          this._fillEntryRow(div, loc.kind, row);
        }
      }
      frag.appendChild(div);
    }

    this.sizer.appendChild(frag);
    for (const [kind, { lo, hi }] of misses) this._fetchWindow(kind, lo, hi);
  }

  _fillEntryRow(div, kind, row) {
    div.classList.add('usd-entry-row', 'usd-' + kind);
    const wlEntry = kind === 'rescored' ? row.entry : row;

    const entrySpan = document.createElement('span');
    entrySpan.className = 'usd-entry-col';
    entrySpan.textContent = displayOf(wlEntry);
    div.appendChild(entrySpan);

    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'usd-score-col';
    if (kind === 'rescored') {
      scoreSpan.innerHTML =
        `<span class="usd-old-score">${row.oldScore}</span>` +
        `<span class="usd-arrow">→</span>` +
        buildScoreBadgeHTML(row.score);
    } else {
      scoreSpan.innerHTML = buildScoreBadgeHTML(row.score);
    }
    div.appendChild(scoreSpan);
  }

  async _fetchWindow(kind, lo, hi) {
    if (this.diffId == null || this.pending.has(kind)) return;
    const arr = this.cache.get(kind);
    const start = Math.max(0, lo - VS_BUFFER);
    const end   = Math.min(arr.length, hi + VS_BUFFER + 1);
    this.pending.add(kind);
    const res = await fetchWorkerDiffRows(this.diffId, kind, start, end);
    this.pending.delete(kind);
    if (!res) return;   // timeout/dropped — shimmer stays; a re-scroll re-requests
    for (let i = 0; i < res.rows.length; i++) arr[res.start + i] = res.rows[i];
    this._render();
  }
}

export const openUpdateSummaryDialog = (() => {
  let el, titleEl, countEl, pillsEl, scrollEl, scroller;
  // The diffId the open dialog currently owns; its close frees this one. Reusing an
  // already-open dialog (a second fetch racing the first) swaps content in place and
  // frees the displaced diff here — never close()+showModal(), whose queued close
  // event would let a once-listener fire against the wrong diff.
  let ownedDiffId = null;

  // Counts are the TRUE totals (addedCount/…); `added`/`deleted`/`rescored` are the
  // worker's inline first-window samples (≤ DIFF_SHIP_CAP). Headers and pills read the
  // counts; the scroller seeds its cache from the samples and fetches the rest.
  const show = function(wordlist, { oldCount, newCount, added, deleted, rescored, addedCount, deletedCount, rescoredCount, diffId }) {
    const wasOpen = el.open;
    if (wasOpen) sendFreeDiff(ownedDiffId);
    ownedDiffId = diffId;

    titleEl.textContent = `${wordlist.name} Updated`;
    countEl.textContent = `${oldCount.toLocaleString()} → ${newCount.toLocaleString()} entries`;

    const sections = [];
    if (addedCount)    sections.push({ kind: 'added',    headerLabel: `Added (${addedCount.toLocaleString()})`,       count: addedCount });
    if (deletedCount)  sections.push({ kind: 'deleted',  headerLabel: `Deleted (${deletedCount.toLocaleString()})`,   count: deletedCount });
    if (rescoredCount) sections.push({ kind: 'rescored', headerLabel: `Rescored (${rescoredCount.toLocaleString()})`, count: rescoredCount });

    pillsEl.innerHTML = '';
    const pillDefs = [
      { kind: 'added',    label: `${addedCount.toLocaleString()} added`,       cls: 'usd-pill-added'    },
      { kind: 'deleted',  label: `${deletedCount.toLocaleString()} deleted`,   cls: 'usd-pill-deleted'  },
      { kind: 'rescored', label: `${rescoredCount.toLocaleString()} rescored`, cls: 'usd-pill-rescored' },
    ];
    for (const { kind, label, cls } of pillDefs) {
      if (!sections.some(s => s.kind === kind)) continue;
      const btn = document.createElement('button');
      btn.className = 'usd-pill ' + cls;
      btn.textContent = label;
      btn.onclick = () => scroller.scrollToIndex(scroller.headerIndexFor(kind));
      pillsEl.appendChild(btn);
    }

    scrollEl.innerHTML = '';
    scroller = new UpdateSummaryScroller(scrollEl);
    scroller.setLayout(diffId, sections, { added, deleted, rescored });

    if (!wasOpen) showDialog(el, () => { sendFreeDiff(ownedDiffId); ownedDiffId = null; });
  };
  show.ownedDiffId = () => ownedDiffId;
  show.mount = () => {
    el = document.createElement('dialog');
    el.id = 'update-summary-dialog';
    el.setAttribute('aria-labelledby', 'update-summary-title');
    document.body.appendChild(el);
    el.innerHTML = `
      <button class="dialog-close-btn" aria-label="Close">✕</button>
      <div class="usd-header">
        <h2 id="update-summary-title"></h2>
        <div class="usd-count" id="update-summary-count"></div>
        <div class="usd-pills" id="update-summary-pills"></div>
      </div>
      <div class="usd-scroll" id="update-summary-scroll"></div>`;
    titleEl   = el.querySelector('#update-summary-title');
    countEl   = el.querySelector('#update-summary-count');
    pillsEl   = el.querySelector('#update-summary-pills');
    scrollEl  = el.querySelector('#update-summary-scroll');
    enableDismissClicks(el);
  };
  return show;
})();
