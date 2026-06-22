'use strict';

// ─── Help dialog ──────────────────────────────────────────────────────────────

import { WORDLIST_PUBLISHERS, MERGED_NAME } from '../../core/constants.js';
import { esc, pluralize } from '../../core/util.js';
import { getBrowser } from '../../core/platform.js';
import { FEATURED_TOOLS, TOOLS } from '../../engine/tools.js';
import { mergedEntryCount } from '../../data/merge.js';
import { buildIconHTML, colorSeed, getMergedIcon } from '../icons.js';
import { buildToolCardHTML } from '../tool-stack.js';
import { buildScoreOptions } from '../entries-table.js';
import { createDialog, showDialog } from './dialog.js';

function mergeDiagram() {
  const byPop = [...WORDLIST_PUBLISHERS].sort((a, b) => a.popularity - b.popularity);
  const sourceIcons = byPop.map(p => buildIconHTML(p.icon, p.name, colorSeed(p))).join('');
  return `<div class="faq-diagram faq-diagram--merge">
      <div class="faq-merge-sources">${sourceIcons}</div>
      <svg class="faq-merge-arrow" width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M2 2l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="faq-merge-all">
        <div class="faq-merge-all-head">${getMergedIcon()}<span class="faq-merge-all-name">${MERGED_NAME}</span></div>
        <span class="faq-merge-count">${pluralize(mergedEntryCount(), 'entry', 'entries')}</span>
      </div>
    </div>`;
}

function syncDiagram() {
  return `<div class="faq-diagram faq-diagram--sync">
      <svg class="faq-sync-icon" aria-hidden="true"><use href="#${getBrowser().icon}"/></svg>
      <span class="faq-sync-arrow">⇄</span>
      <span class="faq-sync-emoji">📄</span>
      <span class="faq-sync-arrow">⇄</span>
      <svg class="faq-sync-icon" aria-hidden="true"><use href="#icon-crossword"/></svg>
    </div>`;
}

function toolsDiagram() {
  const cards = FEATURED_TOOLS.map(k => TOOLS[k] ? buildToolCardHTML(k, TOOLS[k], { allButton: false }) : '').join('');
  return `<div class="faq-diagram faq-diagram--tools" inert><div class="faq-tools-strip">${cards}</div></div>`;
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

const SECTIONS = [
  {
    title: 'What even is this?',
    items: [
      {
        q: 'Is this a wordlist manager, a search tool, or what?',
        a: `
          <p>Both, really. It's two things sharing one screen.</p>
          <p>The first is a wordlist <em>manager</em>. You probably already use a wordlist or three (XWI, Spread the Wordlist, Broda, your own), each scored on its own private scale. Grawlix rescales them onto one common scale and merges them into a single deduped list, which you download (or sync) and feed to your construction software. That's the bread and butter.</p>
          <p>The second is a word-finding <em>playground</em>. That same merged list is right there to search and slice, and you can stack tools on it (anagrams, rhymes, beheadments, rebus forms, a couple dozen more) to mine for theme ideas, or just shake loose the one entry that fits a stubborn corner.</p>`,
      },
      {
        q: 'Do I need an account? Where does my stuff live?',
        a: `
          <p>No account, no login, nothing to sign into, and no Grawlix server holding your data either. Your wordlists, your edits, and your settings live entirely in your browser, on this device.</p>
          <p>That's the privacy upside: I can't see your lists, because they never leave your machine. It's also the catch worth knowing. Your data is tied to this one browser on this one computer, so if you clear your browser storage, it's gone. Keep a copy: every list has a <strong>Download</strong> button, and if you want something more hands-off, disk sync keeps a live file on your drive (and, through a cloud drive, on your other computers too).</p>`,
      },
    ],
  },
  {
    title: 'Rescoring & merging',
    items: [
      {
        q: `What's "rescoring," and why should I care?`,
        a: `
          <p>Different wordlists score on different scales. XWI is usable from 25-60 but STWL is dangerous below 50. Broda and Nediger run top out at 100. Mashing the lists together and sorting by score just gives you nonsense.</p>
          <p>Rescoring fixes that. For each list you write a few rules that translate its scores onto one shared scale, so a 50 is a 50 no matter which list it came from.</p>
          <p>The good news is you don't have to fiddle with any of this if you don't want to. Grawlix ships with opinionated defaults for the four big wordlists, so out of the box they're already aligned. You only crack open the rules when you import your own list, or you decide one of my defaults got something wrong. (And if you don't care about scores at all, you can skip rescoring entirely. See <em>Do I have to rescore anything?</em>)</p>
          <p>Pop open the <strong>Rescoring</strong> panel on any wordlist if you want to change the rules.</p>`,
      },
      {
        q: 'What do the score colors and tiers mean?',
        a: `
          <p>Scores show up as colored badges, and the color is the tier. Out of the box: <strong>great</strong> (60+), <strong>good</strong> (50+), <strong>fair</strong> (40+), <strong>meh</strong> (30+), <strong>bad</strong> (below 30). Hover any badge, whether in the table, the edit popover, or the tier picker, and it names the tier.</p>
          <p>Don't like the cutoffs or the labels? They're yours. Switch to All Wordlists and open <strong>Scoring</strong> to rename a tier or move a line. It's optional decoration, though. Unlabeled scores still display fine, you just won't get a name on hover.</p>`,
      },
      {
        q: 'How do I rescore entries?',
        a: () => {
          const maxDigit = Math.max(0, ...buildScoreOptions().map(o => o.hint).filter(h => h != null));
          const shortcuts = maxDigit > 0 ? `<kbd>Alt</kbd>+<kbd>0</kbd> through <kbd>Alt</kbd>+<kbd>${maxDigit}</kbd>` : 'Alt+<kbd>0</kbd>';
          return `
          <p>Click an entry's <em>score</em> to pop up a score picker and change it to one of the predefined tiers. Want to save a click? Use ${shortcuts} to do it in one key press. You needn't open the picker at all, just hover a score badge and press one of the shortcuts. Point, press, on to the next one.</p>
          <p>Want a score that isn't one of your tiers, or to fix a comment or rename the entry? Click the entry's <em>text</em> instead for the full editor.</p>`;
        },
      },
      {
        q: `What is "All Wordlists"?`,
        a: () => `
          <p>It's the headline view: every wordlist you've enabled, rescored onto the common scale and merged into one deduped list. It's what you're looking at by default, and it's what you download or sync and hand to your construction software.</p>
          ${mergeDiagram()}
          <p>When the same word shows up in several lists, the highest-priority list that has it wins. Priority is just the order your lists sit in, which you set under <strong>Manage wordlists</strong>. Search, the tools, the histogram, all of it runs against this merged view unless you deliberately switch to a single list.</p>`,
      },
      {
        q: `What is "My Edits"?`,
        a: `
          <p>My Edits is your personal layer, created for you automatically the first time you open Grawlix. Any time you change a score, fix a comment, rename an entry, or add a word, it lands here, never in the original wordlist.</p>
          <p>That's deliberate. The source lists stay pristine. They update from their authors, and you don't want your edits clobbered when they do.</p>`,
      },
    ],
  },
  {
    title: 'Disk sync',
    items: [
      {
        q: 'What is disk sync, and why do I want it?',
        a: () => `
          <p>Grawlix keeps everything in your browser. Disk sync adds a bridge: it ties one of your lists to one file on your hard drive (ideally the exact file your construction software already loads) and keeps the two matched automatically.</p>
          ${syncDiagram()}
          <p>Why bother? Without it, every time you rescore a word you'd re-download the merged list and re-import it into your grid software by hand. With sync, you edit in Grawlix and the file just updates underneath. Two flavors, depending on the list:</p>
          <ul>
            <li><strong>All Wordlists and individual sources sync one way.</strong> Grawlix writes the file, your software reads it. Point your software at All Wordlists for the unified list.</li>
            <li><strong>My Edits syncs both ways.</strong> Edit it in Grawlix or in your software and the two reconcile. It's the file your software both reads and writes.</li>
          </ul>
          <p>Heads up: disk sync needs a Chromium desktop browser. See <em>Why don't I see a sync button?</em></p>`,
      },
      {
        q: 'How do I set it up?',
        a: `
          <p>Switch to the list you want, then click on <strong>Sync to disk</strong>. Pick an existing file on your computer, or create a new one. That's it.</p>
          <p>Changes you make will be written to that file automatically. If your construction software reads from there, changes you make in Grawlix will show up when gridding. It's that easy.</p>`
      },
      {
        q: 'Can I use the same wordlist across two computers?',
        a: `
          <p>Yes, with a little help from a cloud drive. Grawlix itself ships zero cloud code; your data is per-browser. But disk sync points at a <em>file</em>, and if that file lives in Dropbox, iCloud Drive, OneDrive, or Google Drive, your cloud client shuttles it between machines for you. On each computer, sync the same list to that same file.</p>`,
      },
      {
        q: `Why don't I see a sync button, or why is it grayed out?`,
        a: `
          <p>Disk sync rides on a browser feature called the File System Access API, and today only Chromium desktop browsers have it: Chrome, Edge, Brave, Arc, and the like. So where you are decides what you get:</p>
          <ul>
            <li>On a phone or tablet, there's no sync button at all. Keeping a file in sync just isn't something a mobile browser can do, so I don't show a control that can't work.</li>
            <li>In Firefox or Safari on the desktop, the <strong>Sync to disk</strong> button is there, but clicking it just explains that sync needs a Chromium browser. Sorry, my hands are tied.</li>
          </ul>
          <p>Either way, you're not stuck. <strong>Download</strong> works everywhere and hands you the same file to load into your software, you just do it by hand instead of automatically.</p>`,
      },
    ],
  },
  {
    title: 'Tools & chaining',
    items: [
      {
        q: `What's the ✱ "all-mode" button for?`,
        a: `
          <p>A lot of tools take an input string. Anagram takes a word to rearrange, Letter bank takes a set of letters, Rhymes takes a word to rhyme with. Normally you hand it one input and get back that input's results.</p>
          <p>The <strong>✱</strong> button runs the tool over every possible input at once and shows all the results together. Instead of the anagrams of one word, you get every set of anagrams in your list; instead of the rhymes for one word, every rhyme family. Each group comes back as its own row, with a count and its members.</p>
          <p>Tools that can do this wear a small ✱ in the corner of their gallery card. Click the ✱ on the tool's input in your stack to toggle it on. Only one tool can be in all-mode at a time.</p>`,
      },
      {
        q: `What's the deal with stacking tools?`,
        a: () => `
          <p>Tools chain. The gallery sits at the top of the screen; click a tool's card and it drops onto a <strong>stack</strong>. Click another and it stacks below. The stack runs top to bottom like a pipeline: the first tool reads whatever you're looking at (usually All Wordlists), and each tool after it works on the output of the one above. Search is always pinned as the last step.</p>
          ${toolsDiagram()}
          <p>So you can type a set of letters into <strong>Anagram</strong>, then type a few known crossing letters in the search bar to narrow the anagrams down, live, to the ones that actually fit. The search filters Anagram's output as you type. Drag a row by its handle to reorder the pipeline, or hit the ✕ to drop a tool. Stacking is what turns a pile of one-trick tools into combinations.</p>
          <p>What's that good for? Heck if I know. Try it, let me know what you come up with.</p>`,
      },
    ],
  },
  {
    title: 'Other',
    items: [
      {
        q: 'Who can I thank for this?',
        a: () => `
          <p>Grawlix is made with ♥ by John Kugelman. Got feedback? <a href="mailto:john@kugelman.name?subject=Grawlix">E-mail me</a>.</p>
          <p>It would be useless without other people's wordlists. Thank you to the constructors who make and share them:</p>
          <ul class="acks-list">${wordlistCreditsHTML()}</ul>
          <p>The tools are heavily inspired by <a href="https://aaronson.org/wordlisted/" target="_blank" rel="noopener">Wordlisted</a> by Adam Aaronson. Kudos to Adam for putting wordlist searching in everyone's hands.</p>`,
      },
    ],
  },
];

export const HelpDialog = (() => {
  let el, body;

  function mount() {
    ({ el, body } = createDialog('help-dialog', { labelledby: 'help-title' }));
  }

  function sectionHTML(section) {
    const items = section.items.map(it => {
      const answer = typeof it.a === 'function' ? it.a() : it.a;
      return `<details class="faq-item"><summary>${it.q}</summary><div class="faq-answer">${answer}</div></details>`;
    }).join('');
    return `<section class="faq-section"><h3>${section.title}</h3>${items}</section>`;
  }

  function render() {
    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="help-title">Help</h2>
      ${SECTIONS.map(sectionHTML).join('')}
      <div class="dialog-footer">
        <button type="button" class="primary dialog-cancel-btn">Done</button>
      </div>`;
  }

  // The dialog mirrors the #/help hash so it's deep-linkable: closing strips the
  // hash, and the boot/hashchange sync (in actions) drives open/close from it.
  function clearHash() {
    if (location.hash === '#/help') history.replaceState(null, '', location.pathname + location.search);
  }

  function open() {
    if (el.open) return;
    render();
    showDialog(el, clearHash);
  }

  return {
    mount,
    open,
    close: () => el.close(),
    isOpen: () => el.open,
  };
})();
