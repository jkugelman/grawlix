'use strict';

// ─── Discovery banner ───────────────────────────────────────────────────────

import { MERGED_ID } from '../core/constants.js';
import { isMobile } from '../core/platform.js';
import { state } from '../data/state.js';
import { lsSave, lsLoad } from '../data/storage.js';

// The import action lives upward (main.js, WordlistActions); injected so this
// view imports nothing above ui. Unlike the on*= menu handlers, this is a direct
// JS call from the banner's click listener, so it can't route through `window`.
let _import = () => {};

export function configureDiscoveryBanner({ runImport }) {
  if (runImport) _import = runImport;
}

// A plain sibling under #wordlist-bar, deliberately NOT mounted inside it: the
// bar is sticky, so a dismissable one-time notice nested in it would permanently
// eat pinned height via the --wordlist-bar-h cascade instead of scrolling away.
const MYEDITS_KEY = 'banner_myedits_dismissed';

export const DiscoveryBanner = (() => {
  let el;

  const BANNERS = [
    {
      key: MYEDITS_KEY,
      when: scope => scope !== MERGED_ID && scope?.type === 'edits',
      body: 'This is <strong>My Edits</strong> — your own corrections and additions, and they win over every other list. Already keep a word list of your own? Import it and it lands right here.',
    },
    {
      // XWI is paywalled, so Grawlix ships only its default scores, never the
      // list itself — gate on !populated so the nudge stops once a subscriber
      // has brought their real copy in.
      key: 'banner_xwi_dismissed',
      when: scope => scope !== MERGED_ID && scope?.publisherId === 'xwi' && !scope.populated,
      body: 'Got an <strong>XWord Info</strong> subscription? Import your XWI list here to add it to your searches.',
    },
  ];

  function pick() {
    if (isMobile()) return null;
    return BANNERS.find(b => b.when(state.selected) && lsLoad(b.key) !== '1') || null;
  }

  function hide() {
    el.hidden = true;
    el.innerHTML = '';
    el.dataset.banner = '';
  }

  function dismiss(key) {
    lsSave(key, '1');
    if (el?.dataset.banner === key) hide();
  }

  function refresh() {
    const banner = pick();
    if (!banner) { hide(); return; }
    if (el.dataset.banner === banner.key) return;   // already showing this one
    el.dataset.banner = banner.key;
    el.innerHTML = `
      <p>${banner.body}</p>
      <div class="discovery-banner-actions">
        <button type="button" class="discovery-banner-import primary">Import</button>
        <button type="button" class="discovery-banner-close" aria-label="Dismiss">✕</button>
      </div>`;
    el.hidden = false;
  }

  function mount() {
    el = document.createElement('div');
    el.id = 'discovery-banner';
    el.hidden = true;
    document.getElementById('featured-row').before(el);

    el.addEventListener('click', e => {
      if (e.target.closest('.discovery-banner-close')) {
        if (el.dataset.banner) dismiss(el.dataset.banner);
        return;
      }
      if (e.target.closest('.discovery-banner-import')) {
        _import();
      }
    });
  }

  return { mount, refresh, dismissMyEdits: () => dismiss(MYEDITS_KEY) };
})();
