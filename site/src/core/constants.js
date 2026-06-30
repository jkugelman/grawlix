'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ROW_HEIGHT   = 24;
export const VS_BUFFER    = 60;
// Duplicated in the <head> FOUC script on purpose: that script must run before
// first paint, so it can't import a shared binding from this deferred module.
export const LS_PREFIX    = 'grawlix_';
export const MERGED_ID    = '__merged__';
export const MERGED_NAME  = 'All Wordlists';
export const EDITS_ICON   = { type: 'emoji', value: '✏️' };

export const INITIALS_PALETTE = [
  '#5C6BC0', '#1E88E5', '#00ACC1', '#00897B',
  '#43A047', '#FB8C00', '#E53935', '#D81B60',
  '#8E24AA', '#5E35B1', '#3949AB', '#0277BD',
];

export const EMOJI_LIST = [
       '🥇','🏅','💫','✨','🔥','💎','👑',
  '🏆','🎯','🎲','🎪','🎭','🎨','🎵','🎬',
  '🎮','📖','📝','✏️','🔑','💡','🔮','🧩',
  '🦁','🐻','🦊','🐺','🦄','🐉','🦅','🦋',
  '🌊','🌈','🌙','☀️','⚡','🍀','🌸','🌺',
  '🚀','🛸','🧠','👾','🤖','👻','😎','🤓',
  '❤️','💜','💙','💚','💛','🧡','🖤','🤍',
];

export const WORDLIST_PUBLISHERS = [
  {
    id: 'jkugelman',
    popularity: 5,
    name: 'John Kugelman',
    url: 'https://raw.githubusercontent.com/jkugelman/wordlist/refs/heads/main/jkugelman-wordlist.txt',
    icon: null,
    defaultRules: [
      { input:'60', length:'', output:'', note:'Good (colorful phrases, interesting full names)' },
      { input:'50', length:'', output:'', note:'Average (dictionary words)' },
      { input:'40', length:'', output:'', note:'Okay in moderation (proper names, abbreviations, prepositional phrases)' },
      { input:'30', length:'', output:'', note:'Not good (crosswordese, plural names, contrived inflections)' },
      { input:'20', length:'', output:'', note:'Junk (partials, variant spellings, Roman numerals)' },
      { input:'10', length:'', output:'', note:'Offensive' },
      { input:'0',  length:'', output:'', note:'Gibberish' },
    ],
  },
  {
    id: 'xwi',
    popularity: 2,
    name: 'XWord Info',
    author: 'Jim Horne & Jeff Chen',
    url: null,
    sourcePage: 'https://www.xwordinfo.com/WordList',
    sourceNote: 'Sign in and download the <strong>plain-text (.txt)</strong> version.',
    subscriptionNote: 'XWord Info\'s wordlist requires a paid subscription.',
    homepage: 'https://www.xwordinfo.com/WordList',
    icon: { type: 'img', url: 'https://www.xwordinfo.com/favicon.ico' },
    defaultRules: [
      { input:'60', length:'', output:'',   note:'Entries considered "assets" to a puzzle' },
      { input:'50', length:'', output:'',   note:'Fine entries' },
      { input:'30', length:'', output:'',   note:'' },
      { input:'25', length:'', output:'30', note:'Partials, odd abbreviations, very esoteric names, short Roman numerals, etc.' },
      { input:'20', length:'', output:'20', note:'Five-letter entries that would be hard to defend as fine' },
      { input:'15', length:'', output:'20', note:'Random Roman numerals that are longer than three letters' },
      { input:'10', length:'', output:'20', note:'' },
      { input:'5',  length:'', output:'20', note:'Entries that Will Shortz or other editors have identified as "puzzle-killers"' },
    ],
  },
  {
    id: 'nediger',
    popularity: 3,
    name: 'Will Nediger',
    url: 'https://grawlix.wtf/wordlists/Nediger list.txt',
    homepage: 'https://github.com/bewilderingly/Nediger-list/',
    icon: null,
    defaultRules: [
      { input:'99', length:'1-2', output:'40', note:'Short fill', scoring:false },
      { input:'51', length:'1-2', output:'30', note:'Short fill', scoring:false },
      { input:'25', length:'1-2', output:'20', note:'Short fill', scoring:false },
      { input:'99', length:'8+',  output:'60', note:'Asset' },
      { input:'99', length:'',    output:'50', note:'Good for any venue' },
      { input:'51', length:'',    output:'50', note:'Decent to good' },
      { input:'49', length:'',    output:'10', note:'Racy' },
      { input:'25', length:'',    output:'40', note:'Not great' },
    ],
  },
  {
    id: 'stwl',
    popularity: 1,
    name: 'Spread the Word(list)',
    author: 'Brooke Husic & Enrique Henestroza Anguiano',
    url: 'https://grawlix.wtf/wordlists/spreadthewordlist.txt',
    homepage: 'https://www.spreadthewordlist.com',
    icon: { type: 'img', url: 'https://www.spreadthewordlist.com/favicon.ico' },
    defaultRules: [
      { input:'50', length:'', output:'50', note:'Clean' },
      { input:'40', length:'', output:'30', note:'Dubious'},
      { input:'30', length:'', output:'20', note:'Dubious'},
      { input:'20', length:'', output:'0',  note:'Dubious'},
      { input:'10', length:'', output:'0',  note:'Dubious'},
      { input:'0',  length:'', output:'10', note:'Offensive'},
    ],
  },
  {
    id: 'broda',
    popularity: 4,
    name: 'Peter Broda',
    url: 'https://grawlix.wtf/wordlists/peter-broda-wordlist.txt',
    homepage: 'http://www.peterbroda.me/crosswords/wordlist/',
    icon: null,
    defaultRules: [
      { input:'76-100', length:'7+', output:'60',     scoring:false },
      { input:'0-100',  length:'',   output:'20' },
    ],
  },
];

// Not a SCHEMA_VERSION bump: that counter tracks stored *shape*, and a relocated
// file is the same shape with a drifted value. See docs/migration.md § Remapping moved URLs.
export const URL_REMAPS = [
  { from: 'https://grawlix.wtf/Nediger list.txt',         to: 'https://grawlix.wtf/wordlists/Nediger list.txt' },
  { from: 'https://grawlix.wtf/spreadthewordlist.txt',    to: 'https://grawlix.wtf/wordlists/spreadthewordlist.txt' },
  { from: 'https://grawlix.wtf/peter-broda-wordlist.txt', to: 'https://grawlix.wtf/wordlists/peter-broda-wordlist.txt' },
  { from: 'https://raw.githubusercontent.com/jkugelman/crossword/refs/heads/main/wordlists/jkugelman-wordlist.txt',
    to:   'https://raw.githubusercontent.com/jkugelman/wordlist/refs/heads/main/jkugelman-wordlist.txt' },
];

// Derived from JK's rules, not duplicated: the unified scale IS JK's scoring
// scheme (its rescore rules are canonical).
export const DEFAULT_SCORING = WORDLIST_PUBLISHERS
  .find(p => p.id === 'jkugelman')
  .defaultRules
  .filter(r => r.scoring !== false)
  .map(({ input, note }) => ({ input, note }));

export const SEVERITY_PRIORITY = { info: 1 };
