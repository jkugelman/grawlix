'use strict';

// ─── Umiaq assist ─────────────────────────────────────────────────────────────
// Reads an Umiaq query for the helper panel (see assist.js). The lexer here
// only describes; parseUmiaqQuery stays the sole judge of validity, so a lexer
// complaint surfaces only when the parser also rejects the query. Variable
// colors come from variableColors, the same assignment the results use.

import { esc } from '../core/util.js';
import { parseUmiaqQuery, variableColors } from './umiaq.js';
import { code, shout, ORDINALS, rangeText, letters, joinParts, reversedRange } from './assist.js';

const VAR_OP_RE = /^(~?)([A-Z])(!?=)(.+)$/;
const LEN_RE = /^\|([^|]+)\|(<=|>=|!=|<|>|=)(.+)$/;
const TERM_OP_RE = /^((?:[A-Za-z0-9~ ]|\\.)+)(!?=)(.+)$/;
const PREFIX_RE = /^(\d+)(?:-(\d+)|(\+))?$/;
const isLow = c => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
const isCap = c => c >= 'A' && c <= 'Z';
const isLetter = c => /[\p{L}\p{N}]/u.test(c);

export const UMIAQ_CHEAT = [
  { code: 'a–z', desc: 'a literal letter' },
  { code: 'A–Z', desc: 'a variable', insert: { variable: true } },
  { code: '?', desc: 'any character', insert: '?' },
  { code: '*', desc: 'any string', insert: '*' },
  { code: '#', desc: 'any consonant', insert: '#' },
  { code: '@', desc: 'any vowel', insert: '@' },
  { code: '[abc]', desc: 'any of a, b, c', insert: '[]', caret: 1 },
  { code: ';', desc: 'separates clauses', insert: ';' },
  { code: '~A', desc: 'the reverse of A', insert: '~' },
  { code: 'A=#@#', desc: 'A fits a sub-pattern', insert: { clause: 'V=#@#' } },
  { code: 'A!=#@#', desc: "A doesn't fit a sub-pattern", insert: { clause: 'V!=#@#' } },
  { code: '|AB|=n', desc: 'length check (also < <= > >=)', insert: { clause: '|V|=3' } },
  { code: '|A|=8-9', desc: 'a length range (also 10+, 0-6)', insert: { clause: '|V|=8-9' } },
  { code: '|A|>=0', desc: 'A may be empty', insert: { clause: '|V|>=0' } },
  { code: '|*|>=0', desc: 'every variable may be empty', insert: { clause: '|*|>=0' } },
  { code: '7-9:…', desc: 'only 7-to-9-letter matches', insert: { prefix: '7-9:' } },
  { code: '/word', desc: 'an anagram of word', insert: '/' },
  { code: 'A B', desc: 'a space matches a spelled space' },
  { code: '\\.', desc: 'a literal punctuation mark', insert: '\\' },
  { code: '\\A', desc: 'a literal capital A' },
];

// ─── Lexing ───────────────────────────────────────────────────────────────────

function splitClauses(text) {
  const clauses = [], seps = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length - 1 && text[i] === '\\') { i++; continue; }
    if (i === text.length || text[i] === ';') {
      let s = start, e = i;
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      if (e > s) clauses.push({ s, e });
      if (i < text.length) seps.push(i);
      start = i + 1;
    }
  }
  return { clauses, seps };
}

function lexClass(L, i, e) {
  const t = L.text;
  let end = -1;
  for (let j = i + 1; j < e; j++) if (t[j] === ']') { end = j; break; }
  if (end < 0) {
    L.err(i, e, `This ${code('[')} needs a closing ${code(']')}.`, undefined, true);
    L.tok(i, e, 'class');
    return { end: e };
  }
  const body = t.slice(i + 1, end);
  L.tok(i, end + 1, 'class');
  if (body[0] === '!') {
    L.err(i, i + 2, `Grawlix writes “none of” as ${code('[^…]')}. ${code('[!…]')} is how Qat writes it.`, [{ label: 'Use [^', s: i + 1, e: i + 2, text: '^' }]);
    return { end: end + 1 };
  }
  if (!/^\^?[a-z0-9#@-]*$/.test(body)) {
    L.err(i, end + 1, `Only lowercase letters, digits, ${code('#')}, ${code('@')}, a leading ${code('^')} and ranges like ${code('a-m')} go inside ${code('[ ]')}.`);
    return { end: end + 1 };
  }
  const neg = body[0] === '^';
  const inner = neg ? body.slice(1) : body;
  const rr = reversedRange(inner);
  if (rr) {
    const at = i + 1 + (neg ? 1 : 0) + rr.at;
    L.err(at, at + 3, `The range ${code(rr.a + '-' + rr.b)} runs backwards.`, [{ label: `Use ${rr.b}-${rr.a}`, s: at, e: at + 3, text: `${rr.b}-${rr.a}` }]);
  }
  if (!inner) L.err(i, end + 1, 'This class is empty.');
  return { end: end + 1, item: { t: 'class', neg, body: inner } };
}

function lexPattern(L, s, e, { vars }) {
  const t = L.text;
  const pat = { prefix: null, anagram: null, items: [] };
  let colon = -1;
  for (let j = s; j < e; j++) { if (t[j] === '\\') { j++; continue; } if (t[j] === ':') { colon = j; break; } }
  if (colon >= 0) {
    const pm = PREFIX_RE.exec(t.slice(s, colon));
    if (pm) {
      const min = +pm[1], max = pm[2] != null ? +pm[2] : pm[3] ? Infinity : min;
      pat.prefix = { min, max };
      L.tok(s, colon + 1, 'num');
    } else {
      L.err(s, colon + 1, `A length prefix looks like ${code('7:')}, ${code('7-9:')} or ${code('10+:')}.`);
      L.tok(s, colon + 1, 'bad');
    }
    s = colon + 1;
  }
  let i = s;
  if (t[i] === '/') {
    L.tok(i, i + 1, 'op');
    if (t[i + 1] === '/' || t[i + 1] === '(') L.err(i, i + 2, `${code(t.slice(i, i + 2))} anagrams aren't supported.`);
    pat.anagram = [];
    i++;
  }
  const out = pat.anagram ?? pat.items;
  while (i < e) {
    const ch = t[i];
    if (isLow(ch)) { out.push({ t: 'lit', ch }); L.tok(i, i + 1, 'lit'); i++; }
    else if (ch === '?') { out.push({ t: 'any' }); L.tok(i, i + 1, 'wild'); i++; }
    else if (ch === '*') { out.push({ t: 'star' }); L.tok(i, i + 1, 'wild'); i++; }
    else if (ch === '#') { out.push({ t: 'cons' }); L.tok(i, i + 1, 'wild'); i++; }
    else if (ch === '@') { out.push({ t: 'vow' }); L.tok(i, i + 1, 'wild'); i++; }
    else if (ch === '[') { const r = lexClass(L, i, e); if (r.item) out.push(r.item); i = r.end; }
    else if (isCap(ch) || (ch === '~' && isCap(t[i + 1] || ''))) {
      const rev = ch === '~', v = rev ? t[i + 1] : ch, len = rev ? 2 : 1;
      if (pat.anagram) L.err(i, i + len, `An anagram can't hold variables. Write its letters in lowercase.`);
      else if (!vars) L.err(i, i + len, `A sub-pattern can't hold variables. Compare two variables with ${code('A=B')} or ${code('A!=B')} instead.`);
      else out.push({ t: rev ? 'rev' : 'var', v });
      L.tok(i, i + len, 'var', { v, rev, role: vars && !pat.anagram ? 'bind' : 'bad' });
      i += len;
    }
    else if (ch === '~') { L.err(i, i + 1, `${code('~')} goes right before a variable, as in ${code('~A')}.`, undefined, true); L.tok(i, i + 1, 'bad'); i++; }
    else if (ch === '/') { L.err(i, i + 1, `${code('/')} starts an anagram, so it can only come first.`); L.tok(i, i + 1, 'bad'); i++; }
    else if (ch === ' ') { out.push({ t: 'lit', ch: ' ' }); L.tok(i, i + 1, 'lit'); i++; }
    else if (ch === '\\') {
      const n = t[i + 1];
      if (n === undefined) { L.err(i, i + 1, `A trailing ${code('\\')} has nothing to escape.`, undefined, true); L.tok(i, i + 1, 'bad'); i++; continue; }
      if (isLetter(n) && !isCap(n)) {
        L.err(i, i + 2, `${code('\\' + n)} isn't an escape. A backslash goes before punctuation, a space or a capital letter.`, [{ label: `Use ${n}`, s: i, e: i + 2, text: n }]);
        L.tok(i, i + 2, 'bad'); i += 2; continue;
      }
      out.push({ t: 'lit', ch: n });
      L.tok(i, i + 2, 'esc');
     
      i += 2;
    }
    else if (isLetter(ch)) { out.push({ t: 'lit', ch }); L.tok(i, i + 1, 'lit'); i++; }
    else if (ch === '.') {
      L.err(i, i + 1, `Umiaq writes “any letter” as ${code('?')}. To match a period, write ${code('\\.')}`, [{ label: 'Use ?', s: i, e: i + 1, text: '?' }, { label: 'Use \\.', s: i, e: i + 1, text: '\\.' }]);
      L.tok(i, i + 1, 'bad'); i++;
    }
    else { L.err(i, i + 1, `${code(ch)} is reserved. Write ${code('\\' + ch)} to match it literally.`, [{ label: `Use \\${ch}`, s: i, e: i + 1, text: '\\' + ch }]); L.tok(i, i + 1, 'bad'); i++; }
  }
  return pat;
}

function lexTerm(L, s, e, { allowRev }) {
  const t = L.text, elems = [];
  for (let i = s; i < e;) {
    const ch = t[i];
    if (isCap(ch)) { elems.push({ t: 'var', v: ch }); L.tok(i, i + 1, 'var', { v: ch, role: 'use' }); i++; }
    else if (ch === '~' && isCap(t[i + 1] || '')) {
      if (!allowRev) L.err(i, i + 2, `A length can't tell a chunk from its reverse. Drop the ${code('~')}.`, [{ label: 'Drop ~', s: i, e: i + 1, text: '' }]);
      elems.push({ t: 'rev', v: t[i + 1] }); L.tok(i, i + 2, 'var', { v: t[i + 1], rev: true, role: 'use' }); i += 2;
    }
    else if (isLow(ch)) { elems.push({ t: 'lit', ch }); L.tok(i, i + 1, 'lit'); i++; }
    else { L.err(i, i + 1, `${code(ch)} can't go here. Only variables and letters can.`); L.tok(i, i + 1, 'bad'); i++; }
  }
  return { elems };
}

function lexLength(L, s, e) {
  const t = L.text, c = t.slice(s, e);
  const close = c.indexOf('|', 1);
  L.tok(s, s + 1, 'op');
  if (close < 0) { L.err(s, e, `This ${code('|')} needs a closing ${code('|')}, as in ${code('|A|=3')}.`, undefined, true); return; }
  L.tok(s + close, s + close + 1, 'op');
  const inner = c.slice(1, close);
  let left;
  if (inner === '*') { left = { span: 'all' }; L.tok(s + 1, s + 2, 'wild'); }
  else if (/^[A-Z]-[A-Z]$/.test(inner)) { left = { span: inner }; L.tok(s + 1, s + close, 'op'); }
  else left = lexTerm(L, s + 1, s + close, { allowRev: false });
  const m = /^(!=|<=|>=|=|<|>)/.exec(c.slice(close + 1));
  const os = s + close + 1;
  if (!m) { L.err(os, Math.max(e, os + 1), `Add a comparison after the bars, like ${code('=3')} or ${code('>=2')}.`, undefined, true); return; }
  L.tok(os, os + m[1].length, 'op');
  const rs = os + m[1].length, rhs = t.slice(rs, e);
  if (rhs[0] === '|') {
    const c2 = rhs.indexOf('|', 1);
    L.tok(rs, rs + 1, 'op');
    if (c2 < 0) { L.err(rs, e, `This ${code('|')} needs a closing ${code('|')}.`, undefined, true); return; }
    L.tok(rs + c2, rs + c2 + 1, 'op');
    const right = lexTerm(L, rs + 1, rs + c2, { allowRev: false });
    if (!left.span) L.cons.push({ kind: 'lenrel', left, op: m[1], right });
    return;
  }
  const rm = PREFIX_RE.exec(rhs);
  if (!rm) { L.err(rs, Math.max(e, rs + 1), `Expected a number, a range like ${code('3-5')} or ${code('5+')}, or another ${code('|A|')}.`, undefined, true); return; }
  const min = +rm[1], max = rm[2] != null ? +rm[2] : rm[3] ? Infinity : min;
  L.tok(rs, e, 'num');
  if (min !== max && m[1] !== '=') L.err(os, e, `Only ${code('=')} takes a range.`);
  L.cons.push({ kind: 'len', left, op: m[1], min, max });
}

function lexConstraint(L, s, e) {
  const t = L.text, c = t.slice(s, e);
  if (c[0] === '|') { lexLength(L, s, e); return; }
  const vm = VAR_OP_RE.exec(c);
  const tm = vm ? null : TERM_OP_RE.exec(c);
  const m = vm ? [vm[0], vm[1] + vm[2], vm[3], vm[4]] : tm;
  if (!m || !/[A-Z]/.test(m[1])) {
    L.err(s, e, `This isn't a pattern or a constraint. A constraint starts with a variable or ${code('|')}, as in ${code('A=#@#')} or ${code('|A|=3')}.`);
    L.tok(s, e, 'bad');
    return;
  }
  const [, lhs, op, rhs] = m;
  const ls = s, le = s + lhs.length, os = le, rs = os + op.length;
  const left = lexTerm(L, ls, le, { allowRev: true });
  L.tok(os, rs, 'op');
  if (/^[A-Za-z0-9~]+$/.test(rhs) && /[A-Z]/.test(rhs)) {
    const right = lexTerm(L, rs, e, { allowRev: true });
    L.cons.push({ kind: 'cmp', left, right, neg: op === '!=' });
    return;
  }
  const pat = lexPattern(L, rs, e, { vars: false });
  if (left.elems.length === 1 && left.elems[0].t !== 'lit') L.cons.push({ kind: 'sub', v: left.elems[0].v, rev: left.elems[0].t === 'rev', neg: op === '!=', pat });
  else L.cons.push({ kind: 'spell', left, pat, neg: op === '!=' });
}

function lex(text) {
  const L = {
    text, tokens: [], errors: [], bindings: [], cons: [],
    tok(s, e, kind, extra = {}) { this.tokens.push({ s, e, kind, ...extra }); },
    err(s, e, msg, fixes, pending = false) { this.errors.push({ s, e, msg, fixes, pending }); },
  };
  const { clauses, seps } = splitClauses(text);
  for (const at of seps) L.tok(at, at + 1, 'op');
  for (const cl of clauses) {
    const c = text.slice(cl.s, cl.e);
    const isConstraint = c[0] === '|' || VAR_OP_RE.test(c) || /(^|[^\\])=/.test(c);
    if (isConstraint) lexConstraint(L, cl.s, cl.e);
    else L.bindings.push({ ...lexPattern(L, cl.s, cl.e, { vars: true }), s: cl.s, e: cl.e });
  }
  L.tokens.sort((a, b) => a.s - b.s);
  L.clauses = clauses;
  return L;
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function chip(v, colors, rev = false) {
  return `<span class="hl-umiaq-var-${colors[v] ?? 0}">${rev ? '~' : ''}${v}</span>`;
}

function patternPhrase(pat, seen, colors) {
  if (pat.anagram) {
    const lits = pat.anagram.filter(x => x.t === 'lit').map(x => x.ch).join('');
    const extra = pat.anagram.filter(x => x.t !== 'lit' && x.t !== 'star').length;
    const star = pat.anagram.some(x => x.t === 'star');
    return `a rearrangement of ${lits ? shout(lits) : 'letters'}${extra ? `, plus ${extra} more ${letters(extra)}` : ''}${star ? ', plus any number of extra letters' : ''}`;
  }
  const parts = pat.items.map(it => {
    switch (it.t) {
      case 'lit': return { lit: it.ch };
      case 'any': return 'any letter';
      case 'star': return 'anything';
      case 'cons': return 'a consonant';
      case 'vow': return 'a vowel';
      case 'class': return it.neg ? `a letter other than ${code(it.body)}` : `one of ${code(it.body)}`;
    }
    const c = chip(it.v, colors);
    if (seen.has(it.v)) return it.t === 'rev' ? `${c} backwards` : `${c} again`;
    seen.add(it.v);
    return it.t === 'rev' ? `a chunk ${c} written backwards` : `a chunk ${c}`;
  });
  let s = joinParts(parts) || 'nothing';
  if (pat.prefix) s += ` (${rangeText(pat.prefix.min, pat.prefix.max)} letters in all)`;
  return s;
}

const termHTML = (term, colors) => term.elems.map(x => (x.t === 'lit' ? shout(x.ch) : chip(x.v, colors, x.t === 'rev'))).join('');

function lenPhrase(op, min, max) {
  if (min !== max) return `${rangeText(min, max)} letters long`;
  return {
    '=': `exactly ${min} ${letters(min)} long`, '!=': `not ${min} ${letters(min)} long`,
    '<': `shorter than ${min} letters`, '<=': `at most ${min} ${letters(min)} long`,
    '>': `longer than ${min} ${letters(min)}`, '>=': `at least ${min} ${letters(min)} long`,
  }[op];
}

const allowsEmpty = c => (c.op === '>=' && c.min === 0) || (c.op === '=' && c.min === 0 && c.max > 0);

function constraintPhrase(c, colors) {
  if (c.kind === 'len') {
    if (c.left.span) {
      const who = c.left.span === 'all' ? 'Every variable' : `Each variable from ${c.left.span[0]} to ${c.left.span[2]}`;
      return allowsEmpty(c) ? `${who} may be empty.` : `${who} is ${lenPhrase(c.op, c.min, c.max)}.`;
    }
    const L = termHTML(c.left, colors);
    if (c.left.elems.length === 1 && allowsEmpty(c)) return `${L} may be empty.`;
    return `${L} ${c.left.elems.length > 1 ? 'together are' : 'is'} ${lenPhrase(c.op, c.min, c.max)}.`;
  }
  if (c.kind === 'lenrel') {
    const w = { '=': 'the same length as', '!=': 'a different length from', '<': 'shorter than', '<=': 'no longer than', '>': 'longer than', '>=': 'at least as long as' }[c.op];
    return `${termHTML(c.left, colors)} is ${w} ${termHTML(c.right, colors)}.`;
  }
  if (c.kind === 'cmp') {
    const l = c.left.elems, r = c.right.elems;
    if (l.length === 1 && r.length === 1 && l[0].v === r[0].v && (l[0].t === 'rev') !== (r[0].t === 'rev')) {
      return `${chip(l[0].v, colors)} ${c.neg ? "doesn't read" : 'reads'} the same backwards.`;
    }
    if (l.length === 1 && r.length === 1 && l[0].t === 'var' && r[0].t === 'var') {
      return `${termHTML(c.left, colors)} and ${termHTML(c.right, colors)} are ${c.neg ? 'different' : 'the same'}.`;
    }
    return `${termHTML(c.left, colors)} ${c.neg ? "doesn't spell" : 'spells'} the same as ${termHTML(c.right, colors)}.`;
  }
  if (c.kind === 'sub') {
    const who = chip(c.v, colors, c.rev);
    return `${who}${c.rev ? ' (read backwards)' : ''} ${c.neg ? "can't be" : 'is'} ${patternPhrase(c.pat, new Set(), colors)}.`;
  }
  return `${termHTML(c.left, colors)} ${c.neg ? "doesn't spell" : 'spells'} ${patternPhrase(c.pat, new Set(), colors)}.`;
}

function reading(L, parsed, colors) {
  const seen = new Set(), n = L.bindings.length;
  let html;
  if (n === 1) html = `Finds entries made of ${patternPhrase(L.bindings[0], seen, colors)}.`;
  else {
    const what = n === 2 ? 'pairs' : n === 3 ? 'triples' : `sets of ${n}`;
    html = `Finds ${what} of entries. ` + L.bindings.map((b, i) => `The ${ORDINALS[i] ?? `#${i + 1}`} is ${patternPhrase(b, seen, colors)}.`).join(' ');
  }
  const cons = L.cons.map(c => constraintPhrase(c, colors));
  if (cons.length) html += ' ' + cons.join(' ');
  if (parsed.arm === 'display') html += ' Matches spellings, so spaces and punctuation count.';
  const floored = [...parsed.variables].some(v => !parsed.constraints.varBounds[v]);
  if (floored) html += ' <span class="assist-quiet">Each chunk is at least one letter.</span>';
  return html;
}

// ─── Hints ────────────────────────────────────────────────────────────────────

function hints(L, parsed, text, colors) {
  const out = [];
  const q = text.trim();
  const uses = {};
  for (const t of L.tokens) if (t.kind === 'var' && t.role === 'bind') uses[t.v] = (uses[t.v] || 0) + 1;
  const single = L.bindings.length === 1 && !L.cons.length;
  if (single && /^[A-Z]{3,}$/.test(q) && new Set(q).size === q.length) {
    const low = q.toLowerCase();
    out.push({
      msg: `Capital letters are variables, so ${code(q)} means “any entry of ${q.length} or more letters.” To find ${shout(low)}, type it in lowercase.`,
      fixes: [{ label: `Search for ${low}`, text: low }],
    });
  } else if (single && parsed.variables.size && Object.values(uses).every(n => n === 1)) {
    out.push({ msg: `Each variable appears only once, so it works just like ${code('*')}. Variables pay off when one repeats, as in ${code('ABBA')} or ${code('AB;BA')}.` });
  }
  const stray = [...new Set(L.tokens.filter(t => t.role === 'use' && !parsed.variables.has(t.v)).map(t => t.v))];
  for (const v of stray) {
    out.push({ msg: `${shout(v)} isn't in any pattern, so this constraint on it does nothing. Use ${shout(v)} in a pattern clause, or remove the constraint.` });
  }
  const anyZero = [...parsed.variables].some(v => parsed.constraints.varBounds[v]?.min === 0);
  if (L.bindings.length > 1 && !anyZero) {
    for (const b of L.bindings) {
      if (b.anagram) continue;
      const its = b.items, first = its[0], last = its.at(-1);
      const atStart = first?.v && its[1] && !its[1].v;
      const atEnd = last?.v && its.length > 1 && !its.at(-2).v;
      const edge = atStart ? first : atEnd ? last : null;
      if (!edge) continue;
      out.push({
        msg: `Every variable is at least one letter, so this skips entries where ${chip(edge.v, colors)} would be empty, with the fixed letters at the very ${atStart ? 'start' : 'end'}. Add ${code('|*|>=0')} to let variables be empty.`,
        fixes: [{ label: 'Add |*|>=0', text: `${q};|*|>=0` }],
      });
      break;
    }
  }
  return out;
}

// ─── Analyze ──────────────────────────────────────────────────────────────────

function locate(L, msg) {
  let best = null;
  for (const cl of L.clauses) {
    const src = L.text.slice(cl.s, cl.e);
    if (msg.includes(src) && (!best || cl.e - cl.s > best.e - best.s)) best = cl;
  }
  return best ? { s: best.s, e: best.e } : { s: 0, e: L.text.length };
}

export function analyzeUmiaq(text) {
  const L = lex(text);
  const parsed = parseUmiaqQuery(text);
  const bindVars = new Set();
  for (const b of L.bindings) for (const it of b.items) if (it.v) bindVars.add(it.v);
  const colors = variableColors(parsed.ok ? parsed.variables : bindVars);
  for (const t of L.tokens) {
    if (t.kind !== 'var') continue;
    if (colors[t.v] != null) t.color = colors[t.v];
    else t.kind = 'bad';
  }
  let error = null;
  if (!parsed.ok && !parsed.empty) {
    const lexErr = L.errors[0];
    if (lexErr) error = lexErr;
    else {
      const msg = parsed.error.charAt(0).toUpperCase() + parsed.error.slice(1);
      error = { ...locate(L, parsed.error), msg: esc(msg) + (/[.!?]$/.test(msg) ? '' : '.') };
    }
  }
  return {
    tokens: L.tokens,
    error,
    reading: parsed.ok ? reading(L, parsed, colors) : null,
    hints: parsed.ok ? hints(L, parsed, text, colors) : [],
    variables: [...(parsed.ok ? parsed.variables : bindVars)].sort(),
  };
}
