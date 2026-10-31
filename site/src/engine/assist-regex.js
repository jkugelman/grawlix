'use strict';

// ─── Regex assist ─────────────────────────────────────────────────────────────
// Reads a regular expression for the helper panel (see assist.js). The parser
// here only describes; regexError (the browser's own RegExp) judges validity,
// so a complaint from this parser surfaces only when the browser agrees.

import { esc } from '../core/util.js';
import { regexError, lexReplacement, groupColor } from './regex.js';
import { code, shout, rangeText, matchModeWhere, joinParts } from './assist.js';

export const REGEX_CHEAT = [
  { code: '.*', desc: 'any string', insert: '.*' },
  { code: '.', desc: 'any character', insert: '.' },
  { code: '[abc]', desc: 'any of a, b, c', insert: '[]', caret: 1 },
  { code: '[^abc]', desc: 'none of a, b, c', insert: '[^]', caret: 2 },
  { code: 'a*', desc: 'zero or more', insert: '*' },
  { code: 'a+', desc: 'one or more', insert: '+' },
  { code: 'a?', desc: 'optional', insert: '?' },
  { code: 'a{2,4}', desc: '2 to 4 times', insert: '{2,4}' },
  { code: 'a|b', desc: 'either a or b', insert: '|' },
  { code: '(…)', desc: 'capture group', insert: '()', caret: 1 },
  { code: '^', desc: 'start of the entry', insert: '^' },
  { code: '$', desc: 'end of the entry', insert: '$' },
];
export const REGEX_CHEAT_LINK = { url: 'https://regexone.com/', text: 'Learn regex at regexone.com →' };

const ESCAPES = {
  d: 'a digit', D: 'a non-digit', w: 'a letter or digit', W: 'a non-letter',
  s: 'a space', S: 'a non-space', b: 'a word edge', B: 'not a word edge',
};

// ─── Parsing ──────────────────────────────────────────────────────────────────

function parse(text) {
  const R = { tokens: [], errors: [], regions: [], groups: 0 };
  let i = 0;
  const tok = (s, e, kind, extra = {}) => { const t = { s, e, kind, ...extra }; R.tokens.push(t); return t; };
  const err = (s, e, msg, fixes, pending = false) => R.errors.push({ s, e, msg, fixes, pending });

  function alt(depth) {
    const s = i, opts = [seq(depth)];
    while (text[i] === '|') {
      tok(i, i + 1, 'op');
      i++;
      opts.push(seq(depth));
    }
    return opts.length === 1 ? opts[0] : { t: 'alt', opts, s, e: i };
  }
  function seq(depth) {
    const s = i, items = [];
    while (i < text.length && text[i] !== '|' && !(text[i] === ')' && depth > 0)) {
      if (text[i] === ')') {
        err(i, i + 1, `This ${code(')')} has no matching ${code('(')}.`, [{ label: 'Remove it', s: i, e: i + 1, text: '' }]);
        tok(i, i + 1, 'bad'); i++; continue;
      }
      const a = atom(depth);
      if (a) items.push(quant(a));
    }
    return { t: 'seq', items, s, e: i };
  }
  function atom(depth) {
    const c = text[i], s = i;
    if (c === '(') {
      const rest = text.slice(i);
      let kind = 'cap', head = 1;
      if (rest.startsWith('(?:')) { kind = 'non'; head = 3; }
      else if (rest.startsWith('(?=')) { kind = 'la'; head = 3; }
      else if (rest.startsWith('(?!')) { kind = 'nla'; head = 3; }
      else if (rest.startsWith('(?<=')) { kind = 'lb'; head = 4; }
      else if (rest.startsWith('(?<!')) { kind = 'nlb'; head = 4; }
      else { const m = /^\(\?<([A-Za-z_]\w*)>/.exec(rest); if (m) head = m[0].length; }
      const idx = kind === 'cap' ? ++R.groups : null;
      const open = tok(s, s + head, 'group');
      i += head;
      const body = alt(depth + 1);
      if (text[i] === ')') {
        open.pair = [i, i + 1];
        tok(i, i + 1, 'group', { pair: [s, s + head] });
        i++;
      } else err(s, s + head, `This ${code('(')} needs a closing ${code(')')}.`, undefined, true);
      // groupSpansToRanges colors a match's groups in order, so group N lights
      // up in color N-1 — as long as every group before it took part.
      if (idx) R.regions.push({ s, e: i, color: groupColor(idx) });
      return { t: 'group', kind, idx, body, s, e: i };
    }
    if (c === '[') {
      let j = i + 1;
      const neg = text[j] === '^';
      if (neg) j++;
      while (j < text.length && text[j] !== ']') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) {
        err(s, text.length, `This ${code('[')} needs a closing ${code(']')}.`, undefined, true);
        tok(s, text.length, 'class'); i = text.length; return null;
      }
      const body = text.slice(s + (neg ? 2 : 1), j);
      tok(s, j + 1, 'class');
      i = j + 1;
      return { t: 'class', neg, body, raw: text.slice(s, i), s, e: i };
    }
    if (c === '\\') {
      const n = text[i + 1];
      if (n === undefined) { err(s, s + 1, `A trailing ${code('\\')} has nothing to escape.`, undefined, true); tok(s, s + 1, 'bad'); i++; return null; }
      tok(s, s + 2, 'esc');
      i += 2;
      return { t: 'esc', ch: n, s, e: i };
    }
    if (c === '.') { tok(s, s + 1, 'wild'); i++; return { t: 'any', s, e: i }; }
    if (c === '^') { tok(s, s + 1, 'anchor'); i++; return { t: 'start', s, e: i }; }
    if (c === '$') { tok(s, s + 1, 'anchor'); i++; return { t: 'end', s, e: i }; }
    if ('*+?'.includes(c) || (c === '{' && /^\{\d+(,\d*)?\}/.test(text.slice(i)))) {
      const fixes = c === '*' ? [{ label: 'Use .*', s, e: s + 1, text: '.*' }] : c === '?' ? [{ label: 'Use .', s, e: s + 1, text: '.' }] : undefined;
      err(s, s + 1, `Nothing to repeat: ${code(c)} repeats the thing just before it, and nothing is there.${c === '*' ? ` Regex writes “anything” as ${code('.*')}.` : ''}`, fixes);
      tok(s, s + 1, 'bad'); i++; return null;
    }
    tok(s, s + 1, 'lit');
    i++;
    return { t: 'lit', ch: c, s, e: i };
  }
  function quant(a) {
    const c = text[i], s = i;
    let min, max, len;
    if (c === '*') [min, max, len] = [0, Infinity, 1];
    else if (c === '+') [min, max, len] = [1, Infinity, 1];
    else if (c === '?') [min, max, len] = [0, 1, 1];
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(text.slice(i));
      if (!m) return a;
      min = +m[1]; max = m[2] ? (m[3] ? +m[3] : Infinity) : min; len = m[0].length;
      if (max < min) err(s, s + len, `The numbers in ${code(m[0])} are backwards.`);
    } else return a;
    if (text[i + len] === '?') len++;
    tok(s, s + len, 'quant', { target: [a.s, a.e], ch: c });
    i += len;
    return { t: 'q', a, min, max, s: a.s, e: i };
  }

  R.ast = alt(0);
  R.tokens.sort((a, b) => a.s - b.s);
  return R;
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function phrase(n) {
  switch (n.t) {
    case 'seq': return joinParts(n.items.filter(it => it.t !== 'start' && it.t !== 'end').map(it => (it.t === 'lit' ? { lit: it.ch } : phrase(it)))) || 'nothing';
    case 'alt': return 'either ' + n.opts.map(phrase).join(' or ');
    case 'group': {
      const inner = phrase(n.body);
      if (n.idx) return `<span class="search-match-${groupColor(n.idx)}">group ${n.idx}</span> (${inner})`;
      if (n.kind === 'non') return n.body.t === 'alt' ? inner : `(${inner})`;
      return { la: `(followed by ${inner})`, nla: `(not followed by ${inner})`, lb: `(right after ${inner})`, nlb: `(not right after ${inner})` }[n.kind];
    }
    case 'q': {
      const a = n.a;
      if (a.t === 'any') {
        if (n.min === 0 && n.max === Infinity) return 'anything';
        if (n.min === 1 && n.max === Infinity) return 'at least one character';
        if (n.min === 0 && n.max === 1) return 'maybe one character';
        if (n.min === n.max) return `any ${n.min} characters`;
        return `${rangeText(n.min, n.max)} characters`;
      }
      const inner = a.t === 'lit' ? shout(a.ch) : phrase(a);
      if (n.min === 0 && n.max === 1) return `an optional ${inner}`;
      const many = n.min === 0 && n.max === Infinity ? 'any number of'
        : n.min === 1 && n.max === Infinity ? 'one or more of'
        : n.min === n.max ? `${n.min} of` : `${rangeText(n.min, n.max)} of`;
      return `${many} ${inner}`;
    }
    case 'any': return 'any character';
    case 'class':
      if (n.neg && /^[aeiouy]+$/i.test(n.body)) return 'a consonant';
      if (!n.neg && /^[aeiouy]+$/i.test(n.body) && n.body.length >= 5) return 'a vowel';
      return n.neg ? `a character other than ${code(n.body)}` : `one of ${code(n.raw)}`;
    case 'esc': return ESCAPES[n.ch] ??(/[1-9]/.test(n.ch) ? `group ${n.ch} again` : code(n.ch));
    case 'lit': return shout(n.ch);
  }
  return '';
}

function reading(ast, mode) {
  const items = ast.t === 'seq' ? ast.items : [];
  const st = items[0]?.t === 'start', en = items.at(-1)?.t === 'end';
  const body = phrase(ast);
  if (!mode && st && en) return `Finds entries that are exactly ${body}.`;
  if (!mode && st) return `Finds entries that start with ${body}.`;
  if (!mode && en) return `Finds entries that end with ${body}.`;
  return `Finds entries that ${matchModeWhere(mode)} ${body}${mode ? '' : ' anywhere inside'}.`;
}

// ─── Hints ────────────────────────────────────────────────────────────────────

// Accept only constructs that mean the same in Search, or the tip recommends a
// query that quietly finds different entries.
function asSearch(ast, mode) {
  if (ast.t !== 'seq') return null;
  let items = ast.items;
  const anchored = items[0]?.t === 'start' && items.at(-1)?.t === 'end';
  if (anchored) items = items.slice(1, -1);
  else if (mode !== 'full') return null;
  let s = '';
  for (const it of items) {
    if (it.t === 'lit' && /[a-z0-9]/i.test(it.ch)) s += it.ch.toLowerCase();
    else if (it.t === 'any') s += '?';
    else if (it.t === 'q' && it.a.t === 'any' && it.min === 0 && it.max === Infinity) s += '*';
    else if (it.t === 'q' && it.a.t === 'any' && it.min === it.max && it.min <= 6) s += '?'.repeat(it.min);
    else if (it.t === 'class' && /^[a-z]+$/.test(it.body)) s += it.raw;
    else return null;
  }
  return s || null;
}

function hints(R, text, mode) {
  const out = [];
  const searchy = /[*?]/.test(text) && !/[.()|{}\\+^$[\]]/.test(text);
  if (searchy) {
    const q = R.tokens.find(t => t.kind === 'quant');
    if (q) {
      const prev = text.slice(q.target[0], q.target[1]);
      const means = q.ch === '*'
        ? `${code(prev + '*')} means “any number of ${esc(prev.toUpperCase())}s, even none”`
        : `${code(prev + '?')} means “an optional ${esc(prev.toUpperCase())}”`;
      const fixed = text.replace(/\*/g, '.*').replace(/\?/g, '.');
      out.push({
        msg: `This reads like Search syntax. In Regex, ${means}. Regex writes “anything” as ${code('.*')} and “any one letter” as ${code('.')}.`,
        fixes: [{ label: `Use ${fixed}`, text: fixed }, { label: 'Use Search', tool: 'search', text }],
      });
    }
  }
  if (/[#@]/.test(text)) {
    const fixed = text.replace(/#/g, '[^aeiouy]').replace(/@/g, '[aeiouy]');
    out.push({
      msg: `In Regex, ${code('#')} and ${code('@')} are just those characters. A consonant is ${code('[^aeiouy]')} and a vowel is ${code('[aeiouy]')}.`,
      fixes: [{ label: `Use ${fixed}`, text: fixed }],
    });
  }
  const s = asSearch(R.ast, mode);
  if (s) out.push({ tip: true, msg: `Search can do this too, and reads more easily: ${code(s)}.`, fixes: [{ label: 'Use Search', tool: 'search', text: s, mode: 'full' }] });
  return out;
}

// ─── Analyze ──────────────────────────────────────────────────────────────────

export function analyzeRegex(text, { mode = '' } = {}) {
  const R = parse(text);
  const browserErr = regexError(text);
  let error = null;
  if (browserErr) {
    error = R.errors[0] ?? { s: 0, e: text.length, msg: esc(browserErr.charAt(0).toUpperCase() + browserErr.slice(1)) + '.' };
  }
  const ok = !!text && !browserErr;
  return {
    tokens: R.tokens,
    regions: R.regions,
    error,
    reading: ok ? reading(R.ast, mode) : null,
    hints: ok ? hints(R, text, mode) : [],
  };
}

// ─── Replacement ──────────────────────────────────────────────────────────────

export function analyzeReplacement(text, pattern) {
  const { groups } = parse(pattern);
  const tokens = [], regions = [];
  for (const { group, s, e } of lexReplacement(text)) {
    if (group === undefined) continue;
    // runReplace inserts nothing for a group the pattern lacks, with no error.
    tokens.push({ s, e, kind: group > groups ? 'bad' : 'esc' });
    if (groups && group <= groups) regions.push({ s, e, color: groupColor(group) });
  }
  return { tokens, regions, error: null, reading: null, hints: [] };
}
