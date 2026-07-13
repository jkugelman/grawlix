'use strict';

import { toNorm, displayOf, normToDisplayMap } from './norm.js';
import { HL_COLORS, groupSpansToRanges } from './search.js';

// ─── Regex tool helpers ─────────────────────────────────────────────────────

// Splits the pattern into literal runs — maximal stretches of verbatim literal
// characters — and the wildcards between them: `.`, classes (`[…]`, `\d`…),
// quantified atoms, groups, alternation, anchors. The Regex tool colors each
// literal run; wildcard Search colors literal runs of a query the same way.
// The two notions of "literal run" must stay aligned or the tools highlight
// the same construct differently, with no error to flag the drift.
export function analyzeRegexPattern(body) {
  let capturing = false;
  const runs = [];
  let runStart = -1;
  const closeRun = end => { if (runStart !== -1) { runs.push([runStart, end]); runStart = -1; } };
  const n = body.length;
  let i = 0;
  while (i < n) {
    const c = body[i];
    const baseStart = i;
    let baseEnd, isAnchor = false, isLiteral = false;
    if (c === '\\') {
      const next = body[i + 1];
      if (next === 'b' || next === 'B') isAnchor = true;
      else isLiteral = !/[dDwWsS0-9]/.test(next || '');
      baseEnd = Math.min(i + 2, n);
    } else if (c === '[') {
      let j = i + 1;
      if (body[j] === '^') j++;
      if (body[j] === ']') j++;
      while (j < n && body[j] !== ']') j += body[j] === '\\' ? 2 : 1;
      baseEnd = Math.min(j + 1, n);
    } else if (c === '(') {
      capturing = capturing || isCapturingGroup(body, i);
      baseEnd = matchingParen(body, i);
    } else if (c === '^' || c === '$') {
      isAnchor = true;
      baseEnd = i + 1;
    } else if (c === '|') {
      closeRun(i);
      i++;
      continue;
    } else if (c === '.') {
      baseEnd = i + 1;
    } else {
      isLiteral = true;
      baseEnd = i + 1;
    }
    if (isAnchor) { closeRun(i); i = baseEnd; continue; }
    let q = baseEnd, quantified = false;
    if (q < n && (body[q] === '*' || body[q] === '+' || body[q] === '?')) {
      quantified = true;
      q++;
    } else if (q < n && body[q] === '{') {
      const close = body.indexOf('}', q);
      if (close !== -1 && /^\d+(,\d*)?$/.test(body.slice(q + 1, close))) { quantified = true; q = close + 1; }
    }
    if (q < n && body[q] === '?') q++;   // a `?` past a quantifier is the lazy modifier, not a new atom
    if (isLiteral && !quantified) { if (runStart === -1) runStart = baseStart; }
    else closeRun(baseStart);
    i = q;
  }
  closeRun(n);
  return { capturing, runs };
}

export function isCapturingGroup(body, i) {
  if (body[i + 1] !== '?') return true;
  if (body[i + 2] === '<') return body[i + 3] !== '=' && body[i + 3] !== '!';
  return false;
}

export function matchingParen(body, i) {
  const n = body.length;
  let depth = 0, j = i;
  while (j < n) {
    const c = body[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '[') {
      j++;
      if (body[j] === '^') j++;
      if (body[j] === ']') j++;
      while (j < n && body[j] !== ']') j += body[j] === '\\' ? 2 : 1;
      j++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j + 1;
    j++;
  }
  return n;
}

export function wrapRuns(body, runs) {
  let out = '', pos = 0;
  for (const [s, e] of runs) {
    out += body.slice(pos, s) + '(' + body.slice(s, e) + ')';
    pos = e;
  }
  return out + body.slice(pos);
}

// Grawlix tokenizes the replacement and applies it itself rather than calling
// String.replace, because it needs each group's offset in the built output to
// place highlights — String.replace surfaces no such offsets. `$&` is group 0.
export function parseReplacement(str) {
  const tokens = [];
  let lit = '';
  const flush = () => { if (lit) { tokens.push({ lit }); lit = ''; } };
  for (let i = 0; i < str.length; i++) {
    const c = str[i], next = str[i + 1];
    if (c === '$' && next === '$') { lit += '$'; i++; }
    else if (c === '$' && next === '&') { flush(); tokens.push({ group: 0 }); i++; }
    else if (c === '$' && next >= '0' && next <= '9') {
      let digits = next;
      if (str[i + 2] >= '0' && str[i + 2] <= '9') digits += str[i + 2];
      flush();
      tokens.push({ group: parseInt(digits, 10) });
      i += digits.length;
    } else lit += c;
  }
  flush();
  return tokens;
}

// A capture group and its `$N` echoes must resolve to the same color so
// rearranged text visibly moves between the input and output atoms.
export function kindForGroup(g) {
  return 'search:' + (g <= 0 ? 0 : (g - 1) % HL_COLORS);
}

export function regexExecAll(re, text) {
  re.lastIndex = 0;
  const ranges = [];
  let m, hit = false;
  while ((m = re.exec(text)) !== null) {
    hit = true;
    ranges.push(...groupSpansToRanges(m));
    if (m[0].length === 0) re.lastIndex++;   // step past a zero-width match or loop forever
  }
  return { hit, ranges };
}

// The lockstep norm/display builds aren't redundant — collapsing to one is a
// silent regression either way: norm-only loses the synthetic output's
// case/punctuation; display-only misaligns in-list highlights, which must stay
// in norm coords because the executor re-resolves the result onto the real
// entry (whose display differs from ours).
export function runRegexReplace(wlEntry, prepared, wordlist) {
  const { re, hlRe, tokens, allowUnlisted } = prepared;
  const norm = wlEntry.norm, display = displayOf(wlEntry);
  const map = normToDisplayMap(wlEntry);
  const projStart = i => !map ? i : i < map.length ? map[i] : display.length;
  const projEnd = (s, e) => e === s ? projStart(s) : !map ? e : map[e - 1] + 1;
  re.lastIndex = 0;
  let outNorm = '', outDisp = '', inPos = 0, dispPos = 0, m;
  const inputHighlights = [], normHl = [], dispHl = [];
  while ((m = re.exec(norm)) !== null) {
    const mStart = m.index, mEnd = mStart + m[0].length;
    const groups = m.length > 1;
    outNorm += norm.slice(inPos, mStart);
    outDisp += display.slice(dispPos, projStart(mStart));
    if (groups) {
      for (let g = 1; g < m.length; g++) {
        if (m.indices[g]) inputHighlights.push({ start: m.indices[g][0], end: m.indices[g][1], kind: kindForGroup(g) });
      }
    } else if (hlRe) {
      hlRe.lastIndex = mStart;   // lockstep with `re`: same pattern, literal runs wrapped
      inputHighlights.push(...groupSpansToRanges(hlRe.exec(norm)));
    }
    let litIdx = 0;
    for (const tok of tokens) {
      let normVal, dispVal, kind = null;
      if (tok.lit !== undefined) {
        normVal = dispVal = tok.lit;
        if (!groups) kind = `search:${litIdx++ % HL_COLORS}`;
      } else {
        const span = m.indices[tok.group];
        normVal = m[tok.group] || '';
        dispVal = span ? display.slice(projStart(span[0]), projEnd(span[0], span[1])) : '';
        if (normVal && groups) kind = kindForGroup(tok.group);
      }
      if (kind) {
        normHl.push({ start: outNorm.length, end: outNorm.length + normVal.length, kind });
        dispHl.push({ start: outDisp.length, end: outDisp.length + dispVal.length, kind, coord: 'display' });
      }
      outNorm += normVal;
      outDisp += dispVal;
    }
    inPos = mEnd;
    dispPos = projEnd(mStart, mEnd);
    if (m[0].length === 0) re.lastIndex++;   // a zero-width match leaves lastIndex put; step it or loop forever
  }
  outNorm += norm.slice(inPos);
  outDisp += display.slice(dispPos);
  if (outNorm === norm) return [];
  const inList = wordlist.byNorm.has(outNorm);
  if (!inList && !allowUnlisted) return [];
  if (inList) return [{ entry: outNorm, inputHighlights, outputHighlights: normHl }];
  // Array-wrap is load-bearing: it's the executor's synthetic-entry signal, so
  // an off-list result inherits the source score. Unwrap it and scores zero out.
  return [{ entry: [outDisp], inputHighlights, outputHighlights: dispHl }];
}

export function runSearchReplace(entry, prepared, wordlist) {
  const { matcher, replacement, allowUnlisted } = prepared;
  const re = matcher.globalRe;
  re.lastIndex = 0;
  let out = '', inPos = 0, m, colorIdx = 0;
  const inputHighlights = [], outputHighlights = [];
  while ((m = re.exec(entry)) !== null) {
    const mStart = m.index, mEnd = mStart + m[0].length;
    out += entry.slice(inPos, mStart);
    const kind = `search:${colorIdx++ % HL_COLORS}`;
    inputHighlights.push({ start: mStart, end: mEnd, kind, coord: 'display' });
    outputHighlights.push({ start: out.length, end: out.length + replacement.length, kind, coord: 'display' });
    out += replacement;
    inPos = mEnd;
    if (m[0].length === 0) re.lastIndex++;
  }
  out += entry.slice(inPos);
  const outNorm = toNorm(out);
  if (outNorm === toNorm(entry)) return [];
  const inList = wordlist.byNorm.has(outNorm);
  if (!inList && !allowUnlisted) return [];
  return [{ entry: inList ? out : [out], inputHighlights, outputHighlights }];
}
