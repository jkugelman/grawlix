'use strict';

import { CONSONANTS, VOWELS, escapeRegex, escapeRegexClass } from './search.js';
import { parseRange } from './range.js';

// ─── Umiaq — variable/pattern search ────────────────────────────────────────
// A JS reimplementation of Umiaq's pattern language (Alex Boisvert / Crossword
// Nexus, MIT), written against its source as the reference spec. One deliberate
// departure that silently diverges from intent if "corrected": matching binds
// over `norm` (variables capture accent/space-stripped lowercase substrings —
// the only representation where a variable's assignment stays consistent across a
// word's spellings).

const reverse = s => { let o = ''; for (let i = s.length - 1; i >= 0; i--) o += s[i]; return o; };

const NORM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Variable highlight palette size — cycles the shared --hl0..N colors (CSS
// .hl-umiaq-var-N) so a query with more variables than colors still renders.
const VAR_HL_COLORS = 9;

// ─── Parsing ─────────────────────────────────────────────────────────────────

const LEN_CONSTRAINT_RE = /^\|([^|]+)\|(<=|>=|!=|<|>|=)(.+)$/;
const VAR_OP_RE = /^([A-Z])(!?=)(.+)$/;
const TERM_OP_RE = /^([A-Za-z0-9]+)(!?=)(.+)$/;

function boundsFromOp(op, n) {
  if (op === '=')  return { lo: n, hi: n };
  if (op === '>')  return { lo: n + 1, hi: Infinity };
  if (op === '>=') return { lo: n, hi: Infinity };
  if (op === '<')  return { lo: null, hi: n - 1 };
  return { lo: null, hi: n };   // '<='
}

function lenTermParts(inner) {
  let tokens;
  try { tokens = tokenizePattern(inner).tokens; }
  catch { throw `invalid length term "|${inner}|"`; }
  const vars = [];
  let lit = 0;
  for (const t of tokens) {
    if (t.t === 'var') vars.push(t.name);
    else if (t.t === 'lit') lit += t.s.length;
    else throw `|${inner}| takes only variables and literals`;
  }
  return { vars, lit };
}

const FREE_VAR = { min: 1, max: Infinity };
const boundsOf = (varBounds, name) => varBounds[name] || FREE_VAR;

// One window per variable, shared by every path that binds one: the prefilter, the flat
// matcher, the affix scan, the anagram lanes. They must not each re-derive it — a
// prefilter a hair stricter than the matcher drops real matches and reports nothing.
//
// The floor is 1 because a variable is a *chunk*: let one vanish and its binding
// collapses into a weaker one — empty A turns `AB;BA` into `B;B`, which answers every
// word W with the degenerate tuple (W, W). So zero has to be asked for, by a clause that
// declares a minimum of zero. `|A|<=0` is the exception that looks like a bug: it
// declares no minimum, so the floor is capped at the ceiling to mean "empty" rather than
// contradict itself.
function resolveVarBounds(bounds, varEqualsPattern) {
  const varBounds = {};
  for (const v of new Set([...Object.keys(bounds), ...Object.keys(varEqualsPattern)])) {
    const lc = bounds[v];
    const vp = varEqualsPattern[v];
    const max = Math.min(lc ? lc.hi : Infinity, vp && vp.max !== Infinity ? vp.max : Infinity);
    const declared = [];
    if (lc && lc.lo !== null) declared.push(lc.lo);
    if (vp) declared.push(vp.min);
    varBounds[v] = { min: declared.length ? Math.max(...declared) : Math.min(1, max), max };
  }
  return varBounds;
}

export function varsForcedNonEmpty(parsed) {
  const { varBounds, declaredLen, varEqualsPattern } = parsed.constraints;
  return [...parsed.variables].filter(v => {
    if (boundsOf(varBounds, v).min === 0) return false;
    if (declaredLen[v] && declaredLen[v].lo !== null) return false;
    return !(varEqualsPattern[v] && varEqualsPattern[v].min > 0);
  });
}

function stripLenPrefix(clause) {
  const i = clause.indexOf(':');
  if (i === -1) return { wordLen: null, body: clause };
  const intervals = parseRange(clause.slice(0, i));
  if (!intervals) throw `invalid length prefix "${clause.slice(0, i)}"`;
  return { wordLen: intervals[0], body: clause.slice(i + 1) };
}

function classToken(body) {
  const expanded = body.replace(/#/g, CONSONANTS).replace(/@/g, VOWELS);
  const src = expanded.startsWith('^')
    ? `[^${escapeRegexClass(expanded.slice(1))}]`
    : `[${escapeRegexClass(expanded)}]`;
  let re;
  try { re = new RegExp(`^${src}$`, 'u'); } catch { return null; }
  return { t: 'class', src, re };
}

function tokenizePattern(clause) {
  const tokens = [];
  const variables = new Set();
  const pushLit = ch => {
    const tail = tokens[tokens.length - 1];
    if (tail && tail.t === 'lit') tail.s += ch;
    else tokens.push({ t: 'lit', s: ch });
  };
  for (let i = 0; i < clause.length; i++) {
    const ch = clause[i];
    if (ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9') pushLit(ch);
    else if (ch >= 'A' && ch <= 'Z') { tokens.push({ t: 'var', name: ch }); variables.add(ch); }
    else if (ch === '?') tokens.push({ t: 'dot' });
    else if (ch === '*') tokens.push({ t: 'star' });
    else if (ch === '#') tokens.push(classToken(CONSONANTS));
    else if (ch === '@') tokens.push(classToken(VOWELS));
    else if (ch === '~') {
      const name = clause[i + 1];
      if (!name || name < 'A' || name > 'Z') throw '~ must be followed by a variable (A–Z)';
      tokens.push({ t: 'rev', name }); variables.add(name); i++;
    } else if (ch === '[') {
      const end = clause.indexOf(']', i);
      if (end === -1) throw 'unclosed [ character class';
      const tok = classToken(clause.slice(i + 1, end));
      if (!tok) throw 'invalid [ character class';
      tokens.push(tok); i = end;
    } else if (ch === '/') {
      throw 'anagram (/) must start a binding, sub-pattern, or term target';
    } else if (ch === ' ') {
      continue;
    } else {
      throw `unexpected character "${ch}"`;
    }
  }
  return { tokens, variables };
}

// ─── Anagram ─────────────────────────────────────────────────────────────────
// `/letters` is a whole-pattern mode, not an inline element: it's unordered, so it
// sits outside the positional token stream as one token whose match is a multiset
// test — don't try to thread it through the backtracker's ordered walk.

function compileAnagram(bag) {
  const required = {};
  const classes = [];
  let fixed = 0, anyCount = 0, hasStar = false;
  for (let i = 0; i < bag.length; i++) {
    const ch = bag[i];
    if (ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9') { required[ch] = (required[ch] || 0) + 1; fixed++; }
    else if (ch === '?') anyCount++;
    else if (ch === '*') hasStar = true;
    else if (ch === ' ') continue;
    else if (ch === '#') classes.push(classToken(CONSONANTS));
    else if (ch === '@') classes.push(classToken(VOWELS));
    else if (ch === '[') {
      const end = bag.indexOf(']', i);
      if (end === -1) throw 'unclosed [ character class';
      const tok = classToken(bag.slice(i + 1, end));
      if (!tok) throw 'invalid [ character class';
      classes.push(tok); i = end;
    }
    else if (ch >= 'A' && ch <= 'Z') throw 'an anagram (/) cannot contain variables';
    else throw `an anagram (/) takes only letters, digits, ?, *, #, @ and [ ] classes (not "${ch}")`;
  }
  if (!fixed && !anyCount && !hasStar && !classes.length) throw 'empty anagram (/)';
  const min = fixed + anyCount + classes.length;
  return { t: 'anagram', required, classes, anyCount, hasStar, min, max: hasStar ? Infinity : min, src: '/' + bag };
}

// Each class slot must claim a distinct leftover letter. This is bipartite matching, not a
// per-slot "some letter fits" test: overlapping slots (`[ab][bc]` on `bc`) would each grab
// b greedily and wrongly reject. Augmenting-path (Kuhn's); both sides are tiny.
function anagramClassesFit(classes, remainder) {
  const occ = [];   // one entry per leftover letter occurrence
  for (const c in remainder) for (let k = 0; k < remainder[c]; k++) occ.push(c);
  const members = classes.map(cl => classMembers(cl));
  const owner = new Array(occ.length).fill(-1);   // occ index → slot that claimed it
  const augment = (slot, seen) => {
    for (let j = 0; j < occ.length; j++) {
      if (seen[j] || !members[slot].includes(occ[j])) continue;
      seen[j] = true;
      if (owner[j] === -1 || augment(owner[j], seen)) { owner[j] = slot; return true; }
    }
    return false;
  };
  for (let slot = 0; slot < classes.length; slot++) {
    if (!augment(slot, new Array(occ.length).fill(false))) return false;
  }
  return true;
}

// The length bounds carry the whole count: any surplus over the required letters is
// exactly what fills the `?`/`*`/class slots, so a containment check plus [min, max]
// plus the class-slot matching is the full test — no separate wildcard accounting.
function anagramMatches(a, s) {
  if (s.length < a.min || s.length > a.max) return false;
  const counts = {};
  for (let i = 0; i < s.length; i++) counts[s[i]] = (counts[s[i]] || 0) + 1;
  for (const c in a.required) {
    if ((counts[c] || 0) < a.required[c]) return false;
    counts[c] -= a.required[c];
  }
  return a.classes.length === 0 || anagramClassesFit(a.classes, counts);
}

function anagramFromBody(body) {
  if (body.startsWith('//')) throw 'letter-bank anagram (//) is not supported';
  if (body.startsWith('/(')) throw 'subset anagram /(…) is not supported';
  if (body[0] === '/') return compileAnagram(body.slice(1));
  return null;
}

function tokenizeBody(body) {
  const ana = anagramFromBody(body);
  return ana ? { tokens: [ana], variables: new Set() } : tokenizePattern(body);
}

// Cheap full-word reject run before the backtracker. Each variable becomes `.+`
// (or `.{m,n}` when length-bound) independently, so this over-approximates —
// repeated-variable equality is the matcher's job — but it never rejects a real
// match, which is what makes short-circuiting on it safe.
function compilePrefilter(tokens, varBounds) {
  let body = '';
  for (const part of tokens) {
    if (part.t === 'lit') body += escapeRegex(part.s);
    else if (part.t === 'dot') body += '.';
    else if (part.t === 'star') body += '.*';
    else if (part.t === 'class') body += part.src;
    else if (part.t === 'anagram') body += part.max === Infinity ? `.{${part.min},}` : `.{${part.min},${part.max}}`;
    else {
      const { min, max } = boundsOf(varBounds, part.name);
      body += max === Infinity ? `.{${min},}` : `.{${min},${max}}`;
    }
  }
  return new RegExp(`^(?:${body})$`, 'u');
}

function compileVarPattern(name, spec) {
  const { wordLen, body } = stripLenPrefix(spec);
  const ana = anagramFromBody(body);
  const parsed = ana ? { tokens: [ana], variables: new Set() } : tokenizePattern(body);
  if (parsed.variables.size) throw `sub-pattern for ${name} cannot contain variables`;
  if (!parsed.tokens.length) throw `empty sub-pattern for ${name}`;
  let min = 0, max = 0;
  for (const t of parsed.tokens) {
    if (t.t === 'lit') { min += t.s.length; max += t.s.length; }
    else if (t.t === 'star') max = Infinity;
    else if (t.t === 'anagram') { min += t.min; if (t.max === Infinity) max = Infinity; else max += t.max; }
    else { min += 1; if (max !== Infinity) max += 1; }   // dot | class
  }
  if (wordLen) {
    min = Math.max(min, wordLen.min);
    if (wordLen.max !== null) max = Math.min(max, wordLen.max);
  }
  if (min > max) throw `sub-pattern for ${name} has contradictory lengths`;
  let test;
  if (ana) test = s => anagramMatches(ana, s);
  else { const re = compilePrefilter(parsed.tokens, {}); test = s => re.test(s); }
  return { test, min, max };
}

// A wide fixed-width RHS (`AB=????`) is a length constraint in disguise; expanding it
// would blow up memory silently, so cap it and reject rather than materialize.
const RHS_EXPANSION_CAP = 4096;

function expandPattern(tokens) {
  let strs = [''];
  for (const t of tokens) {
    if (t.t === 'lit') strs = strs.map(s => s + t.s);
    else if (t.t === 'dot') strs = strs.flatMap(s => [...NORM_CHARS].map(c => s + c));
    else if (t.t === 'class') strs = strs.flatMap(s => classMembers(t).map(c => s + c));
    if (strs.length > RHS_EXPANSION_CAP) throw 'the right side of = is too broad — narrow it or use a length constraint';
  }
  return strs;
}

// The synthetic pool an anagram termEquals drives with: every distinct rearrangement of the
// target's letters. Capped like `expandPattern` — too many arrangements is rejected, not
// materialized, or a long target blows up memory silently.
function anagramPermutations(ana) {
  const chars = Object.keys(ana.required).sort();
  const counts = chars.map(c => ana.required[c]);
  const n = counts.reduce((a, b) => a + b, 0);
  let arrangements = 1;
  for (let i = 2; i <= n; i++) arrangements *= i;
  for (const k of counts) for (let i = 2; i <= k; i++) arrangements /= i;
  if (arrangements > RHS_EXPANSION_CAP) throw 'the anagram target has too many letters to rearrange — use a shorter target';
  const out = [];
  const buf = new Array(n);
  const rec = depth => {
    if (depth === n) { out.push(buf.join('')); return; }
    for (let i = 0; i < chars.length; i++) {
      if (!counts[i]) continue;
      counts[i]--; buf[depth] = chars[i]; rec(depth + 1); counts[i]++;
    }
  };
  rec(0);
  return out;
}

// A termEquals clause's `rhsEntries` is the target expanded into a synthetic pool the term
// matches against — it *drives* the join (generating the term's partitions) rather than
// filtering the cross-product, which is what keeps `A;B;AB=boardroom` out of O(n²). (A
// termNotEquals clause only filters, so it never expands — hence `rhsEntries: null`.)
function compileTermOp(lhs, op, rhs) {
  const term = tokenizePattern(lhs);
  for (const t of term.tokens) {
    if (t.t !== 'var' && t.t !== 'lit') throw `the left side of ${op} takes only variables and literals`;
  }
  if (/^[A-Z]$/.test(rhs)) throw `comparing two terms (${lhs}${op}${rhs}) is not supported`;
  const negate = op === '!=';
  const common = { term, vars: [...term.variables].sort(), src: `${lhs}${op}${rhs}` };

  const ana = anagramFromBody(rhs);
  if (ana) {
    if (ana.anyCount || ana.hasStar || ana.classes.length) throw `?, *, and character classes aren't supported in an anagram target (${lhs}${op}${rhs})`;
    // rhsEntries (the permutation pool) is deferred to parseUmiaqQuery: the clean multi-word
    // form is index-solved and never expands, so only the exotic fallback pays the cap.
    return { ...common, anagram: ana, test: s => anagramMatches(ana, s), rhsEntries: negate ? null : undefined };
  }

  const rp = tokenizePattern(rhs);
  if (rp.variables.size) throw `the right side of ${op} cannot contain variables`;
  if (!rp.tokens.length) throw `empty right side of ${op}`;
  for (const t of rp.tokens) if (t.t === 'star') throw `* on the right side of ${op} is not supported`;
  const rhsRe = compilePrefilter(rp.tokens, {});
  return { ...common, test: s => rhsRe.test(s), rhsEntries: negate ? null : expandPattern(rp.tokens).map(norm => ({ norm })) };
}

export function parseUmiaqQuery(query) {
  const q = (query || '').normalize('NFC').trim();
  if (!q) return { ok: false, empty: true };

  const clauses = q.split(';').map(c => c.trim());
  const bounds = {};   // var → { lo, hi }: explicit lower bound (null = none) and upper bound
  const varNotEqualsVar = {};
  const varEqualsPattern = {};
  const varNotEqualsPattern = {};
  const sumLen = [];
  const lenCompare = [];
  const termEquals = [];
  const termNotEquals = [];
  const bindingSrcs = [];

  for (const clause of clauses) {
    const vd = VAR_OP_RE.exec(clause);
    if (vd) {
      const [, name, op, rhs] = vd;
      if (op === '!=' && /^[A-Z]$/.test(rhs)) {
        (varNotEqualsVar[name] ??= []).push(rhs);
        (varNotEqualsVar[rhs] ??= []).push(name);
        continue;
      }
      try {
        const compiled = compileVarPattern(name, rhs);
        if (op === '=') varEqualsPattern[name] = compiled;
        else (varNotEqualsPattern[name] ??= []).push(compiled);
      } catch (msg) { return { ok: false, error: typeof msg === 'string' ? msg : String(msg) }; }
      continue;
    }
    if (clause.startsWith('|')) {
      const lm = LEN_CONSTRAINT_RE.exec(clause);
      if (lm) {
        const [, leftSrc, op, rhs] = lm;
        let left;
        try { left = lenTermParts(leftSrc); }
        catch (msg) { return { ok: false, error: typeof msg === 'string' ? msg : String(msg) }; }

        // A relational RHS (`|A|=|B|`) fixes neither side, so it can't feed varBounds/sumLen
        // like the numeric forms — it can only filter at the join. Same for `|A|!=3` below.
        const rm = /^\|([^|]+)\|$/.exec(rhs);
        if (rm) {
          let right;
          try { right = lenTermParts(rm[1]); }
          catch (msg) { return { ok: false, error: typeof msg === 'string' ? msg : String(msg) }; }
          lenCompare.push({ left, op, right, src: clause });
          continue;
        }
        if (!/^\d+$/.test(rhs)) return { ok: false, error: `unsupported constraint "${clause}"` };
        const n = +rhs;
        if (op === '!=') {
          lenCompare.push({ left, op, right: { vars: [], lit: n }, src: clause });
          continue;
        }
        const { lo, hi } = boundsFromOp(op, n);
        const { vars, lit } = left;
        if (vars.length === 1 && lit === 0) {
          const v = vars[0];
          // A null lower bound must stay null (not default to 1) until every clause is
          // seen, or an upper-bound-only clause like |A|<=5 silently re-imposes the
          // floor of 1 and defeats a later |A|>=0.
          const prev = bounds[v] || { lo: null, hi: Infinity };
          bounds[v] = {
            lo: lo === null ? prev.lo : prev.lo === null ? lo : Math.max(lo, prev.lo),
            hi: Math.min(hi, prev.hi),
          };
        } else {
          sumLen.push({ vars, lit, min: lo === null ? 0 : lo, max: hi });
        }
        continue;
      }
      return { ok: false, error: `unsupported constraint "${clause}"` };
    }
    if (clause.includes('=')) {
      const m = TERM_OP_RE.exec(clause);
      if (m && /[A-Z]/.test(m[1])) {
        try { (m[2] === '!=' ? termNotEquals : termEquals).push(compileTermOp(m[1], m[2], m[3])); }
        catch (msg) { return { ok: false, error: typeof msg === 'string' ? msg : String(msg) }; }
        continue;
      }
      return { ok: false, error: `unsupported constraint "${clause}"` };
    }
    // A trailing or doubled `;` leaves an empty clause — almost always mid-typing,
    // so stay inert rather than erroring while the user composes the next pattern.
    if (!clause) return { ok: false, empty: true };
    bindingSrcs.push(clause);
  }

  for (const v in bounds) {
    const { lo, hi } = bounds[v];
    if (lo !== null && lo > hi) return { ok: false, error: `|${v}| length constraints contradict each other` };
  }
  const varBounds = resolveVarBounds(bounds, varEqualsPattern);

  if (!bindingSrcs.length) return { ok: false, empty: true };

  const bindings = [];
  const variables = new Set();
  for (const clause of bindingSrcs) {
    let wordLen, parsed;
    try {
      let body;
      ({ wordLen, body } = stripLenPrefix(clause));
      parsed = tokenizeBody(body);
    }
    catch (msg) { return { ok: false, error: typeof msg === 'string' ? msg : String(msg) }; }
    if (!parsed.tokens.length) return { ok: false, empty: true };
    if (wordLen && wordLen.max !== null && wordLen.min > wordLen.max) return { ok: false, error: 'length prefix range is empty' };
    for (const v of parsed.variables) variables.add(v);
    const stars = parsed.tokens.reduce((n, t) => n + (t.t === 'star' ? 1 : 0), 0);
    bindings.push({ ...parsed, src: clause, wordLen, stars, prefilter: compilePrefilter(parsed.tokens, varBounds) });
  }

  for (const v of Object.keys(varNotEqualsVar)) varNotEqualsVar[v] = [...new Set(varNotEqualsVar[v])];

  for (const tc of [...termEquals, ...termNotEquals]) {
    for (const v of tc.vars) if (!variables.has(v)) return { ok: false, error: `${tc.src}: ${v} must appear in a binding` };
  }
  for (const tc of termEquals) {
    tc.pattern = { tokens: tc.term.tokens, variables: tc.term.variables, wordLen: null, stars: 0, prefilter: compilePrefilter(tc.term.tokens, varBounds) };
  }

  const constraints = { varBounds, declaredLen: bounds, varNotEqualsVar, sumLen, lenCompare, varEqualsPattern, varNotEqualsPattern, termEquals, termNotEquals };
  const anagramSolve = planAnagramSolve(bindings, termEquals, termNotEquals, variables);
  if (!anagramSolve) {
    // Exotic anagram forms fall back to the permutation pool. This is its only expansion
    // site, so the letter cap still surfaces here as a parse error (the tail doesn't
    // otherwise throw — keep the try/catch or an over-broad target escapes uncaught).
    for (const tc of termEquals) {
      if (tc.anagram && tc.rhsEntries === undefined) {
        try { tc.rhsEntries = anagramPermutations(tc.anagram).map(norm => ({ norm })); }
        catch (msg) { return { ok: false, error: typeof msg === 'string' ? msg : String(msg) }; }
      }
    }
  }

  return { ok: true, bindings, constraints, arity: bindings.length, variables, anagramSolve };
}

// ─── Matching ────────────────────────────────────────────────────────────────
// Enumerate every assignment (var → bound substring) by which `pattern` matches
// `word`. Memoized backtracker over (word index, token index, assignment), faithful
// to Umiaq's matcher except for the prefilter and the result-dedupe. Variables bind
// within the window `resolveVarBounds` fixed; `*` always spans zero or more characters.

function canonical(assignment) {
  const keys = Object.keys(assignment);
  if (!keys.length) return '';
  keys.sort();
  let s = '';
  for (const k of keys) s += k + '=' + assignment[k] + ',';
  return s;
}

// Must fail *open* on a not-yet-bound variable (skip, don't reject): the same guard
// runs inside a single binding's match and again at the tuple join, and a |AB|=n whose
// A and B sit in different bindings is only whole at the join — reject-on-missing there
// would drop every cross-binding tuple silently.
function sumLenOK(sumLen, assignment) {
  for (const { vars, lit, min, max } of sumLen) {
    if (!vars.every(v => v in assignment)) continue;
    let total = lit;
    for (const v of vars) total += assignment[v].length;
    if (total < min || total > max) return false;
  }
  return true;
}

const termLenOf = ({ vars, lit }, assignment) => {
  let total = lit;
  for (const v of vars) total += assignment[v].length;
  return total;
};

// Same fail-open discipline as sumLenOK: a relational constraint whose two terms straddle
// separate bindings is only whole at the join, so skip it until every named variable binds.
function lenCompareOK(lenCompare, assignment) {
  for (const { left, op, right } of lenCompare) {
    if (!left.vars.every(v => v in assignment) || !right.vars.every(v => v in assignment)) continue;
    const a = termLenOf(left, assignment);
    const b = termLenOf(right, assignment);
    const ok = op === '=' ? a === b
      : op === '!=' ? a !== b
      : op === '<' ? a < b
      : op === '<=' ? a <= b
      : op === '>' ? a > b
      : a >= b;
    if (!ok) return false;
  }
  return true;
}

// The string a term spells once its variables are bound, or null when some variable it
// names isn't bound yet — the fail-open case the callers skip (a cross-binding term is
// only whole at the join).
function spellTerm(tc, assignment) {
  if (!tc.vars.every(v => v in assignment)) return null;
  let s = '';
  for (const t of tc.term.tokens) s += t.t === 'var' ? assignment[t.name] : t.s;
  return s;
}

function termsOK(termEquals, termNotEquals, assignment) {
  for (const tc of termEquals) { const s = spellTerm(tc, assignment); if (s !== null && !tc.test(s)) return false; }
  for (const tc of termNotEquals) { const s = spellTerm(tc, assignment); if (s !== null && tc.test(s)) return false; }
  return true;
}

export function matchPattern(word, pattern, constraints = { varBounds: {}, varNotEqualsVar: {} }) {
  const W = word.length;
  const wl = pattern.wordLen;
  if (wl && (W < wl.min || (wl.max !== null && W > wl.max))) return [];
  if (!pattern.prefilter.test(word)) return [];

  const parts = pattern.tokens;
  const varBounds = constraints.varBounds || {};
  const varNotEqualsVar = constraints.varNotEqualsVar || {};
  const sumLen = constraints.sumLen || [];
  const lenCompare = constraints.lenCompare || [];
  const termEquals = constraints.termEquals || [];
  const termNotEquals = constraints.termNotEquals || [];
  const varEqualsPattern = constraints.varEqualsPattern || {};
  const varNotEqualsPattern = constraints.varNotEqualsPattern || {};
  const results = [];
  // Paths reconverge — and the per-node `canonical()` memo/dedup that costs ~200µs
  // a word earns its keep — only with ≥2 stars (`**`, `*a*`): a single star or
  // any number of variables advance the position uniquely, so distinct paths can't
  // collide on (i, pi, assignment). Skipping it for the star-light common case
  // (ABC;CBA, AB;BA, …) is the difference between a snappy run and a 40s one.
  const needDedup = (pattern.stars ?? parts.reduce((n, t) => n + (t.t === 'star' ? 1 : 0), 0)) >= 2;
  const seen = needDedup ? new Set() : null;
  const memo = needDedup ? new Set() : null;

  function helper(i, pi, assignment) {
    let key;
    if (needDedup) {
      key = i + '|' + pi + '|' + canonical(assignment);
      if (memo.has(key)) return;
    }

    if (pi === parts.length) {
      if (i === W) {
        if (sumLen.length && !sumLenOK(sumLen, assignment)) return;
        if (lenCompare.length && !lenCompareOK(lenCompare, assignment)) return;
        if ((termEquals.length || termNotEquals.length) && !termsOK(termEquals, termNotEquals, assignment)) return;
        if (needDedup) {
          const c = canonical(assignment);
          if (seen.has(c)) return;
          seen.add(c);
        }
        results.push({ ...assignment });
      }
      return;
    }

    const part = parts[pi];
    switch (part.t) {
      case 'dot':
        if (i < W) helper(i + 1, pi + 1, assignment);
        break;
      case 'lit':
        if (word.startsWith(part.s, i)) helper(i + part.s.length, pi + 1, assignment);
        break;
      case 'class':
        if (i < W && part.re.test(word[i])) helper(i + 1, pi + 1, assignment);
        break;
      case 'star':
        for (let j = i; j <= W; j++) helper(j, pi + 1, assignment);
        break;
      case 'anagram':
        if (anagramMatches(part, word.slice(i))) helper(W, pi + 1, assignment);
        break;
      case 'var':
      case 'rev': {
        const name = part.name;
        if (name in assignment) {
          let val = assignment[name];
          if (part.t === 'rev') val = reverse(val);
          if (word.startsWith(val, i)) helper(i + val.length, pi + 1, assignment);
        } else {
          const b = boundsOf(varBounds, name);
          const min = b.min;
          const max = Math.min(W - i, b.max);
          const vp = varEqualsPattern[name];
          const vnp = varNotEqualsPattern[name];
          const neq = varNotEqualsVar[name];
          for (let L = min; L <= max; L++) {
            const sub = word.slice(i, i + L);
            const boundVal = part.t === 'rev' ? reverse(sub) : sub;
            if (vp && !vp.test(boundVal)) continue;
            if (vnp && vnp.some(n => L >= n.min && (n.max === Infinity || L <= n.max) && n.test(boundVal))) continue;
            if (neq && neq.some(o => assignment[o] === boundVal)) continue;
            assignment[name] = boundVal;
            helper(i + L, pi + 1, assignment);
            delete assignment[name];
          }
        }
        break;
      }
    }
    if (needDedup) memo.add(key);
  }

  helper(0, 0, {});
  return results;
}

export function matchesPattern(word, pattern, constraints) {
  return matchPattern(word, pattern, constraints).length > 0;
}

// Where each variable occurrence sits in a matched word (`[{ name, start, len }]`),
// for Umiaq's per-variable highlight colors. A single star's slack is recoverable
// from the token widths, but two or more leave the split under-determined by the
// assignment alone — hence the regex fallback below rather than the offset walk.
export function variableRanges(word, pattern, assignment) {
  const tokens = pattern.tokens;
  if (tokens.length === 1 && tokens[0].t === 'anagram') return [];
  let stars = 0, fixed = 0;
  for (const t of tokens) {
    if (t.t === 'star') stars++;
    else if (t.t === 'lit') fixed += t.s.length;
    else if (t.t === 'var' || t.t === 'rev') fixed += assignment[t.name].length;
    else fixed += 1;   // dot | class
  }
  if (stars > 1) return variableRangesByRegex(word, tokens, assignment);
  const starLen = word.length - fixed;
  if (stars === 1 && starLen < 0) return [];
  const ranges = [];
  let off = 0;
  for (const t of tokens) {
    if (t.t === 'star') off += starLen;
    else if (t.t === 'lit') off += t.s.length;
    else if (t.t === 'var' || t.t === 'rev') {
      const len = assignment[t.name].length;
      ranges.push({ name: t.name, start: off, len });
      off += len;
    } else off += 1;   // dot | class
  }
  return ranges;
}

// Any placement the lazy `.*?` stars settle on is a correct highlight — the variable
// letters are identical whichever split the engine picks. Kept off the ≤1-star path
// deliberately: a regex compiled per matched word is far pricier than the offset
// walk, and that path is hot (a broad filter runs this per matching entry).
function variableRangesByRegex(word, tokens, assignment) {
  let src = '';
  const names = [];
  for (const t of tokens) {
    if (t.t === 'lit') src += escapeRegex(t.s);
    else if (t.t === 'dot') src += '.';
    else if (t.t === 'star') src += '.*?';
    else if (t.t === 'class') src += t.src;
    else if (t.t === 'var' || t.t === 'rev') {
      const val = t.t === 'rev' ? reverse(assignment[t.name]) : assignment[t.name];
      names.push(t.name);
      src += '(' + escapeRegex(val) + ')';
    }
  }
  let m;
  try { m = new RegExp('^' + src + '$', 'ud').exec(word); } catch { return []; }
  if (!m) return [];
  const ranges = [];
  for (let g = 0; g < names.length; g++) {
    const idx = m.indices[g + 1];
    if (idx) ranges.push({ name: names[g], start: idx[0], len: idx[1] - idx[0] });
  }
  return ranges;
}

// Stable per-variable color: alphabetical rank, NOT bind/encounter order — the same
// variable must read one color across every lane and match, or the coloring loses
// its whole point (showing which chunks line up).
export function variableColors(variables) {
  const varColor = {};
  [...variables].sort().forEach((v, i) => { varColor[v] = i % VAR_HL_COLORS; });
  return varColor;
}

export function variableHighlights(word, pattern, assignment, varColor) {
  return variableRanges(word, pattern, assignment)
    .filter(r => r.len > 0)   // a zero-length variable spans nothing to color
    .map(r => ({ start: r.start, end: r.start + r.len, kind: 'umiaq-var-' + varColor[r.name] }));
}

// ─── Finding tuples ──────────────────────────────────────────────────────────
// A *solver* is a pattern plus the pool it matches: a binding matches the corpus and
// emits a result word; a termEquals matches its synthetic RHS pool and emits
// nothing (bind-and-prune only). Order solvers most-variables-first, then by greatest
// overlap with what's already ordered, so each later solver shares variables ("lookup
// keys") with an earlier one. Phase 1 buckets every solver's matches keyed by its
// lookup-key assignment; Phase 2 walks the first bucket and hash-joins down the chain.

function orderSolvers(solvers) {
  const remaining = solvers.map(s => ({ ...s, lookupKeys: [] }));
  let best = 0;
  for (let k = 1; k < remaining.length; k++) {
    if (remaining[k].p.variables.size > remaining[best].p.variables.size) best = k;
  }
  const ordered = [remaining.splice(best, 1)[0]];
  while (remaining.length) {
    const found = new Set();
    for (const o of ordered) for (const v of o.p.variables) found.add(v);
    let bi = 0, bestOverlap = -1;
    for (let k = 0; k < remaining.length; k++) {
      let overlap = 0;
      for (const v of remaining[k].p.variables) if (found.has(v)) overlap++;
      if (overlap > bestOverlap) { bestOverlap = overlap; bi = k; }
    }
    const next = remaining.splice(bi, 1)[0];
    next.lookupKeys = [...next.p.variables].filter(v => found.has(v)).sort();
    ordered.push(next);
  }
  return ordered;
}

const NOOP_Y = { due: () => false, yield: async () => {} };

// Past this many candidates per assignment, enumerate-and-probe costs more than the
// hash join it replaces, so such a query falls back to the bucket path.
const PROBE_CANDIDATE_CAP = 4096;

function classMembers(token) {
  if (!token._members) token._members = [...NORM_CHARS].filter(c => token.re.test(c));
  return token._members;
}

// Infinity = not enumerable (`*`, anagram) or past the cap, i.e. disqualified from the probe path.
function probeExpansion(pattern) {
  let prod = 1;
  for (const t of pattern.tokens) {
    if (t.t === 'star' || t.t === 'anagram') return Infinity;
    if (t.t === 'dot') prod *= NORM_CHARS.length;
    else if (t.t === 'class') prod *= classMembers(t).length || 1;
    if (prod > PROBE_CANDIDATE_CAP) return Infinity;
  }
  return prod;
}

// Callers must keep the branch count bounded (`probeExpansion` gates a ground binding;
// the affix classifier forbids `?`/class anchors): unbounded `?`/class here blows memory.
function expandTokens(tokens, assignment) {
  let strs = [''];
  for (const t of tokens) {
    if (t.t === 'lit') strs = strs.map(s => s + t.s);
    else if (t.t === 'var') strs = strs.map(s => s + assignment[t.name]);
    else if (t.t === 'rev') strs = strs.map(s => s + reverse(assignment[t.name]));
    else if (t.t === 'dot') strs = strs.flatMap(s => [...NORM_CHARS].map(c => s + c));
    else if (t.t === 'class') strs = strs.flatMap(s => classMembers(t).map(c => s + c));
  }
  return strs;
}

// ─── Affix-indexed join ──────────────────────────────────────────────────────
// A third strategy between the probe and bucket paths for chained-affix queries the
// probe path can't cover (driver lacks a variable) yet the bucket path explodes on (a
// free-affix binding matches the whole corpus in every split — `AandB;X;AX;XB`). It is
// index-driven and exhaustive, so `truncated` stays false unless the driver overflows.
// A free var grounds off a prefix (`AX`) or suffix (`XB`) range; with both, scanning the
// more selective side (and verifying the other) is what bounds the otherwise-long tail.

// A branch anchor (`?`/class) in the affix, a `*`/anagram, or an infix/second/unanchored
// free var disqualify → bucket fallback (correct, just not index-solvable here).
function classifyAffixBinding(solver, freeVar, ground, allowSuffix) {
  const tokens = solver.p.tokens;
  let pos = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === 'star' || t.t === 'anagram') return null;
    if (t.t === 'var' || t.t === 'rev') {
      if (t.name === freeVar) { if (pos !== -1) return null; pos = i; }   // free var must occur once
      else if (!ground.has(t.name)) return null;                          // a second ungrounded var
    } else if (t.t === 'dot' || t.t === 'class') return null;             // branch anchor → bucket
  }
  if (pos === -1) return null;
  const head = tokens.slice(0, pos);
  const tail = tokens.slice(pos + 1);
  if (tail.length === 0 && head.length > 0) return { kind: 'prefix', affix: head, freeTok: tokens[pos] };
  if (allowSuffix && head.length === 0 && tail.length > 0) return { kind: 'suffix', affix: tail, freeTok: tokens[pos] };
  return null;   // infix, or an unanchored free var
}

// Order the non-driver bindings into affix steps, or return null when no incremental
// grounding exists (→ bucket fallback). Each step either O(1)-probes a fully-ground
// binding or grounds one free variable by scanning an affix range; a variable with
// several affix introducers becomes one `introduce` step (one scans, the rest verify
// once it's ground). Term clauses aren't steps — every term variable is bound by some
// binding (parse guarantees it), so terms validate at emit like the bucket path's frame.
function planAffix(ordered, variables, allowSuffix) {
  const driver = ordered[0];
  const ground = new Set(driver.p.variables);
  const remaining = ordered.slice(1).filter(s => s.emit);
  const steps = [];
  while (remaining.length) {
    let drained = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const s = remaining[i];
      if ([...s.p.variables].every(v => ground.has(v)) && probeExpansion(s.p) !== Infinity) {
        steps.push({ kind: 'probe', solver: remaining.splice(i, 1)[0] });
        drained = true;
      }
    }
    if (drained) continue;
    let introVar = null;
    for (const s of remaining) {
      const free = [...s.p.variables].filter(v => !ground.has(v));
      if (free.length === 1 && classifyAffixBinding(s, free[0], ground, allowSuffix)) { introVar = free[0]; break; }
    }
    if (introVar === null) return null;
    const candidates = [];
    for (let i = remaining.length - 1; i >= 0; i--) {
      const s = remaining[i];
      const free = [...s.p.variables].filter(v => !ground.has(v));
      if (free.length === 1 && free[0] === introVar) {
        const cls = classifyAffixBinding(s, introVar, ground, allowSuffix);
        if (cls) { candidates.unshift({ solver: s, ...cls }); remaining.splice(i, 1); }
      }
    }
    steps.push({ kind: 'introduce', freeVar: introVar, candidates });
    ground.add(introVar);
  }
  for (const v of variables) if (!ground.has(v)) return null;
  return { driver, steps };
}

function isNormSorted(arr) {
  for (let i = 1; i < arr.length; i++) if (arr[i].norm < arr[i - 1].norm) return false;
  return true;
}

// First index whose norm is >= key, over a norm-sorted array.
function lowerBoundNorm(arr, key) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].norm < key) lo = mid + 1; else hi = mid; }
  return lo;
}

function lowerBoundRev(arr, key) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].r < key) lo = mid + 1; else hi = mid; }
  return lo;
}

// ─── Anagram solver ───────────────────────────────────────────────────────────
// The unbounded path for `A;B;AB=/random`: index the corpus by letter-multiset and split
// the target by recursive subtraction (how online anagram finders work), instead of
// enumerating rearrangements. Only the clean multi-word form (each variable its own
// whole-word binding) routes here; exotic forms keep the capped permutation path.

function charIdx(c) {
  const code = c.charCodeAt(0);
  return code >= 97 ? code - 97 : 26 + (code - 48);   // a-z → 0..25, 0-9 → 26..35
}

function countsOf(norm) {
  const c = new Int16Array(36);
  for (let i = 0; i < norm.length; i++) c[charIdx(norm[i])]++;
  return c;
}

function sigOfCounts(counts) {
  let s = '';
  for (let i = 0; i < 36; i++) if (counts[i]) s += NORM_CHARS[i].repeat(counts[i]);
  return s;
}

function planAnagramSolve(bindings, termEquals, termNotEquals, variables) {
  if (termEquals.length !== 1 || termNotEquals.length) return null;
  const tc = termEquals[0];
  if (!tc.anagram) return null;
  const termVars = [];
  const litCounts = new Int16Array(36);
  for (const t of tc.term.tokens) {
    if (t.t === 'var') { if (termVars.includes(t.name)) return null; termVars.push(t.name); }
    else if (t.t === 'lit') { for (const ch of t.s) litCounts[charIdx(ch)]++; }
    else return null;
  }
  if (bindings.length !== termVars.length || variables.size !== termVars.length) return null;
  const laneByVar = {};
  for (const b of bindings) {
    if (b.tokens.length !== 1 || b.tokens[0].t !== 'var') return null;
    const name = b.tokens[0].name;
    if (!termVars.includes(name) || laneByVar[name]) return null;
    laneByVar[name] = b;
  }
  // A term literal the target lacks drives a coordinate negative → no solutions, not an error.
  const target = new Int16Array(36);
  for (const ch in tc.anagram.required) target[charIdx(ch)] = tc.anagram.required[ch];
  let feasible = true;
  for (let i = 0; i < 36; i++) { target[i] -= litCounts[i]; if (target[i] < 0) feasible = false; }
  const lanes = bindings.map(b => ({ varName: b.tokens[0].name, binding: b }));
  return { lanes, vars: lanes.map(l => l.varName), target, feasible };
}

async function solveAnagram(parsed, pool, { numResults, maxMatchesPerPattern, onBatch, y, signal }) {
  const plan = parsed.anagramSolve;
  const { varBounds, varNotEqualsVar, varEqualsPattern, varNotEqualsPattern, sumLen, lenCompare } = parsed.constraints;
  const k = plan.vars.length;
  const varColor = variableColors(parsed.variables);
  const target = plan.target;
  let targetLen = 0;
  for (let i = 0; i < 36; i++) targetLen += target[i];

  const tuples = [];
  const seen = new Set();
  const pending = onBatch ? [] : null;
  const flush = async () => { if (pending?.length) await onBatch(pending.splice(0)); };

  if (!plan.feasible) { await flush(); return { tuples, truncated: false, capped: false }; }

  const laneBounds = plan.lanes.map(({ varName, binding }) => {
    let { min, max } = boundsOf(varBounds, varName);
    const wl = binding.wordLen; if (wl) { min = Math.max(min, wl.min); if (wl.max !== null) max = Math.min(max, wl.max); }
    return { min, max };
  });
  const laneOfVar = {};
  plan.vars.forEach((v, i) => { laneOfVar[v] = i; });

  const bySig = new Map();
  const sigList = [];
  const seenNorm = new Set();
  for (const entry of pool) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    const w = entry.norm;
    if (!w.length || w.length > targetLen || seenNorm.has(w)) continue;
    const counts = countsOf(w);
    let fits = true;
    for (let i = 0; i < 36; i++) if (counts[i] > target[i]) { fits = false; break; }
    if (!fits) continue;
    seenNorm.add(w);
    const sig = sigOfCounts(counts);
    let arr = bySig.get(sig);
    if (!arr) { bySig.set(sig, arr = []); sigList.push({ sig, counts, len: w.length }); }
    arr.push(entry);
  }

  // Must stay in lockstep with matchPattern's per-variable filtering (umiaq.js var/rev case),
  // or a constraint silently means something different here than on the flat path: the length
  // window, sub-pattern test, the length-guarded varNotEqualsPattern array, and A!=B vs chosen lanes.
  const accepts = (i, entry, chosen) => {
    const name = plan.vars[i];
    const w = entry.norm;
    const L = w.length;
    const b = laneBounds[i];
    if (L < b.min || L > b.max) return false;
    const vp = varEqualsPattern[name]; if (vp && !vp.test(w)) return false;
    const vnp = varNotEqualsPattern[name];
    if (vnp && vnp.some(n => L >= n.min && (n.max === Infinity || L <= n.max) && n.test(w))) return false;
    const neq = varNotEqualsVar[name];
    if (neq) for (const o of neq) { const j = laneOfVar[o]; if (j !== undefined && j < i && chosen[j].norm === w) return false; }
    return true;
  };

  const emit = chosen => {
    const assignment = {};
    for (let i = 0; i < k; i++) assignment[plan.vars[i]] = chosen[i].norm;
    if (sumLen.length && !sumLenOK(sumLen, assignment)) return;
    if (lenCompare.length && !lenCompareOK(lenCompare, assignment)) return;
    const lanes = chosen.map((entry, i) => {
      const hl = variableHighlights(entry.norm, plan.lanes[i].binding, { [plan.vars[i]]: entry.norm }, varColor);
      return { entry, highlights: hl.length ? hl : null };
    });
    const key = lanes.map(l => l.entry.norm).join('\0');
    if (seen.has(key)) return;
    seen.add(key);
    tuples.push(lanes);
    pending?.push(lanes);
  };

  let truncated = false;
  let probes = 0;
  const dfs = async (i, remaining, chosen) => {
    if (tuples.length >= numResults || truncated) return;
    if (i === k - 1) {
      // Last lane: the remainder must itself be a whole word — one complement lookup.
      const entries = bySig.get(sigOfCounts(remaining));
      if (entries) for (const e of entries) {
        if (accepts(i, e, chosen)) { chosen.push(e); emit(chosen); chosen.pop(); if (tuples.length >= numResults) return; }
      }
      return;
    }
    for (const { sig, counts, len } of sigList) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      if (tuples.length >= numResults) return;
      if (++probes > maxMatchesPerPattern) { truncated = true; return; }
      const b = laneBounds[i];
      if (len < b.min || len > b.max) continue;
      let fits = true;
      for (let x = 0; x < 36; x++) if (counts[x] > remaining[x]) { fits = false; break; }
      if (!fits) continue;
      const next = remaining.slice();
      for (let x = 0; x < 36; x++) next[x] -= counts[x];
      for (const e of bySig.get(sig)) {
        if (!accepts(i, e, chosen)) continue;
        chosen.push(e);
        await dfs(i + 1, next, chosen);
        chosen.pop();
        if (tuples.length >= numResults || truncated) return;
      }
      if (y.due()) { await flush(); await y.yield(); }
    }
  };

  await dfs(0, target.slice(), []);
  await flush();
  return { tuples, truncated, capped: tuples.length >= numResults };
}

// Two strategies, chosen by `probeable` below. The probe path is exhaustive
// over the corpus; the bucket path truncates at `maxMatchesPerPattern` (reporting
// `truncated`) to bound a free-variable pattern's runaway assignments, so it can miss
// matches past the cap. Collapsing the two back into one reintroduces that
// truncation for the queries the probe path covers exactly — the bug this fixes.
// The budget params aren't redundant with `numResults`: a search with few
// consistent tuples pays its full cost before producing any, so the work itself —
// not just the output count — has to be bounded.
// `strategy` is a test/debug seam: 'bucket' forces the general path, so a parity test
// can compare an index path's output against the exhaustive bucket join for one query.
export async function findTuples(parsed, pool, {
  numResults = 100,
  maxMatchesPerPattern = 200_000,
  onBatch = null,
  y = NOOP_Y,
  signal = null,
  strategy = 'auto',
} = {}) {
  if (parsed.anagramSolve) return solveAnagram(parsed, pool, { numResults, maxMatchesPerPattern, onBatch, y, signal });
  const { bindings, constraints } = parsed;
  const sumLen = constraints.sumLen || [];
  const lenCompare = constraints.lenCompare || [];
  const termEquals = constraints.termEquals || [];
  const termNotEquals = constraints.termNotEquals || [];

  const solvers = [
    ...bindings.map((p, i) => ({ p, pool, emit: true, outIdx: i })),
    ...termEquals.map(e => ({ p: e.pattern, pool: e.rhsEntries, emit: false, outIdx: -1 })),
  ];
  const ordered = orderSolvers(solvers);
  const N = ordered.length;
  const emittingCount = bindings.length;
  const varColor = variableColors(parsed.variables);

  const tuples = [];
  const seenTuples = new Set();
  const pending = onBatch ? [] : null;
  const flush = async () => { if (pending?.length) await onBatch(pending.splice(0)); };

  const makeLane = (k, entry, assignment) => {
    const highlights = variableHighlights(entry.norm, ordered[k].p, assignment, varColor);
    return { entry, highlights: highlights.length ? highlights : null };
  };
  // Drop the non-emitting term-equals solvers and restore the user's binding order.
  const emit = orderedParts => {
    const lanes = new Array(emittingCount);
    for (let k = 0; k < N; k++) {
      const s = ordered[k];
      if (s.emit) lanes[s.outIdx] = makeLane(k, orderedParts[k].entry, orderedParts[k].assignment);
    }
    const dedupeKey = lanes.map(l => l.entry.norm).join('\0');
    if (seenTuples.has(dedupeKey)) return;
    seenTuples.add(dedupeKey);
    tuples.push(lanes);
    pending?.push(lanes);
  };

  const driverHasAllVars = ordered[0].p.variables.size === parsed.variables.size;
  const probeable = strategy !== 'bucket' && driverHasAllVars && ordered.slice(1).every(o => probeExpansion(o.p) !== Infinity);

  // ── Probe path ─────────────────────────────────────────────────────────────
  if (probeable) {
    const corpusIndex = new Map();
    for (const e of pool) if (!corpusIndex.has(e.norm)) corpusIndex.set(e.norm, e);
    // A solver resolves its candidates against its own pool — a binding against the
    // corpus, a termEquals against its synthetic RHS set, not the corpus.
    const lookups = ordered.map(s => {
      if (s.emit) return corpusIndex;
      const m = new Map();
      for (const e of s.pool) if (!m.has(e.norm)) m.set(e.norm, e);
      return m;
    });

    outer:
    for (const entry of ordered[0].pool) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      for (const assignment of matchPattern(entry.norm, ordered[0].p, constraints)) {
        const partLists = new Array(N);
        partLists[0] = [{ entry, assignment }];
        let ok = true;
        for (let oi = 1; oi < N; oi++) {
          const wl = ordered[oi].p.wordLen;
          const parts = [];
          for (const nrm of expandTokens(ordered[oi].p.tokens, assignment)) {
            if (wl && (nrm.length < wl.min || (wl.max !== null && nrm.length > wl.max))) continue;
            const e2 = lookups[oi].get(nrm);
            if (e2) parts.push({ entry: e2, assignment });
          }
          if (!parts.length) { ok = false; break; }
          partLists[oi] = parts;
        }
        if (ok) {
          const combo = new Array(N);
          const build = oi => {
            if (tuples.length >= numResults) return;
            if (oi === N) { emit(combo); return; }
            for (const part of partLists[oi]) { combo[oi] = part; build(oi + 1); }
          };
          build(0);
        }
        if (tuples.length >= numResults) break outer;
      }
      if (y.due()) { await flush(); await y.yield(); }
    }
    await flush();
    return { tuples, truncated: false, capped: tuples.length >= numResults };
  }

  // ── Affix path ───────────────────────────────────────────────────────────────
  const affixPlan = strategy !== 'bucket' ? planAffix(ordered, parsed.variables, true) : null;
  if (affixPlan) {
    const { driver, steps } = affixPlan;

    const byNorm = new Map();
    for (const e of pool) if (!byNorm.has(e.norm)) byNorm.set(e.norm, e);
    // Prefix scans need norm order. The head-tool pool already is (the corpus is
    // norm-sorted); a chained pool may not be, so sort a copy only when it isn't.
    const sortedByNorm = isNormSorted(pool)
      ? pool
      : [...pool].sort((a, b) => a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0);
    // The suffix index (reversed-norm order) is built per run and never cached, so a My
    // Edits splice can't leave it stale; only pay its O(n log n) when a suffix scan exists.
    const needsSuffix = steps.some(s => s.kind === 'introduce' && s.candidates.some(c => c.kind === 'suffix'));
    const sortedByRev = needsSuffix
      ? pool.map(e => ({ r: reverse(e.norm), e })).sort((a, b) => a.r < b.r ? -1 : a.r > b.r ? 1 : 0)
      : null;

    // Reproduce matchPattern's per-variable filtering for a value bound off an affix
    // scan (length window, sub-pattern, length-guarded !=sub-pattern, A!=B) — drift
    // and a constraint silently means something different here than on the flat path.
    const acceptVar = (name, boundVal, assignment) => {
      const L = boundVal.length;
      const { min, max } = boundsOf(constraints.varBounds, name);
      if (L < min || L > max) return false;
      const vp = constraints.varEqualsPattern[name];
      if (vp && !vp.test(boundVal)) return false;
      const vnp = constraints.varNotEqualsPattern[name];
      if (vnp && vnp.some(n => L >= n.min && (n.max === Infinity || L <= n.max) && n.test(boundVal))) return false;
      const neq = constraints.varNotEqualsVar[name];
      if (neq && neq.some(o => o in assignment && assignment[o] === boundVal)) return false;
      return true;
    };
    const wordLenOK = (wl, len) => !wl || (len >= wl.min && (wl.max === null || len <= wl.max));
    const makeLaneP = (pattern, entry, assignment) => {
      const highlights = variableHighlights(entry.norm, pattern, assignment, varColor);
      return { entry, highlights: highlights.length ? highlights : null };
    };

    const stepLanes = new Array(steps.length);   // {solver, entry}[] per step, filled during the DFS
    let driverEntry = null;

    const emitAffix = assignment => {
      const lanes = new Array(emittingCount);
      if (driver.emit) lanes[driver.outIdx] = makeLaneP(driver.p, driverEntry, assignment);
      for (let si = 0; si < steps.length; si++)
        for (const rec of stepLanes[si]) lanes[rec.solver.outIdx] = makeLaneP(rec.solver.p, rec.entry, assignment);
      const dedupeKey = lanes.map(l => l.entry.norm).join('\0');
      if (seenTuples.has(dedupeKey)) return;
      seenTuples.add(dedupeKey);
      tuples.push(lanes);
      pending?.push(lanes);
    };

    // Yields one entry per distinct norm, and it must be byNorm's (the first in pool
    // order — a stable sort keeps ties in place), or an emitted lane would differ from
    // what the probe/bucket paths pick for the same norm and parity would break.
    const scanPrefix = (prefix, visit) => {
      let prev = null;
      for (let i = lowerBoundNorm(sortedByNorm, prefix); i < sortedByNorm.length; i++) {
        const e = sortedByNorm[i];
        if (!e.norm.startsWith(prefix)) break;
        if (e.norm === prev) continue;
        prev = e.norm;
        if (visit(e)) return;
      }
    };
    const scanSuffix = (suffix, visit) => {
      const target = reverse(suffix);
      let prev = null;
      for (let i = lowerBoundRev(sortedByRev, target); i < sortedByRev.length; i++) {
        const e = sortedByRev[i].e;
        if (!sortedByRev[i].r.startsWith(target)) break;
        if (e.norm === prev) continue;
        prev = e.norm;
        if (visit(e)) return;
      }
    };
    // ￿ exceeds every norm char (norm is [a-z0-9]), so [affix, affix+￿) is exactly the
    // affix range; widen norm's alphabet past ￿ and this silently overcounts.
    const countAffix = (kind, affix) => kind === 'prefix'
      ? lowerBoundNorm(sortedByNorm, affix + '￿') - lowerBoundNorm(sortedByNorm, affix)
      : (r => lowerBoundRev(sortedByRev, r + '￿') - lowerBoundRev(sortedByRev, r))(reverse(affix));

    const recurse = (si, assignment) => {
      if (tuples.length >= numResults) return true;
      if (si === steps.length) {
        if (sumLen.length && !sumLenOK(sumLen, assignment)) return false;
        if (lenCompare.length && !lenCompareOK(lenCompare, assignment)) return false;
        if ((termEquals.length || termNotEquals.length) && !termsOK(termEquals, termNotEquals, assignment)) return false;
        emitAffix(assignment);
        return tuples.length >= numResults;
      }
      const step = steps[si];
      if (step.kind === 'probe') {
        const s = step.solver, wl = s.p.wordLen;
        for (const nrm of expandTokens(s.p.tokens, assignment)) {
          if (!wordLenOK(wl, nrm.length)) continue;
          const e = byNorm.get(nrm);
          if (!e) continue;
          stepLanes[si] = [{ solver: s, entry: e }];
          if (recurse(si + 1, assignment)) return true;
        }
        return false;
      }
      const X = step.freeVar;
      let enumerator = step.candidates[0];
      let enumAffix = expandTokens(enumerator.affix, assignment)[0];   // branchless → one string
      if (step.candidates.length > 1) {
        let bestCount = countAffix(enumerator.kind, enumAffix);
        for (let ci = 1; ci < step.candidates.length; ci++) {
          const c = step.candidates[ci];
          const affix = expandTokens(c.affix, assignment)[0];
          const count = countAffix(c.kind, affix);
          if (count < bestCount) { bestCount = count; enumerator = c; enumAffix = affix; }
        }
      }
      const others = step.candidates.filter(c => c !== enumerator);
      const enumTok = enumerator.freeTok, enumWl = enumerator.solver.p.wordLen, enumLen = enumAffix.length;
      let stopped = false;
      const visit = e => {
        const raw = enumerator.kind === 'prefix' ? e.norm.slice(enumLen) : e.norm.slice(0, e.norm.length - enumLen);
        const boundVal = enumTok.t === 'rev' ? reverse(raw) : raw;
        if (!acceptVar(X, boundVal, assignment)) return false;
        if (!wordLenOK(enumWl, e.norm.length)) return false;
        assignment[X] = boundVal;
        const laneRecs = [{ solver: enumerator.solver, entry: e }];
        let ok = true;
        for (const oc of others) {
          const owl = oc.solver.p.wordLen;
          let hit = null;
          for (const nrm of expandTokens(oc.solver.p.tokens, assignment)) {
            if (wordLenOK(owl, nrm.length)) { const oe = byNorm.get(nrm); if (oe) { hit = oe; break; } }
          }
          if (!hit) { ok = false; break; }
          laneRecs.push({ solver: oc.solver, entry: hit });
        }
        if (ok) { stepLanes[si] = laneRecs; if (recurse(si + 1, assignment)) stopped = true; }
        delete assignment[X];
        return stopped;
      };
      if (enumerator.kind === 'prefix') scanPrefix(enumAffix, visit);
      else scanSuffix(enumAffix, visit);
      return stopped;
    };

    // Best-first by score keeps high-value tuples inside the result cap: without it,
    // the answer (cock-and-bull) sits past a cap full of junk short-var tuples.
    const driverMatches = [];
    let truncated = false;
    outer:
    for (const entry of driver.pool) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      for (const assignment of matchPattern(entry.norm, driver.p, constraints)) {
        driverMatches.push({ entry, assignment });
        if (driverMatches.length >= maxMatchesPerPattern) { truncated = true; break outer; }
      }
    }
    driverMatches.sort((a, b) => (b.entry.score ?? 0) - (a.entry.score ?? 0));

    for (const { entry, assignment } of driverMatches) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      driverEntry = entry;
      if (recurse(0, assignment)) break;
      if (y.due()) { await flush(); await y.yield(); }
    }
    await flush();
    return { tuples, truncated, capped: tuples.length >= numResults };
  }

  // ── Bucket path ──────────────────────────────────────────────────────────────
  const buckets = ordered.map(() => new Map());
  const counts = new Array(N).fill(0);
  let truncated = false;
  for (let oi = 0; oi < N; oi++) {
    const { p, pool: solverPool, lookupKeys } = ordered[oi];
    for (const entry of solverPool) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      if (counts[oi] >= maxMatchesPerPattern) { truncated = true; break; }
      for (const assignment of matchPattern(entry.norm, p, constraints)) {
        const key = lookupKeys.length ? lookupKeys.map(v => v + '=' + assignment[v]).join('\0') : '';
        let bucket = buckets[oi].get(key);
        if (!bucket) buckets[oi].set(key, bucket = []);
        bucket.push({ assignment, entry });
        if (++counts[oi] >= maxMatchesPerPattern) { truncated = true; break; }
      }
      if (y.due()) await y.yield();
    }
  }

  // Phase 2 is an explicit DFS work-stack, not native recursion: making the
  // recursion async (to yield mid-join + flush streamed batches) would chain the
  // whole search tree through the microtask queue, an O(nodes) cost on a wide join.
  // The stack yields on `y.due()` alone — don't "simplify" it back to recursion.
  const frames = [{ list: buckets[0].get('') || [], i: 0, index: 0, selected: [], dict: {} }];
  while (frames.length) {
    if (tuples.length >= numResults) break;
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    const f = frames[frames.length - 1];
    if (f.index === N) {
      if (sumLenOK(sumLen, f.dict) && lenCompareOK(lenCompare, f.dict) && termsOK(termEquals, termNotEquals, f.dict)) emit(f.selected);
      frames.pop(); continue;
    }
    if (f.i >= f.list.length) { frames.pop(); continue; }
    const part = f.list[f.i++];
    const merged = { ...f.dict };
    for (const v of ordered[f.index].p.variables) if (!(v in merged)) merged[v] = part.assignment[v];
    const nextList = f.index + 1 < N
      ? (buckets[f.index + 1].get(ordered[f.index + 1].lookupKeys.map(v => v + '=' + merged[v]).join('\0')) || [])
      : [];
    frames.push({ list: nextList, i: 0, index: f.index + 1, selected: [...f.selected, part], dict: merged });
    if (y.due()) { await flush(); await y.yield(); }
  }
  await flush();

  return { tuples, truncated, capped: tuples.length >= numResults };
}
