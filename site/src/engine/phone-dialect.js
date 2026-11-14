'use strict';

// ─── Phone search's sound dialect ────────────────────────────────────────────
// ARPABET sounds in capitals plus Search's wildcards: `S N OW`, `K [AA AO] T`,
// `K @ T`, `S T #`, `T AE B IH (NG)`, comma-separated alternatives. Lowercase
// words are shorthand that phone-query.js translates into this dialect before
// anything is compiled, so the dialect is the only thing ever searched.
// See docs/design.md § Phone search.

import { FINAL, PENDING } from './assist.js';

export const CONSONANTS = ['B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH'];
export const VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];
// AX, ARPABET's schwa: the unstressed vowels that reduce toward it. OW0 stays a full
// "oh" (CMU writes a reduced O as AH), or BELLOW would find BELLA.
export const REDUCED = ['AA', 'AE', 'AH', 'AO', 'EH', 'IH', 'UH'];

// ─── Codes ───────────────────────────────────────────────────────────────────
// Exactly one code unit per phone and stress, so a regex character class is a set
// of sounds and a match can never land partway through a phone.

const CODES = new Map();
{
  let next = 0x100;
  for (const c of CONSONANTS) CODES.set(c, String.fromCharCode(next++));
  for (const v of VOWELS) for (const s of '012') CODES.set(v + s, String.fromCharCode(next++));
}
const NAME_OF = new Map([...CODES].map(([name, code]) => [code, name]));

// An unreadable word: no sound matches it, so no run of sounds crosses it.
export const HOLE = '\u0001';

export const isVowelName = name => VOWELS.includes(name.slice(0, 2));

export const codeOf = tok => CODES.get(tok) ?? CODES.get(tok + '1');

export const nameOfCode = code => NAME_OF.get(code);

const vowelCodes = (stresses = '012') => VOWELS.flatMap(v => [...stresses].map(s => CODES.get(v + s)));
const ALL = new Set(CODES.values());
const ANY_VOWEL = new Set(vowelCodes());
const ANY_CONSONANT = new Set(CONSONANTS.map(c => CODES.get(c)));
const AX = new Set(REDUCED.map(v => CODES.get(v + '0')));

export function codesOfName(name) {
  if (name === 'AX') return AX;
  if (CONSONANTS.includes(name)) return new Set([CODES.get(name)]);
  const bare = name.slice(0, 2), stress = name.slice(2);
  if (!VOWELS.includes(bare)) return null;
  if (!stress) return new Set([...'012'].map(s => CODES.get(bare + s)));
  return /^[012]$/.test(stress) ? new Set([CODES.get(name)]) : null;
}

// Coarse buckets for Phone replace's lookup: every set a word's translation can
// produce ([D T], any vowel class) sits inside one bucket.
const BUCKET = new Map();
for (const [name, code] of CODES) {
  BUCKET.set(code, isVowelName(name) ? 'V' : name === 'D' ? 'T' : name);
}
export const bucketKey = code => [...code].map(c => BUCKET.get(c) ?? c).join('|');
export function bucketOfSet(codes) {
  let only = null;
  for (const c of codes) {
    const b = BUCKET.get(c);
    if (only !== null && b !== only) return null;
    only = b;
  }
  return only;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

const SINGLE_NAMES = new Set(['B', 'D', 'F', 'G', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'V', 'W', 'Y', 'Z']);
const DOUBLE_NAMES = new Set([...CONSONANTS, ...VOWELS, 'AX'].filter(n => n.length === 2));
const SYNTAX = '[](),*?#@^';
const isSpace = ch => ch === ' ' || ch === '\t' || ch === ' ';
const hasLower = text => text !== text.toUpperCase();

function splitSounds(chunk, at) {
  const names = [];
  let i = 0;
  while (i < chunk.length) {
    const two = chunk.slice(i, i + 2);
    const name = DOUBLE_NAMES.has(two) ? two : SINGLE_NAMES.has(chunk[i]) ? chunk[i] : null;
    if (!name) {
      const ch = chunk[i];
      const msg = /\d/.test(ch)
        ? `${code(ch)} can only follow a vowel, as its stress: 0, 1 or 2.`
        : `${code(ch)} isn't the start of a sound. Sounds are written in ARPABET, like ${code('S')}, ${code('SH')} or ${code('OW')}; words go in lowercase.`;
      return { error: { s: at + i, e: at + i + 1, msg, ...FINAL } };
    }
    let end = i + name.length;
    if (/\d/.test(chunk[end] ?? '')) {
      if (!VOWELS.includes(name)) {
        const msg = name === 'AX' ? `${code('AX')} is always unstressed, so it takes no stress digit.` : `${code(name)} is a consonant, so it takes no stress digit.`;
        return { error: { s: at + end, e: at + end + 1, msg, ...FINAL } };
      }
      if (!/[012]/.test(chunk[end])) {
        return { error: { s: at + end, e: at + end + 1, msg: `A stress digit is ${code('0')} (unstressed), ${code('1')} (primary) or ${code('2')} (secondary).`, ...FINAL } };
      }
      end++;
    }
    names.push({ name: chunk.slice(i, end), s: at + i, e: at + end });
    i = end;
  }
  return { names };
}

const code = s => `<code>${s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</code>`;

export function parsePhoneQuery(text, { replacement = false } = {}) {
  const tokens = [];
  const alts = [];
  let error = null;
  const fail = err => { if (!error) error = err; };
  let alt = null;
  let group = null;
  const open = s => { alt ??= { parts: [], s, e: s, groups: [] }; };
  const push = el => {
    open(el.s);
    alt.parts.push(el);
    group?.parts.push(el);
    alt.e = el.e;
  };
  const closeAlt = (at, comma) => {
    if (group) fail({ s: group.s, e: group.s + 1, msg: `This ${code('(')} is never closed.`, ...PENDING });
    group = null;
    if (!alt || !alt.parts.length) {
      if (comma) fail({ s: at, e: at + 1, msg: 'There are no sounds before this comma.', ...FINAL });
      else if (alts.length) fail({ s: at - 1, e: at, msg: 'There are no sounds after this comma.', ...PENDING });
      alt = null;
      return;
    }
    alts.push(shapeAlt(alt, fail));
    alt = null;
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isSpace(ch)) { i++; continue; }
    if (ch === ',') {
      tokens.push({ s: i, e: i + 1, kind: 'op' });
      closeAlt(i, true);
      i++;
      continue;
    }
    if (ch === '[') {
      const end = text.indexOf(']', i);
      if (end < 0) {
        fail({ s: i, e: text.length, msg: `This ${code('[')} is never closed.`, ...PENDING });
        tokens.push({ s: i, e: text.length, kind: 'bad' });
        break;
      }
      const set = parseSet(text, i, end, fail);
      tokens.push({ s: i, e: i + 1, kind: 'op', pair: [end, end + 1] }, { s: end, e: end + 1, kind: 'op', pair: [i, i + 1] });
      for (const t of set.tokens) tokens.push(t);
      if (set.codes) push({ type: 'set', codes: set.codes, s: i, e: end + 1 });
      i = end + 1;
      continue;
    }
    if (ch === '(') {
      if (group) fail({ s: i, e: i + 1, msg: 'Parentheses can’t nest.', ...FINAL });
      const close = text.indexOf(')', i);
      tokens.push({ s: i, e: i + 1, kind: 'op', ...(close >= 0 ? { pair: [close, close + 1] } : {}) });
      open(i);
      group = { parts: [], s: i, index: alt.parts.length, negative: false };
      alt.groups.push(group);
      i++;
      while (isSpace(text[i] ?? '')) i++;
      if (text[i] === '^') {
        group.negative = true;
        tokens.push({ s: i, e: i + 1, kind: 'op' });
        i++;
      }
      continue;
    }
    if (ch === ')') {
      const opener = group?.s;
      tokens.push({ s: i, e: i + 1, kind: 'op', ...(opener != null ? { pair: [opener, opener + 1] } : {}) });
      if (!group) fail({ s: i, e: i + 1, msg: `This ${code(')')} has no ${code('(')} to close.`, ...FINAL });
      else {
        group.e = i + 1;
        alt.e = i + 1;
        if (!group.parts.length) fail({ s: group.s, e: i + 1, msg: 'These parentheses hold no sounds.', ...FINAL });
        group = null;
      }
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ s: i, e: i + 1, kind: 'bad' });
      fail({ s: i, e: i + 1, msg: `This ${code(']')} has no ${code('[')} to close.`, ...FINAL });
      i++;
      continue;
    }
    if (ch === '^') {
      tokens.push({ s: i, e: i + 1, kind: 'bad' });
      fail({ s: i, e: i + 1, msg: `${code('^')} only works first inside brackets: ${code('[^ R]')}.`, ...FINAL });
      i++;
      continue;
    }
    if ('*?#@'.includes(ch)) {
      const wild = wildAt(text, i);
      tokens.push({ s: i, e: wild.e, kind: 'wild' });
      if (replacement && (ch === '*' || ch === '?')) {
        fail({ s: i, e: i + 1, msg: `A replacement can’t use ${code(ch)}: it has to say which sounds to put in.`, ...FINAL });
      } else if (wild.error) fail(wild.error);
      if (ch === '*') {
        if (group) fail({ s: i, e: i + 1, msg: `${code('*')} can’t go inside parentheses.`, ...FINAL });
        push({ type: 'star', s: i, e: i + 1 });
      } else if (wild.codes) push({ type: 'set', codes: wild.codes, s: i, e: wild.e });
      i = wild.e;
      continue;
    }
    let end = i;
    while (end < text.length && !isSpace(text[end]) && !SYNTAX.includes(text[end]) && text[end] !== ',') end++;
    const chunk = text.slice(i, end);
    if (hasLower(chunk)) {
      if (group) fail({ s: i, e: end, msg: 'Inside parentheses, write sounds in capitals rather than words.', fixes: [{ label: `Use ${chunk.toUpperCase()}`, s: i, e: end, text: chunk.toUpperCase() }], ...FINAL });
      const prev = group ? null : alt?.parts.at(-1);
      if (prev?.type === 'word' && /^\s*$/.test(text.slice(prev.e, i))) {
        prev.e = end;
        prev.text = text.slice(prev.s, end);
        alt.e = end;
      } else push({ type: 'word', text: chunk, s: i, e: end });
    } else if (/^[A-Z0-9]+$/.test(chunk)) {
      const split = splitSounds(chunk, i);
      if (split.error) {
        tokens.push({ s: i, e: end, kind: 'bad' });
        fail({ ...split.error, fixes: /^[A-Z]+$/.test(chunk) ? [{ label: `Use the word ${chunk.toLowerCase()}`, s: i, e: end, text: chunk.toLowerCase() }] : undefined });
      } else {
        for (const n of split.names) {
          tokens.push({ s: n.s, e: n.e, kind: 'sound' });
          push({ type: 'set', codes: codesOfName(n.name), s: n.s, e: n.e });
        }
      }
    } else {
      tokens.push({ s: i, e: end, kind: 'bad' });
      fail({ s: i, e: end, msg: `${code(chunk)} isn’t a sound or a word. Sounds are capitals like ${code('S')}; words are lowercase.`, ...FINAL });
    }
    i = end;
  }
  closeAlt(text.length, false);
  return { tokens, alts: error ? [] : alts, error };
}

function wildAt(text, i) {
  const ch = text[i];
  if (ch === '*') return { e: i + 1 };
  if (ch === '?') return { e: i + 1, codes: ALL };
  if (ch === '#') return { e: i + 1, codes: ANY_CONSONANT };
  const digit = text[i + 1];
  if (/\d/.test(digit ?? '')) {
    if (!/[012]/.test(digit)) return { e: i + 2, error: { s: i + 1, e: i + 2, msg: `A stress digit is ${code('0')}, ${code('1')} or ${code('2')}.`, ...FINAL } };
    return { e: i + 2, codes: new Set(vowelCodes(digit)) };
  }
  return { e: i + 1, codes: ANY_VOWEL };
}

function parseSet(text, s, end, fail) {
  const tokens = [];
  let i = s + 1;
  let negate = false;
  while (isSpace(text[i] ?? '')) i++;
  if (text[i] === '^') { negate = true; tokens.push({ s: i, e: i + 1, kind: 'op' }); i++; }
  const codes = new Set();
  let any = false;
  while (i < end) {
    const ch = text[i];
    if (isSpace(ch)) { i++; continue; }
    if ('?#@'.includes(ch)) {
      const wild = wildAt(text, i);
      tokens.push({ s: i, e: wild.e, kind: 'wild' });
      if (wild.error) fail(wild.error);
      for (const c of wild.codes ?? []) codes.add(c);
      any = true;
      i = wild.e;
      continue;
    }
    let j = i;
    while (j < end && !isSpace(text[j]) && !SYNTAX.includes(text[j]) && text[j] !== ',') j++;
    if (j === i) {
      tokens.push({ s: i, e: i + 1, kind: 'bad' });
      fail({ s: i, e: i + 1, msg: `Brackets hold sounds, like ${code('[AA AO]')}; ${code(ch)} can’t go inside.`, ...FINAL });
      i++;
      continue;
    }
    const chunk = text.slice(i, j);
    if (hasLower(chunk)) {
      tokens.push({ s: i, e: j, kind: 'bad' });
      fail({ s: i, e: j, msg: 'Brackets hold sounds, written in capitals, not words.', ...FINAL });
    } else {
      const split = splitSounds(chunk, i);
      if (split.error) { tokens.push({ s: i, e: j, kind: 'bad' }); fail(split.error); }
      else {
        for (const n of split.names) {
          tokens.push({ s: n.s, e: n.e, kind: 'sound' });
          for (const c of codesOfName(n.name)) codes.add(c);
          any = true;
        }
      }
    }
    i = j;
  }
  if (!any) {
    fail({ s, e: end + 1, msg: 'These brackets hold no sounds.', ...FINAL });
    return { tokens, codes: null };
  }
  return { tokens, codes: negate ? new Set([...ALL].filter(c => !codes.has(c))) : codes };
}

function shapeAlt(alt, fail) {
  const { parts, groups } = alt;
  let before = [], after = [], beforeNot = false, afterNot = false, body = parts;
  for (const g of groups) {
    if (!g.parts.length) continue;
    const at = parts.indexOf(g.parts[0]);
    const first = at === 0, last = at + g.parts.length === parts.length;
    if (first && !last) { before = g.parts; beforeNot = g.negative; }
    else if (last && !first) { after = g.parts; afterNot = g.negative; }
    else fail({ s: g.s, e: g.e ?? g.s + 1, msg: first ? 'Parentheses need sounds outside them to match.' : 'Parentheses go only at the start or the end: they hold sounds that must, or with ^ mustn’t, be there, outside the match.', ...FINAL });
  }
  body = parts.slice(before.length, parts.length - after.length);
  return { before, body, after, beforeNot, afterNot, s: alt.s, e: alt.e };
}

// ─── Compiling ───────────────────────────────────────────────────────────────

const lit = c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
const ANY_SOUND = `[^${lit(HOLE)}]`;

function setSource(codes) {
  if (codes === ALL || codes.size === ALL.size) return ANY_SOUND;
  return `[${[...codes].map(lit).join('')}]`;
}

const elementSource = el => (el.type === 'star' ? `${ANY_SOUND}*` : setSource(el.codes));
export const sourceOf = els => els.map(elementSource).join('');

export function compileAlts(alts) {
  return alts.map(({ before, body, after, beforeNot, afterNot }) => {
    const b = sourceOf(before), m = sourceOf(body), a = sourceOf(after);
    const behind = b ? `(?<${beforeNot ? '!' : '='}${b})` : '';
    const ahead = a ? `(?${afterNot ? '!' : '='}${a})` : '';
    return {
      find: new RegExp(`${behind}${m}${ahead}`, 'g'),
      star: body.some(el => el.type === 'star'),
      exact: new RegExp(`^(?:${m})$`),
      afterOk: a ? new RegExp(`^${ahead}`) : null,
    };
  });
}

export function occurrencesIn(matchers, codeStr, allows, ends) {
  const out = [];
  for (const mt of matchers) {
    const re = mt.find;
    re.lastIndex = 0;
    // A greedy `*` reports one end per start; the shorter ends a match mode may
    // need instead (a word break, say) are only found by trying them.
    for (let m; (m = re.exec(codeStr)); re.lastIndex = m.index + 1) {
      const occ = { start: m.index, end: m.index + m[0].length };
      if (occ.end > occ.start && allows(occ)) { out.push(occ); continue; }
      if (!mt.star) continue;
      for (const end of ends(occ.start)) {
        if (end <= occ.start || end > occ.end) continue;
        const cand = { start: occ.start, end };
        if (allows(cand) && mt.exact.test(codeStr.slice(occ.start, end)) && (!mt.afterOk || mt.afterOk.test(codeStr.slice(end)))) {
          out.push(cand);
          break;
        }
      }
    }
  }
  return out;
}

// A spliced entry as a whole-entry regex: sets, with a replacement's contexts as
// lookarounds ({ look }) where it was put in.
export const wholeSource = items => `^${items.map(it => it.look ?? setSource(it.codes)).join('')}$`;
