'use strict';

import { scoreQuery } from './util.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ROW_HEIGHT   = 24;
export const VS_BUFFER    = 60;

// Memory ceilings on retained tuples, not UX caps; the device is chosen at boot and
// injected into the worker (configTools), mobile being the safe default. The two pairs
// are calibrated against different per-tuple costs and must not be merged: Umiaq
// retains its whole set at ~1172 B/tuple, Weave streams and packs at 136 B/tuple
// (both measured), so Weave buys more tuples for less peak than Umiaq's smaller cap.
export const TUPLE_CAP_MOBILE  = 100_000;
export const TUPLE_CAP_DESKTOP = 500_000;
export const WEAVE_CAP_MOBILE  = 750_000;
export const WEAVE_CAP_DESKTOP = 2_000_000;
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

// The unified score scale, which is JK's scoring scheme: JK's default rules are
// these tiers verbatim. Plain {input, note} tiers, since core can't parse queries.
export const DEFAULT_SCORING = [
  { input: '60', note: 'Good (colorful phrases, interesting full names)' },
  { input: '50', note: 'Average (dictionary words)' },
  { input: '40', note: 'Okay in moderation (proper names, abbreviations, prepositional phrases)' },
  { input: '30', note: 'Not good (crosswordese, plural names, contrived inflections)' },
  { input: '20', note: 'Junk (partials, variant spellings, Roman numerals)' },
  { input: '10', note: 'Offensive' },
  { input: '0', note: 'Gibberish' },
];

export const WORDLIST_PUBLISHERS = [
  {
    id: 'jkugelman',
    popularity: 5,
    name: 'John Kugelman',
    url: 'https://raw.githubusercontent.com/jkugelman/wordlist/refs/heads/main/jkugelman-wordlist.txt',
    icon: null,
    defaultRules: DEFAULT_SCORING.map(({ input, note }) => ({ query: scoreQuery(input), output: '', note })),
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
      { query:'score: 60', output:'',   note:'Entries considered "assets" to a puzzle' },
      { query:'score: 50', output:'',   note:'Fine entries' },
      { query:'score: 30', output:'',   note:'' },
      { query:'score: 25', output:'30', note:'Partials, odd abbreviations, very esoteric names, short Roman numerals, etc.' },
      { query:'score: 20', output:'20', note:'Five-letter entries that would be hard to defend as fine' },
      { query:'score: 15', output:'20', note:'Random Roman numerals that are longer than three letters' },
      { query:'score: 10', output:'20', note:'' },
      { query:'score: 5',  output:'20', note:'Entries that Will Shortz or other editors have identified as "puzzle-killers"' },
    ],
  },
  {
    id: 'nediger',
    popularity: 3,
    name: 'Will Nediger',
    url: 'https://raw.codeberg.page/bewilderingly/Nediger-list/@main/nediger list.txt',
    homepage: 'https://github.com/bewilderingly/Nediger-list/',
    icon: null,
    defaultRules: [
      { query:'score: 99 and length: 1-2', output:'40', note:'Short fill', scoring:false },
      { query:'score: 51 and length: 1-2', output:'30', note:'Short fill', scoring:false },
      { query:'score: 25 and length: 1-2', output:'20', note:'Short fill', scoring:false },
      { query:'score: 99 and length: 8+',  output:'60', note:'Asset' },
      { query:'score: 99',                 output:'50', note:'Good for any venue' },
      { query:'score: 51',                 output:'50', note:'Decent to good' },
      { query:'score: 49',                 output:'10', note:'Racy' },
      { query:'score: 25',                 output:'40', note:'Not great' },
    ],
  },
  {
    id: 'stwl',
    popularity: 1,
    name: 'Spread the Word(list)',
    author: 'Brooke Husic & Enrique Henestroza Anguiano',
    url: 'https://www.spreadthewordlist.com/downloads/spreadthewordlist_forms.txt',
    homepage: 'https://www.spreadthewordlist.com',
    icon: { type: 'img', url: 'https://www.spreadthewordlist.com/assets/favicon.png' },
    defaultRules: [
      { query:'score: 50+',   output:'50', note:'Clean' },
      { query:'score: 40-49', output:'30', note:'Decent' },
      { query:'score: 30-39', output:'20', note:'Dubious' },
      { query:'score: 1-29',  output:'0',  note:'Dubious' },
      { query:'score: 0',     output:'10', note:'Offensive' },
    ],
  },
  {
    id: 'broda',
    popularity: 4,
    name: 'Peter Broda',
    url: 'https://raw.githubusercontent.com/jkugelman/wordlist/refs/heads/main/peter-broda-wordlist.txt',
    homepage: 'http://www.peterbroda.me/crosswords/wordlist/',
    icon: null,
    defaultRules: [
      { query:'score: 76-100 and length: 7+', output:'60', scoring:false },
      { query:'score: 0-100',                 output:'20' },
    ],
  },
];

// Covers both wordlist urls and image-icon urls. Not a SCHEMA_VERSION bump: that
// counter tracks stored *shape*, and a relocated file is the same shape with a
// drifted value. See docs/migration.md § Remapping moved URLs.
export const URL_REMAPS = [
  {
    to: 'https://raw.codeberg.page/bewilderingly/Nediger-list/@main/nediger list.txt',
    from: [
      'https://grawlix.wtf/Nediger list.txt',
      'https://grawlix.wtf/wordlists/Nediger list.txt',
    ],
  },
  {
    to: 'https://www.spreadthewordlist.com/downloads/spreadthewordlist_forms.txt',
    from: [
      'https://grawlix.wtf/spreadthewordlist.txt',
      'https://grawlix.wtf/wordlists/spreadthewordlist.txt',
      'https://raw.githubusercontent.com/jkugelman/wordlist/refs/heads/main/spreadthewordlist.txt',
    ],
  },
  {
    to: 'https://raw.githubusercontent.com/jkugelman/wordlist/refs/heads/main/peter-broda-wordlist.txt',
    from: [
      'https://grawlix.wtf/peter-broda-wordlist.txt',
      'https://grawlix.wtf/wordlists/peter-broda-wordlist.txt',
    ],
  },
  {
    to: 'https://raw.githubusercontent.com/jkugelman/wordlist/refs/heads/main/jkugelman-wordlist.txt',
    from: ['https://raw.githubusercontent.com/jkugelman/crossword/refs/heads/main/wordlists/jkugelman-wordlist.txt'],
  },
  {
    to: 'https://www.spreadthewordlist.com/assets/favicon.png',
    from: ['https://www.spreadthewordlist.com/favicon.ico'],
  },
];

// Hosts verified to answer conditional GETs with 304, so the update check may GET
// them in place of a HEAD. On an unverified host that GET would silently
// re-download the whole file on every check.
export const REVALIDATING_HOSTS = ['www.spreadthewordlist.com'];

export const SEVERITY_PRIORITY = { info: 1 };
