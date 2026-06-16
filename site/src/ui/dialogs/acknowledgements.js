'use strict';

// ─── Acknowledgements dialog ──────────────────────────────────────────────────

import { WORDLIST_PUBLISHERS } from '../../core/constants.js';
import { esc } from '../../core/util.js';
import { buildIconHTML, colorSeed } from '../icons.js';
import { createDialog, showDialog } from './dialog.js';

export const AcknowledgementsDialog = (() => {
  let el, body;

  function mount() {
    ({ el, body } = createDialog('acknowledgements-dialog', { labelledby: 'acks-title' }));
  }

  function wordlistCreditsHTML() {
    return [...WORDLIST_PUBLISHERS]
      // John's own list — Grawlix's author, not a third party.
      .filter(p => p.id !== 'jkugelman')
      .sort((a, b) => a.popularity - b.popularity)
      .map(p => {
        const icon = buildIconHTML(p.icon, p.name, colorSeed(p));
        const name = p.homepage
          ? `<a href="${p.homepage}" target="_blank" rel="noopener">${esc(p.name)}</a>`
          : esc(p.name);
        const byline = p.author ? `<span class="acks-credit-by">by ${esc(p.author)}</span>` : '';
        return `<li class="acks-credit">${icon}<div class="acks-credit-text"><span>${name}</span>${byline}</div></li>`;
      })
      .join('');
  }

  function render() {
    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="acks-title">Acknowledgements</h2>

      <section class="acks-section">
        <h3>Wordlists</h3>
        <p>Thank you to the constructors who built and shared these, the raw data Grawlix feeds on:</p>
        <ul class="acks-list">${wordlistCreditsHTML()}</ul>
      </section>

      <section class="acks-section">
        <h3>Inspiration</h3>
        <p>The tool gallery owes a debt to <a href="https://aaronson.org/wordlisted/" target="_blank" rel="noopener">Wordlisted</a> by Adam Aaronson. Kudos to Adam for democratizing wordlist searching, bringing scripting to the masses.</p>
      </section>

      <div class="dialog-footer">
        <button type="button" class="primary dialog-cancel-btn" autofocus>Done</button>
      </div>`;
  }

  function open() {
    render();
    showDialog(el);
  }

  return { mount, open };
})();
