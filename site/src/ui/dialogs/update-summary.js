'use strict';

// ─── Update summary dialog ──────────────────────────────────────────────────────

import { ROW_HEIGHT, VS_BUFFER } from '../../core/constants.js';
import { displayOf } from '../../engine/norm.js';
import { buildScoreBadgeHTML } from '../../model/score-display.js';
import { showDialog, enableDismissClicks } from './dialog.js';

class UpdateSummaryScroller {
  constructor(container) {
    this.container = container;
    this.rows = [];

    this.sizer = document.createElement('div');
    this.sizer.className = 'usd-sizer';
    container.appendChild(this.sizer);

    container.addEventListener('scroll', () => this._render(), { passive: true });
    new ResizeObserver(() => this._render()).observe(container);
  }

  setRows(rows) {
    this.rows = rows;
    this.sizer.style.height = (rows.length * ROW_HEIGHT) + 'px';
    this.container.scrollTop = 0;
    this._render();
  }

  scrollToIndex(i) {
    this.container.scrollTop = i * ROW_HEIGHT;
  }

  _render() {
    const n = this.rows.length;
    const scrollTop = this.container.scrollTop;
    const viewH = this.container.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VS_BUFFER);
    const end   = Math.min(n, Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + VS_BUFFER);

    this.sizer.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
      const row = this.rows[i];
      const div = document.createElement('div');
      div.className = 'usd-row';
      div.style.top = (i * ROW_HEIGHT) + 'px';

      if (row.type === 'header') {
        div.classList.add('usd-section-header');
        div.textContent = row.label;
      } else {
        div.classList.add('usd-entry-row', 'usd-' + row.kind);

        const entrySpan = document.createElement('span');
        entrySpan.className = 'usd-entry-col';
        entrySpan.textContent = row.display;
        div.appendChild(entrySpan);

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'usd-score-col';
        if (row.kind === 'rescored') {
          scoreSpan.innerHTML =
            `<span class="usd-old-score">${row.oldScore}</span>` +
            `<span class="usd-arrow">→</span>` +
            buildScoreBadgeHTML(row.score);
        } else {
          scoreSpan.innerHTML = buildScoreBadgeHTML(row.score);
        }
        div.appendChild(scoreSpan);
      }

      frag.appendChild(div);
    }

    this.sizer.appendChild(frag);
  }
}

let _updateScroller = null;

export const openUpdateSummaryDialog = (() => {
  let el, titleEl, countEl, pillsEl, scrollEl;

  const show = function(wordlist, oldCount, added, deleted, rescored) {
    titleEl.textContent = `${wordlist.name} Updated`;
    countEl.textContent = `${oldCount.toLocaleString()} → ${wordlist.rawEntries.length.toLocaleString()} entries`;

    const rows = [];
    const sectionIndices = {};

    if (added.length) {
      sectionIndices.added = rows.length;
      rows.push({ type: 'header', label: `Added (${added.length.toLocaleString()})` });
      for (const e of added) rows.push({ type: 'entry', display: displayOf(e), score: e.score, kind: 'added' });
    }
    if (deleted.length) {
      sectionIndices.deleted = rows.length;
      rows.push({ type: 'header', label: `Deleted (${deleted.length.toLocaleString()})` });
      for (const e of deleted) rows.push({ type: 'entry', display: displayOf(e), score: e.score, kind: 'deleted' });
    }
    if (rescored.length) {
      sectionIndices.rescored = rows.length;
      rows.push({ type: 'header', label: `Rescored (${rescored.length.toLocaleString()})` });
      for (const e of rescored) rows.push({ type: 'entry', display: displayOf(e.entry), score: e.score, kind: 'rescored', oldScore: e.oldScore });
    }

    pillsEl.innerHTML = '';
    const pillDefs = [
      { key: 'added',    label: `${added.length.toLocaleString()} added`,    cls: 'usd-pill-added'   },
      { key: 'deleted',  label: `${deleted.length.toLocaleString()} deleted`,  cls: 'usd-pill-deleted'  },
      { key: 'rescored', label: `${rescored.length.toLocaleString()} rescored`, cls: 'usd-pill-rescored' },
    ];
    for (const { key, label, cls } of pillDefs) {
      if (sectionIndices[key] == null) continue;
      const btn = document.createElement('button');
      btn.className = 'usd-pill ' + cls;
      btn.textContent = label;
      btn.onclick = () => _updateScroller.scrollToIndex(sectionIndices[key]);
      pillsEl.appendChild(btn);
    }

    scrollEl.innerHTML = '';
    _updateScroller = new UpdateSummaryScroller(scrollEl);
    _updateScroller.setRows(rows);

    showDialog(el);
  };
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
