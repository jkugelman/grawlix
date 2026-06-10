'use strict';

// ─── Welcome dialog ───────────────────────────────────────────────────────────

import { WORDLIST_PUBLISHERS, MERGED_NAME } from '../../core/constants.js';
import { pluralize } from '../../core/util.js';
import { isMobile } from '../../core/platform.js';
import { effect } from '../../core/signals.js';
import { FEATURED_TOOLS, TOOLS } from '../../engine/tools.js';
import { sources$, cacheVersion$ } from '../../data/state.js';
import { lsSave } from '../../data/storage.js';
import { buildMergedWordlist } from '../../data/merge.js';
import { Disk } from '../../data/disk-sync.js';
import { buildIconHTML, colorSeed, getMergedIcon } from '../icons.js';
import { buildToolCardHTML } from '../tool-stack.js';
import { createDialog, showDialog } from './dialog.js';

export const WelcomeDialog = (() => {
  let el, body;

  function mount() {
    ({ el, body } = createDialog('welcome-dialog', { labelledby: 'welcome-title' }));
    // Without this the All Wordlists count freezes at its open-time snapshot (~0 on a cold boot, before fetches populate the wordlists).
    effect(() => {
      sources$.get();
      cacheVersion$.get();
      if (!el.open) return;
      const count = el.querySelector('.welcome-merge-count');
      if (count) count.textContent = pluralize(buildMergedWordlist().entries.length, 'entry', 'entries');
    });
  }

  function render() {
    const toolsShot = FEATURED_TOOLS
      .map(k => TOOLS[k] ? buildToolCardHTML(k, TOOLS[k], { allButton: false }) : '')
      .join('');

    const featuredToolNames = FEATURED_TOOLS
      .filter(k => TOOLS[k])
      .map(k => TOOLS[k].name)
      .join(', ');

    const byPop = [...WORDLIST_PUBLISHERS].sort((a, b) => a.popularity - b.popularity);
    const names = byPop.map(p => p.name);
    const nameList = `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;

    const sourceIcons = byPop
      .map(p => buildIconHTML(p.icon, p.name, colorSeed(p)))
      .join('');

    const wordlistShot = `
      <div class="welcome-merge-sources">${sourceIcons}</div>
      <svg class="welcome-merge-arrow" width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M2 2l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="welcome-merge-all">
        <div class="welcome-merge-all-head">
          ${getMergedIcon()}
          <span class="welcome-merge-all-name">${MERGED_NAME}</span>
        </div>
        <span class="welcome-merge-count">${pluralize(buildMergedWordlist().entries.length, 'entry', 'entries')}</span>
      </div>`;

    const storageShot = `
      <ul class="welcome-sync-files">
        <li>📄 <strong>My Edits.txt</strong> <span class="welcome-sync-dir">⇄</span> Grawlix</li>
        <li>Grawlix <span class="welcome-sync-dir">→</span> 📄 <strong>${MERGED_NAME} rescored.txt</strong></li>
        <li>Grawlix <span class="welcome-sync-dir">→</span> 📄 Spread the Word(list).txt</li>
      </ul>`;

    const diskCaveat = Disk.isSupported() ? ''
      : isMobile() ? ' (Desktop only)'
      : ' (Chrome only)';

    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="welcome-title">Welcome to Grawlix</h2>

      <section class="welcome-feature">
        <div class="welcome-copy">
          <h3>Hunt for puzzle ideas</h3>
          <p>Comb the beach with ${featuredToolNames}, and a few dozen more tools. Combine them to unlock new wordplay possibilities.</p>
        </div>
        <div class="welcome-shot" inert><div class="welcome-shot-inner welcome-shot-tools">${toolsShot}</div></div>
      </section>

      <section class="welcome-feature">
        <div class="welcome-copy">
          <h3>Search multiple popular wordlists</h3>
          <p>${nameList} are at your fingertips. Grawlix rescores each onto a common scale.</p>
        </div>
        <div class="welcome-shot" inert><div class="welcome-shot-inner welcome-shot-merge">${wordlistShot}</div></div>
      </section>

      <section class="welcome-feature">
        <div class="welcome-copy">
          <h3>Sync with your construction software</h3>
          <p>Point Grawlix at a file you already feed to Ingrid, Crossfire, or Crossword Compiler. Your edits flow both ways, automatically.${diskCaveat}</p>
        </div>
        <div class="welcome-shot" inert><div class="welcome-shot-inner welcome-shot-storage">${storageShot}</div></div>
      </section>

      <div class="dialog-footer">
        <button type="button" class="primary dialog-cancel-btn" autofocus>Get started</button>
      </div>`;
  }

  function open() {
    render();
    showDialog(el, () => lsSave('welcomeSeen', '1'));
  }

  return { mount, open };
})();
