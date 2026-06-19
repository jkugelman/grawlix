'use strict';

// ─── FAQ dialog ───────────────────────────────────────────────────────────────

import { createDialog, showDialog } from './dialog.js';

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
        q: `What is "All Wordlists"?`,
        a: `
          <p>It's the headline view: every wordlist you've enabled, rescored onto the common scale and merged into one deduped list. It's what you're looking at by default, and it's what you download or sync and hand to your construction software.</p>
          <p>When the same word shows up in several lists, the highest-priority list that has it wins. Priority is just the order your lists sit in, which you set under <strong>Manage wordlists</strong>. Search, the tools, the histogram, all of it runs against this merged view unless you deliberately switch to a single list.</p>`,
      },
      {
        q: `What is "My Edits"?`,
        a: `
          <p>My Edits is your personal layer, created for you automatically the first time you open Grawlix. Any time you change a score, fix a comment, rename an entry, or add a word, it lands here, never in the original wordlist.</p>
          <p>That's deliberate. The source lists stay pristine. They update from their authors, and you don't want your edits clobbered when they do.</p>`,
      },
      {
        q: 'What do the score colors and tiers mean?',
        a: `
          <p>Scores show up as colored badges, and the color is the tier. Out of the box: <strong>great</strong> (60+), <strong>good</strong> (50+), <strong>fair</strong> (40+), <strong>meh</strong> (30+), <strong>bad</strong> (below 30). Hover any badge, whether in the table, the edit popover, or the tier picker, and it names the tier.</p>
          <p>Don't like the cutoffs or the labels? They're yours. Switch to All Wordlists and open <strong>Scoring</strong> to rename a tier or move a line. It's optional decoration, though. Unlabeled scores still display fine, you just won't get a name on hover.</p>`,
      },
    ],
  },
  {
    title: 'Disk sync',
    items: [
      {
        q: 'What is disk sync, and why do I want it?',
        a: `
          <p>Grawlix keeps everything in your browser. Disk sync adds a bridge: it ties one of your lists to one file on your hard drive (ideally the exact file your construction software already loads) and keeps the two matched automatically.</p>
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
          <p>Switch to the list you want, then click on <strong>Sync to disk</strong>. Wherever you are, you get the same two doors:</p>
          <ul>
            <li><strong>Use an existing file</strong> (a one-way list calls it <strong>Overwrite an existing file</strong>) points sync at a file you already have, ideally the exact one your construction software reads. For My Edits, Grawlix loads it in and keeps both sides matched. For All Wordlists or a single source, it overwrites that file with the rescored output.</li>
            <li><strong>Create a new file</strong> starts a fresh one to write to.</li>
          </ul>
          <p>That's it. Once connected, the button becomes a <strong>Synced to <em>filename</em></strong> pill. Click it again any time to open the dialog and <strong>Turn off</strong> sync, which disconnects but leaves the file on disk untouched.</p>`,
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
        a: `
          <p>Tools chain. The gallery sits at the top of the screen; click a tool's card and it drops onto a <strong>stack</strong>. Click another and it stacks below. The stack runs top to bottom like a pipeline: the first tool reads whatever you're looking at (usually All Wordlists), and each tool after it works on the output of the one above. Search is always pinned as the last step.</p>
          <p>So you can type a set of letters into <strong>Anagram</strong>, then type a few known crossing letters in the search bar to narrow the anagrams down, live, to the ones that actually fit. The search filters Anagram's output as you type. Drag a row by its handle to reorder the pipeline, or hit the ✕ to drop a tool. Stacking is what turns a pile of one-trick tools into combinations.</p>
          <p>What's that good for? Heck if I know. Try it, let me know what you come up with.`,
      },
    ],
  },
];

export const FaqDialog = (() => {
  let el, body;

  function mount() {
    ({ el, body } = createDialog('faq-dialog', { labelledby: 'faq-title' }));
  }

  function sectionHTML(section) {
    const items = section.items
      .map(it => `<details class="faq-item"><summary>${it.q}</summary><div class="faq-answer">${it.a}</div></details>`)
      .join('');
    return `<section class="faq-section"><h3>${section.title}</h3>${items}</section>`;
  }

  function render() {
    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="faq-title">FAQ</h2>
      ${SECTIONS.map(sectionHTML).join('')}
      <div class="dialog-footer">
        <button type="button" class="primary dialog-cancel-btn">Done</button>
      </div>`;
  }

  function open() {
    render();
    showDialog(el);
  }

  return { mount, open };
})();
