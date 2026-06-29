'use strict';

import { CONSONANTS, VOWELS, escapeRegex, escapeRegexClass } from './search.js';

// ─── Umiaq — variable/pattern search ────────────────────────────────────────
// A JS reimplementation of Umiaq's pattern language (Alex Boisvert / Crossword
// Nexus, MIT), written against its source as the reference spec. Two deliberate
// departures, each of which silently diverges from intent if "corrected":
// matching binds over `norm` (variables capture accent/space-stripped lowercase
// substrings — the only representation where a binding stays consistent across a
// word's spellings), and `#`/`@`/`[…]` are Grawlix's search classes, so `#`
// includes Y and `@` excludes it — the opposite of Umiaq's own classes.

const reverse = s => { let o = ''; for (let i = s.length - 1; i >= 0; i--) o += s[i]; return o; };

// Variable highlight palette size — cycles the shared --hl0..N colors (CSS
// .hl-umiaq-var-N) so a query with more variables than colors still renders.
const VAR_HL_COLORS = 9;

// ─── Parsing ─────────────────────────────────────────────────────────────────

const LEN_CONSTRAINT_RE = /^\|([A-Z])\|(<=|>=|<|>|=)(\d+)$/;
const NEQ_CONSTRAINT_RE = /^!=([A-Z]{2,})$/;

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
      throw 'anagram (/) is not supported yet';
    } else if (ch === ' ') {
      continue;
    } else {
      throw `unexpected character "${ch}"`;
    }
  }
  return { tokens, variables };
}

// Cheap full-word reject run before the backtracker. Each variable becomes `.+`
// (or `.{m,n}` when length-bound) independently, so this over-approximates —
// repeated-variable equality is the matcher's job — but it never rejects a real
// match, which is what makes short-circuiting on it safe.
function compilePrefilter(tokens, length) {
  let body = '';
  for (const part of tokens) {
    if (part.t === 'lit') body += escapeRegex(part.s);
    else if (part.t === 'dot') body += '.';
    else if (part.t === 'star') body += '.*';
    else if (part.t === 'class') body += part.src;
    else {
      const lc = length[part.name];
      if (!lc) body += '.+';
      else if (lc.max === Infinity) body += `.{${lc.min},}`;
      else body += `.{${lc.min},${lc.max}}`;
    }
  }
  return new RegExp(`^(?:${body})$`, 'u');
}

export function parseUmiaqQuery(query) {
  const q = (query || '').normalize('NFC').trim();
  if (!q) return { ok: false, empty: true };

  const clauses = q.split(';').map(c => c.trim());
  const length = {};
  const notEqual = {};
  const patternClauses = [];

  for (const clause of clauses) {
    if (clause.includes('=') || clause.startsWith('|')) {
      const lm = LEN_CONSTRAINT_RE.exec(clause);
      if (lm) {
        const v = lm[1], op = lm[2], n = +lm[3];
        let min = 1, max = Infinity;
        if (op === '=') min = max = n;
        else if (op === '>') min = n + 1;
        else if (op === '>=') min = n;
        else if (op === '<') max = n - 1;
        else if (op === '<=') max = n;
        min = Math.max(1, min);
        if (max < 1) return { ok: false, error: `${clause} — length must be at least 1` };
        // Two operator constraints on one variable intersect into a range
        // (|A|>=2;|A|<=5), so a later clause narrows rather than replaces.
        const prev = length[v];
        if (prev) { min = Math.max(min, prev.min); max = Math.min(max, prev.max); }
        if (min > max) return { ok: false, error: `${clause} — contradicts an earlier |${v}| constraint` };
        length[v] = { min, max };
        continue;
      }
      const nm = NEQ_CONSTRAINT_RE.exec(clause);
      if (nm) {
        const vars = [...new Set(nm[1])];
        for (const v of vars) (notEqual[v] ??= []).push(...vars.filter(o => o !== v));
        continue;
      }
      return { ok: false, error: `unsupported constraint "${clause}"` };
    }
    // A trailing or doubled `;` leaves an empty clause — almost always mid-typing,
    // so stay inert rather than erroring while the user composes the next pattern.
    if (!clause) return { ok: false, empty: true };
    patternClauses.push(clause);
  }

  if (!patternClauses.length) return { ok: false, empty: true };

  const patterns = [];
  const variables = new Set();
  for (const clause of patternClauses) {
    let parsed;
    try { parsed = tokenizePattern(clause); }
    catch (msg) { return { ok: false, error: typeof msg === 'string' ? msg : String(msg) }; }
    if (!parsed.tokens.length) return { ok: false, empty: true };
    for (const v of parsed.variables) variables.add(v);
    const stars = parsed.tokens.reduce((n, t) => n + (t.t === 'star' ? 1 : 0), 0);
    patterns.push({ ...parsed, src: clause, stars, prefilter: compilePrefilter(parsed.tokens, length) });
  }

  for (const v of Object.keys(notEqual)) notEqual[v] = [...new Set(notEqual[v])];

  return { ok: true, patterns, constraints: { length, notEqual }, arity: patterns.length, variables };
}

// ─── Matching ────────────────────────────────────────────────────────────────
// Enumerate every binding map (var → bound substring) by which `pattern` matches
// `word`. Memoized backtracker over (word index, token index, bindings), faithful
// to Umiaq's matcher except for the prefilter and the result-dedupe. Variables
// bind non-empty substrings (min length 1); `*` spans zero or more characters.

function canonical(bindings) {
  const keys = Object.keys(bindings);
  if (!keys.length) return '';
  keys.sort();
  let s = '';
  for (const k of keys) s += k + '=' + bindings[k] + ',';
  return s;
}

export function matchPattern(word, pattern, constraints = { length: {}, notEqual: {} }) {
  if (!pattern.prefilter.test(word)) return [];

  const parts = pattern.tokens;
  const W = word.length;
  const length = constraints.length || {};
  const notEqual = constraints.notEqual || {};
  const results = [];
  // Paths reconverge — and the per-node `canonical()` memo/dedup that costs ~200µs
  // a word earns its keep — only with ≥2 stars (`**`, `*a*`): a single star or
  // any number of variables advance the position uniquely, so distinct paths can't
  // collide on (i, pi, bindings). Skipping it for the star-light common case
  // (ABC;CBA, AB;BA, …) is the difference between a snappy run and a 40s one.
  const needDedup = (pattern.stars ?? parts.reduce((n, t) => n + (t.t === 'star' ? 1 : 0), 0)) >= 2;
  const seen = needDedup ? new Set() : null;
  const memo = needDedup ? new Set() : null;

  function helper(i, pi, bindings) {
    let key;
    if (needDedup) {
      key = i + '|' + pi + '|' + canonical(bindings);
      if (memo.has(key)) return;
    }

    if (pi === parts.length) {
      if (i === W) {
        if (needDedup) {
          const c = canonical(bindings);
          if (seen.has(c)) return;
          seen.add(c);
        }
        results.push({ ...bindings });
      }
      return;
    }

    const part = parts[pi];
    switch (part.t) {
      case 'dot':
        if (i < W) helper(i + 1, pi + 1, bindings);
        break;
      case 'lit':
        if (word.startsWith(part.s, i)) helper(i + part.s.length, pi + 1, bindings);
        break;
      case 'class':
        if (i < W && part.re.test(word[i])) helper(i + 1, pi + 1, bindings);
        break;
      case 'star':
        for (let j = i; j <= W; j++) helper(j, pi + 1, bindings);
        break;
      case 'var':
      case 'rev': {
        const name = part.name;
        if (name in bindings) {
          let val = bindings[name];
          if (part.t === 'rev') val = reverse(val);
          if (word.startsWith(val, i)) helper(i + val.length, pi + 1, bindings);
        } else {
          let min = 1, max = W - i;
          const lc = length[name];
          if (lc) { min = Math.max(min, lc.min); max = Math.min(max, lc.max); }
          const neq = notEqual[name];
          for (let L = min; L <= max; L++) {
            const sub = word.slice(i, i + L);
            const boundVal = part.t === 'rev' ? reverse(sub) : sub;
            if (neq && neq.some(o => bindings[o] === boundVal)) continue;
            bindings[name] = boundVal;
            helper(i + L, pi + 1, bindings);
            delete bindings[name];
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
// for Umiaq's per-variable highlight colors. A pattern with more than one `*`
// leaves the offsets under-determined — the stars' split isn't recoverable from the
// bindings — so it yields no ranges rather than wrong ones; a single `*` takes the slack.
export function variableRanges(word, pattern, bindings) {
  const tokens = pattern.tokens;
  let stars = 0, fixed = 0;
  for (const t of tokens) {
    if (t.t === 'star') stars++;
    else if (t.t === 'lit') fixed += t.s.length;
    else if (t.t === 'var' || t.t === 'rev') fixed += bindings[t.name].length;
    else fixed += 1;   // dot | class
  }
  if (stars > 1) return [];
  const starLen = word.length - fixed;
  if (stars === 1 && starLen < 0) return [];
  const ranges = [];
  let off = 0;
  for (const t of tokens) {
    if (t.t === 'star') off += starLen;
    else if (t.t === 'lit') off += t.s.length;
    else if (t.t === 'var' || t.t === 'rev') {
      const len = bindings[t.name].length;
      ranges.push({ name: t.name, start: off, len });
      off += len;
    } else off += 1;   // dot | class
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

export function variableHighlights(word, pattern, bindings, varColor) {
  return variableRanges(word, pattern, bindings)
    .map(r => ({ start: r.start, end: r.start + r.len, kind: 'umiaq-var-' + varColor[r.name] }));
}

// ─── Finding tuples ──────────────────────────────────────────────────────────
// Order the patterns most-variables-first, then by greatest overlap with what's
// already ordered, so each later pattern shares variables ("lookup keys") with an
// earlier one. Phase 1 buckets every pattern's matches keyed by its lookup-key
// bindings; Phase 2 walks the first bucket and hash-joins down the chain.

function orderPatterns(patterns) {
  const remaining = patterns.map((p, idx) => ({ p, idx, lookupKeys: [] }));
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

const NORM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Past this many candidates per binding, enumerate-and-probe costs more than the
// hash join it replaces, so such a query falls back to the bucket path.
const PROBE_CANDIDATE_CAP = 4096;

function classMembers(token) {
  if (!token._members) token._members = [...NORM_CHARS].filter(c => token.re.test(c));
  return token._members;
}

// Infinity = not enumerable (`*`) or past the cap, i.e. disqualified from the probe path.
function probeExpansion(pattern) {
  let prod = 1;
  for (const t of pattern.tokens) {
    if (t.t === 'star') return Infinity;
    if (t.t === 'dot') prod *= NORM_CHARS.length;
    else if (t.t === 'class') prod *= classMembers(t).length || 1;
    if (prod > PROBE_CANDIDATE_CAP) return Infinity;
  }
  return prod;
}

// Two strategies, chosen by `probeable` below. The probe path is exhaustive
// over the corpus; the bucket path truncates at `maxMatchesPerPattern` (reporting
// `truncated`) to bound a free-variable pattern's runaway bindings, so it can miss
// matches past the cap. Collapsing the two back into one reintroduces that
// truncation for the queries the probe path covers exactly — the bug this fixes.
// The budget params aren't redundant with `numResults`: a search with few
// consistent tuples pays its full cost before producing any, so the work itself —
// not just the output count — has to be bounded.
export async function findTuples(parsed, pool, {
  numResults = 100,
  maxMatchesPerPattern = 200_000,
  bestFirst = true,
  onBatch = null,
  y = NOOP_Y,
  signal = null,
} = {}) {
  const { patterns, constraints } = parsed;
  const ordered = orderPatterns(patterns);
  const N = ordered.length;
  const indexOrder = ordered.map(o => o.idx);
  const varColor = variableColors(parsed.variables);
  const candidates = bestFirst ? [...pool].sort((a, b) => b.score - a.score) : pool;

  const tuples = [];
  const seenTuples = new Set();
  const pending = onBatch ? [] : null;
  const flush = async () => { if (pending?.length) await onBatch(pending.splice(0)); };

  const makeLane = (oi, entry, bindings) => {
    const highlights = variableHighlights(entry.norm, ordered[oi].p, bindings, varColor);
    return { entry, highlights: highlights.length ? highlights : null };
  };
  // orderPatterns reordered the lanes; map them back to the user's order.
  const emit = orderedLanes => {
    const lanes = new Array(N);
    for (let k = 0; k < N; k++) lanes[indexOrder[k]] = orderedLanes[k];
    const dedupeKey = lanes.map(l => l.entry.norm).join('\0');
    if (seenTuples.has(dedupeKey)) return;
    seenTuples.add(dedupeKey);
    tuples.push(lanes);
    pending?.push(lanes);
  };

  const driverHasAllVars = ordered[0].p.variables.size === parsed.variables.size;
  const probeable = driverHasAllVars && ordered.slice(1).every(o => probeExpansion(o.p) !== Infinity);

  // ── Probe path ─────────────────────────────────────────────────────────────
  if (probeable) {
    const normIndex = new Map();
    for (const e of candidates) if (!normIndex.has(e.norm)) normIndex.set(e.norm, e);

    const genCandidates = (oi, b) => {
      let strs = [''];
      for (const t of ordered[oi].p.tokens) {
        if (t.t === 'lit') strs = strs.map(s => s + t.s);
        else if (t.t === 'var') strs = strs.map(s => s + b[t.name]);
        else if (t.t === 'rev') { const r = reverse(b[t.name]); strs = strs.map(s => s + r); }
        else if (t.t === 'dot') strs = strs.flatMap(s => [...NORM_CHARS].map(c => s + c));
        else if (t.t === 'class') strs = strs.flatMap(s => classMembers(t).map(c => s + c));
      }
      return strs;
    };

    outer:
    for (const entry of candidates) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      for (const bindings of matchPattern(entry.norm, ordered[0].p, constraints)) {
        const laneLists = new Array(N);
        laneLists[0] = [makeLane(0, entry, bindings)];
        let ok = true;
        for (let oi = 1; oi < N; oi++) {
          const lanes = [];
          for (const nrm of genCandidates(oi, bindings)) {
            const e2 = normIndex.get(nrm);
            if (e2) lanes.push(makeLane(oi, e2, bindings));
          }
          if (!lanes.length) { ok = false; break; }
          laneLists[oi] = lanes;
        }
        if (ok) {
          const combo = new Array(N);
          const build = oi => {
            if (tuples.length >= numResults) return;
            if (oi === N) { emit(combo); return; }
            for (const lane of laneLists[oi]) { combo[oi] = lane; build(oi + 1); }
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

  // ── Bucket path ──────────────────────────────────────────────────────────────
  const buckets = ordered.map(() => new Map());
  const counts = new Array(N).fill(0);
  let truncated = false;
  for (const entry of candidates) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    for (let oi = 0; oi < N; oi++) {
      if (counts[oi] >= maxMatchesPerPattern) { truncated = true; continue; }
      const { p, lookupKeys } = ordered[oi];
      for (const bindings of matchPattern(entry.norm, p, constraints)) {
        const key = lookupKeys.length ? lookupKeys.map(v => v + '=' + bindings[v]).join('\0') : '';
        let bucket = buckets[oi].get(key);
        if (!bucket) buckets[oi].set(key, bucket = []);
        bucket.push({ bindings, entry });
        if (++counts[oi] >= maxMatchesPerPattern) { truncated = true; break; }
      }
    }
    if (y.due()) await y.yield();
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
    if (f.index === N) { emit(f.selected.map((part, oi) => makeLane(oi, part.entry, part.bindings))); frames.pop(); continue; }
    if (f.i >= f.list.length) { frames.pop(); continue; }
    const part = f.list[f.i++];
    const merged = { ...f.dict };
    for (const v of ordered[f.index].p.variables) if (!(v in merged)) merged[v] = part.bindings[v];
    const nextList = f.index + 1 < N
      ? (buckets[f.index + 1].get(ordered[f.index + 1].lookupKeys.map(v => v + '=' + merged[v]).join('\0')) || [])
      : [];
    frames.push({ list: nextList, i: 0, index: f.index + 1, selected: [...f.selected, part], dict: merged });
    if (y.due()) { await flush(); await y.yield(); }
  }
  await flush();

  return { tuples, truncated, capped: tuples.length >= numResults };
}
