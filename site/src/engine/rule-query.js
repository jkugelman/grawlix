'use strict';

// ─── Rule queries ─────────────────────────────────────────────────────────────
// A rescore rule's condition: `field: value` clauses joined by and/or/not and
// parentheses, compiled to a predicate over one wordlist entry. See
// docs/wordlists.md § Rescore rules.

import { buildHelpHTML } from '../core/util.js';
import { splitWords } from './norm.js';
import { buildSearchPattern } from './search.js';
import { regexError } from './regex.js';

// ─── Word kinds ───────────────────────────────────────────────────────────────

const FUNCTION_WORDS = new Set('a an the of and or in on at to for by de la le du da di von van der den del y e & with from as is'.split(' '));
const I_FORMS = new Set(['I', "I'm", "I'd", "I'll", "I've", 'I’m', 'I’d', 'I’ll', 'I’ve']);
const ROMAN_RE = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
// Measured on JK, Nediger and STWL: CD and MD are initialisms in practice, XX a
// numeral, XL both. A wrong group makes `is: roman numeral` catch initialisms.
const ROMAN_BOTH = new Set(['IV', 'XL', 'XXX', 'MCL', 'CLI']);
const ROMAN_TWO_LETTER = new Set(['II', 'VI', 'IX', 'XI', 'XV', 'XX']);

const WORD_CATEGORIES = ['proper', 'initialism', 'abbreviation', 'roman numeral'];
const CHAR_CATEGORIES = {
  digits: /\p{Nd}/u,
  punctuation: /\p{P}/u,
  symbols: /\p{S}/u,
};

function romanKinds(caps) {
  if (ROMAN_BOTH.has(caps)) return ['roman numeral', 'initialism'];
  if (caps.length === 2) return ROMAN_TWO_LETTER.has(caps) ? ['roman numeral'] : ['initialism'];
  return ['roman numeral'];
}

function wordKinds(w) {
  const letters = w.replace(/[^\p{L}]/gu, '');
  if (!letters || I_FORMS.has(w)) return [];
  if (/\p{L}\.\p{L}/u.test(w)) return ['initialism'];
  if (w.endsWith('.') && letters.length >= 2) return ['abbreviation'];
  if (!/\p{Lu}/u.test(letters) || letters.length === 1) return [];
  if (letters === letters.toUpperCase()) return ROMAN_RE.test(letters) ? romanKinds(letters) : ['initialism'];
  if (/^\p{Lu}{2,}s$/u.test(letters)) return ['initialism'];
  return ['proper'];
}

export function classifyWords(text) {
  return splitWords(text).map(raw => {
    const w = raw.replace(/^[("“']+|[,;:!?)"”]+$/g, '');
    return { raw: w, capital: /\p{Lu}/u.test(w), kinds: wordKinds(w) };
  });
}

// Skipping the I forms and function words keeps "I don't like to brag" plain
// and "Bay of Pigs" proper.
export function entryKinds(text, words) {
  const out = new Set();
  if (!/\p{L}/u.test(text)) {
    const chars = [...text.replace(/\s/g, '')];
    for (const [name, re] of Object.entries(CHAR_CATEGORIES)) {
      if (chars.length && chars.every(ch => re.test(ch))) out.add(name);
    }
    return out;
  }
  const content = words.filter(w => /\p{L}/u.test(w.raw) && !I_FORMS.has(w.raw)
    && !(FUNCTION_WORDS.has(w.raw) && !w.kinds.length));
  if (content.every(w => !w.capital && !w.kinds.length)) { out.add('plain'); return out; }
  if (content.every(w => w.capital) && content.some(w => w.kinds.includes('proper'))) out.add('proper');
  for (const k of ['initialism', 'abbreviation', 'roman numeral']) {
    if (content.every(w => w.kinds.includes(k))) out.add(k);
  }
  return out;
}

// Lazy, so the columnar build's score-and-length rules never classify words
// across a 350k-entry list.
class Subject {
  set(score, norm, display) {
    this.score = score;
    this.norm = norm;
    this.display = display ?? null;
    this._lower = this._words = this._is = undefined;
    return this;
  }
  get text()  { return this.display ?? this.norm; }
  get lower() { return this._lower ??= this.display == null ? this.norm : this.display.toLowerCase(); }
  get words() { return this._words ??= classifyWords(this.text); }
  get is()    { return this._is ??= entryKinds(this.text, this.words); }
}

const SUBJECT = new Subject();

export function ruleSubject(score, norm, display) {
  return SUBJECT.set(score, norm, display);
}

// ─── Fields ───────────────────────────────────────────────────────────────────

const RANGE_RE = /^(\d+)(?:(\+)|[-–](\d+))?$/;
const RANGE_MSG = 'Use a number like 50, a minimum like 50+ or a range like 30-49.';

function rangeField(name, key) {
  return {
    name,
    item(it) {
      const m = it.text.match(RANGE_RE);
      if (!m) return { error: RANGE_MSG };
      const min = +m[1], max = m[2] ? null : m[3] !== undefined ? +m[3] : min;
      if (max !== null && max < min) return { error: `This range runs backward. Put the smaller number first, like ${max}-${min}.` };
      return { test: s => { const v = key(s); return v >= min && (max === null || v <= max); }, interval: { min, max } };
    },
  };
}

const IS_VALUES = ['plain', ...WORD_CATEGORIES, ...Object.keys(CHAR_CATEGORIES)];

function isField(name, negate) {
  return {
    name, negate,
    item(it) {
      const v = it.text.toLowerCase().replace(/\s+/g, ' ');
      if (!IS_VALUES.includes(v)) return { error: `“${it.text}” isn't a choice for ${name}. Use ${IS_VALUES.join(', ')}.` };
      return { test: s => s.is.has(v) };
    },
  };
}

// Text matches the norm or the lowercased display, like the search box, so
// `contains: theirs` finds "the IRS".
function positionField(name, where) {
  const words = s => where === 'any' ? s.words : where === 'start' ? s.words.slice(0, 1) : s.words.slice(-1);
  const chars = s => {
    const t = s.text.trim();
    return where === 'any' ? [...t] : where === 'start' ? [...t].slice(0, 1) : [...t].slice(-1);
  };
  const has = where === 'any' ? (str, lit) => str.includes(lit)
    : where === 'start' ? (str, lit) => str.startsWith(lit)
    : (str, lit) => str.endsWith(lit);
  return {
    name,
    item(it) {
      const v = it.text.toLowerCase().replace(/\s+/g, ' ');
      if (!it.quoted) {
        if (WORD_CATEGORIES.includes(v)) return { test: s => words(s).some(w => w.kinds.includes(v)) };
        const re = CHAR_CATEGORIES[v];
        if (re) return { test: s => chars(s).some(ch => re.test(ch)) };
        if (v === 'spaces') {
          if (where !== 'any') return { error: '“spaces” only works with contains.' };
          return { test: s => /\s/.test(s.text.trim()) };
        }
        if (v === 'plain') return { error: '“plain” only works with is.' };
      }
      const lit = it.text.toLowerCase();
      return { test: s => has(s.norm, lit) || (s.display != null && has(s.lower, lit)) };
    },
  };
}

const FIELDS = [
  rangeField('score', s => s.score),
  rangeField('length', s => s.norm.length),
  rangeField('words', s => s.words.length),
  isField('is', false),
  isField('is not', true),
  positionField('contains', 'any'),
  positionField('starts with', 'start'),
  positionField('ends with', 'end'),
  {
    name: 'pattern',
    item(it) {
      const pat = buildSearchPattern(it.text, 'full');
      if (!pat) return { error: 'This pattern doesn\'t work. Check any [ ] ranges.' };
      return { test: s => pat.test(s) };
    },
  },
  {
    name: 'regex',
    item(it) {
      const err = regexError(it.text);
      if (err) return { error: `This regular expression doesn't work: ${err}` };
      const re = new RegExp(it.text, 'i');
      return { test: s => re.test(s.norm) || (s.display != null && re.test(s.display)) };
    },
  },
];
const FIELD_BY_NAME = new Map(FIELDS.map(f => [f.name, f]));

const MULTIWORD_VALUES = IS_VALUES.filter(v => v.includes(' '));

// ─── Lexer ────────────────────────────────────────────────────────────────────

const isWs = ch => ch === ' ' || ch === '\t' || ch === '\n' || ch === ' ';
const OP_RE = /^(and|or|not)(?=[\s()]|$)/i;
const FIELD_RE = new RegExp('^(' + FIELDS.map(f => f.name).sort((a, b) => b.length - a.length)
  .map(n => n.replace(' ', '\\s+')).join('|') + ')\\s*:', 'i');
const UNKNOWN_FIELD_RE = /^([^\s():,"“”]+)\s*:/;
const QUOTE_CLOSE = { '"': '"', '“': '”' };
const isQuote = ch => ch === '"' || ch === '“' || ch === '”';
const endsValue = ch => ch === undefined || isWs(ch) || ch === ',' || ch === '(' || ch === ')';

function lex(s) {
  const toks = [];
  const n = s.length;
  let i = 0;
  for (;;) {
    while (i < n && isWs(s[i])) i++;
    if (i >= n) break;
    const ch = s[i], rest = s.slice(i);
    if (ch === '(' || ch === ')') {
      toks.push({ kind: ch === '(' ? 'lparen' : 'rparen', start: i, end: i + 1 });
      i++;
      continue;
    }
    let m = rest.match(OP_RE);
    if (m) {
      toks.push({ kind: 'op', op: m[1].toLowerCase(), start: i, end: i + m[1].length });
      i += m[1].length;
      continue;
    }
    m = rest.match(FIELD_RE) || rest.match(UNKNOWN_FIELD_RE);
    if (m) {
      const t = lexClause(s, i, m);
      toks.push(t);
      i = t.end;
      continue;
    }
    m = rest.match(/^[^\s()]+/);
    toks.push({ kind: 'word', text: m[0], start: i, end: i + m[0].length });
    i += m[0].length;
  }
  return toks;
}

function lexClause(s, i, m) {
  const rawName = m[1];
  const field = FIELD_BY_NAME.get(rawName.toLowerCase().replace(/\s+/g, ' ')) ?? null;
  const colon = i + m[0].length - 1;
  const t = { kind: 'clause', field, rawName, start: i, nameEnd: i + rawName.length, colon, items: [], error: null };
  const fail = (msg, start, end, incomplete = false) => {
    t.error ??= { start, end: Math.max(end, start + 1), msg, incomplete };
  };
  let j = colon + 1;
  for (;;) {
    while (j < s.length && isWs(s[j])) j++;
    const at = s[j];
    if (at === undefined || at === ')' || at === '(' || at === ',') {
      if (at === '(') fail('Put a value with parentheses in quotes, like "(ab)+".', j, j + 1);
      else if (!t.items.length) fail(`Pick a value for “${field?.name ?? rawName}”.`, i, colon + 1, true);
      else fail('Add a value after the comma.', j - 1, j, true);
      break;
    }
    const item = QUOTE_CLOSE[at] ? lexQuoted(s, j, fail) : lexBare(s, j, field, fail);
    t.items.push(item);
    j = item.end;
    let k = j;
    while (k < s.length && isWs(s[k])) k++;
    if (s[k] !== ',') break;
    j = k + 1;
  }
  t.end = j;
  return t;
}

// Only \" and \\ are escapes; any other backslash stays, so a regex body
// reaches RegExp as typed.
function lexQuoted(s, start, fail) {
  const close = QUOTE_CLOSE[s[start]];
  let text = '';
  let j = start + 1;
  for (; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\' && (s[j + 1] === '"' || s[j + 1] === '”' || s[j + 1] === '\\')) { text += s[++j]; continue; }
    if (ch === close || (close === '”' && ch === '"')) break;
    text += ch;
  }
  if (j >= s.length) {
    fail('Close the quote.', start, s.length, true);
    return { start, end: s.length, text, quoted: true };
  }
  j++;
  if (!endsValue(s[j])) {
    let k = j;
    while (!endsValue(s[k])) k++;
    fail('Put a space or comma after the closing quote.', j, k);
    j = k;
  }
  if (!text) fail('Put some text between the quotes.', start, j, true);
  return { start, end: j, text, quoted: true };
}

function lexBare(s, start, field, fail) {
  for (const v of MULTIWORD_VALUES) {
    const m = s.slice(start).match(new RegExp('^' + v.replace(' ', '\\s+'), 'i'));
    if (m && endsValue(s[start + m[0].length])) {
      return { start, end: start + m[0].length, text: m[0], quoted: false };
    }
  }
  let j = start;
  while (!endsValue(s[j])) j++;
  const text = s.slice(start, j);
  if ([...text].some(isQuote)) fail('Put quotes around the whole value, like "rock \'n\' roll".', start, j);
  return { start, end: j, text, quoted: false };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function closestField(name) {
  name = name.toLowerCase();
  let best = null, bestD = 3;
  for (const f of FIELDS) {
    const d = editDistance(name, f.name);
    if (d < bestD) { best = f.name; bestD = d; }
  }
  return best;
}

function compileClause(t) {
  const f = t.field;
  if (!f) {
    const near = closestField(t.rawName);
    t.error = { start: t.start, end: t.nameEnd, msg: `There's no “${t.rawName}” field.` + (near ? ` Did you mean “${near}”?` : '') };
  }
  if (t.error) return;
  const tests = [];
  for (const it of t.items) {
    const r = f.item(it);
    if (r.error) { t.error = { start: it.start, end: Math.max(it.end, it.start + 1), msg: r.error }; return; }
    tests.push(r.test);
    it.interval = r.interval;
  }
  const any = tests.length === 1 ? tests[0] : s => tests.some(fn => fn(s));
  t.test = f.negate ? s => !any(s) : any;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parse(toks) {
  const errors = [];
  for (const t of toks) {
    if (t.kind !== 'clause') continue;
    compileClause(t);
    if (t.error) errors.push(t.error);
  }
  let p = 0;
  const peek = () => toks[p];

  function parseOr() {
    let left = parseAnd();
    while (peek()?.kind === 'op' && peek().op === 'or') {
      const o = toks[p++];
      if (!left) errors.push({ start: o.start, end: o.end, msg: '“or” needs a condition before it.' });
      const right = parseAnd();
      if (!right) { errors.push({ start: o.start, end: o.end, msg: 'Add a condition after “or”.', incomplete: true }); break; }
      left = left ? { or: [left, right] } : right;
    }
    return left;
  }
  function parseAnd() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.kind === 'op' && t.op === 'and') {
        p++;
        if (!left) errors.push({ start: t.start, end: t.end, msg: '“and” needs a condition before it.' });
        const right = parseUnary();
        if (!right) { errors.push({ start: t.start, end: t.end, msg: 'Add a condition after “and”.', incomplete: true }); break; }
        left = left ? { and: [left, right] } : right;
        continue;
      }
      if (t.kind === 'clause' || t.kind === 'lparen' || t.kind === 'word' || (t.kind === 'op' && t.op === 'not')) {
        const right = parseUnary();
        if (!right) break;
        left = left ? { and: [left, right] } : right;
        continue;
      }
      break;
    }
    return left;
  }
  function parseUnary() {
    const t = peek();
    if (!t) return null;
    if (t.kind === 'op' && t.op === 'not') {
      p++;
      const inner = parseUnary();
      if (!inner) { errors.push({ start: t.start, end: t.end, msg: 'Add a condition after “not”.', incomplete: true }); return { bad: true }; }
      return { not: inner };
    }
    if (t.kind === 'lparen') {
      p++;
      const inner = parseOr();
      if (peek()?.kind === 'rparen') p++;
      else errors.push({ start: t.start, end: t.end, msg: 'This “(” needs a matching “)”.', incomplete: true });
      return inner || { bad: true };
    }
    if (t.kind === 'clause') { p++; return { clause: t }; }
    if (t.kind === 'word') {
      p++;
      errors.push({ start: t.start, end: t.end, msg: `“${t.text}” isn't a field. Start a condition with a field, like score: 50.` });
      return { bad: true };
    }
    return null;
  }

  const ast = parseOr();
  while (p < toks.length) {
    const t = toks[p++];
    errors.push({ start: t.start, end: t.end, msg: t.kind === 'rparen' ? 'This “)” has no matching “(”.' : `Unexpected “${t.op ?? ''}”.` });
  }
  return { ast, errors };
}

function toPredicate(n) {
  if (n.clause) return n.clause.test;
  if (n.and) { const [a, b] = n.and.map(toPredicate); return s => a(s) && b(s); }
  if (n.or)  { const [a, b] = n.or.map(toPredicate);  return s => a(s) || b(s); }
  if (n.not) { const a = toPredicate(n.not); return s => !a(s); }
  return () => false;
}

// A range output (50+ → 60+) maps from this interval, so it exists only when
// the top level ANDs exactly one score clause holding a single range.
function topScoreInterval(ast) {
  const clauses = [];
  const walk = n => { if (n.and) n.and.forEach(walk); else clauses.push(n); };
  walk(ast);
  const scores = clauses.filter(n => n.clause?.field?.name === 'score');
  if (scores.length !== 1 || scores[0].clause.items.length !== 1) return null;
  return scores[0].clause.items[0].interval;
}

// An empty query is inactive (matches nothing), and so is one with an error:
// a new blank rule dragged above others must not shadow them.
export function compileQuery(str) {
  const query = str ?? '';
  if (!query.trim()) return { match: null, errors: [], scoreInterval: null };
  const { ast, errors } = parse(lex(query));
  if (errors.length || !ast) return { match: null, errors, scoreInterval: null };
  return { match: toPredicate(ast), errors, scoreInterval: topScoreInterval(ast) };
}

export function queryErrors(str) {
  return compileQuery(str).errors;
}

export const RULE_QUERY_HELP = buildHelpHTML([
  ['score: 50', 'score in this list'],
  ['score: 30-49', 'a range of scores'],
  ['length: 8+', 'letters in the entry'],
  ['words: 2', 'words in the entry'],
  ['is: proper', 'proper, initialism, plain…'],
  ['contains: digits', 'a category or text'],
  ['ends with: ing', 'starts with works too'],
  ['pattern: ?@?@?', 'search-box wildcards'],
  ['regex: "(.)\\1"', 'a regular expression'],
  ['and · or · not', 'combine conditions'],
], { cols: 1 });
