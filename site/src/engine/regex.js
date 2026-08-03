'use strict';

import { toNorm, displayOf, normToDisplayMap } from './norm.js';
import { HL_COLORS, SEARCH_KINDS, groupSpansToRanges, matchModeOk } from './search.js';

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
  return SEARCH_KINDS[g <= 0 ? 0 : (g - 1) % HL_COLORS];
}

export function regexExecAll(re, text, matchOk = null) {
  re.lastIndex = 0;
  const ranges = [];
  let m, hit = false;
  while ((m = re.exec(text)) !== null) {
    if (matchOk && !matchOk(m)) {
      re.lastIndex = m.index + 1;   // an accepted match may overlap the rejected one — see searchRangesFor
      continue;
    }
    hit = true;
    ranges.push(...groupSpansToRanges(m));
    if (m[0].length === 0) re.lastIndex++;   // step past a zero-width match or loop forever
  }
  return { hit, ranges };
}

export function execMatches(re, text, matchOk = null) {
  re.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (matchOk && !matchOk(m)) {
      re.lastIndex = m.index + 1;   // an accepted match may overlap the rejected one — see searchRangesFor
      continue;
    }
    matches.push(m);
    if (m[0].length === 0) re.lastIndex++;   // a zero-width match leaves lastIndex put; step it or loop forever
  }
  return matches;
}

// Norm-first matching with a display fallback mirrors filter mode's
// either-arm match: drop the fallback and a pattern that filters via its
// display arm (`\s`, `-`, an accent) silently drops rows in replace mode.
// The lockstep norm/display output builds aren't redundant — norm-only
// silently loses a synthetic output's case/punctuation; display-only
// misaligns in-list highlights, which must stay in norm coords because the
// executor re-resolves the result onto the real entry.
export function runReplace(wlEntry, prepared, wordlist) {
  const { re, hlRe, tokens, allowUnlisted, matchMode } = prepared;
  const norm = wlEntry.norm, display = displayOf(wlEntry);
  if (matchMode === 'span' && wlEntry.display == null) return [];
  let armNorm = true, matches = execMatches(re, norm, matchModeOk(matchMode, wlEntry, 'norm'));
  if (!matches.length && wlEntry.display != null) {
    armNorm = false;
    matches = execMatches(re, display, matchModeOk(matchMode, wlEntry, 'display'));
  }
  if (!matches.length) return [];
  const src = armNorm ? norm : display;
  const map = armNorm ? normToDisplayMap(wlEntry) : null;
  const dStart = i => !map ? i : i < map.length ? map[i] : display.length;
  const dEnd = (s, e) => e === s ? dStart(s) : !map ? e : map[e - 1] + 1;
  const tag = r => armNorm ? r : { ...r, coord: 'display' };
  let outNorm = '', outDisp = '', inPos = 0, dispPos = 0;
  const inputHighlights = [], normHl = [], dispHl = [];
  for (const m of matches) {
    const mStart = m.index, mEnd = mStart + m[0].length;
    const groups = m.length > 1;
    const gapD = display.slice(dispPos, dStart(mStart));
    outNorm += armNorm ? norm.slice(inPos, mStart) : toNorm(gapD);
    outDisp += gapD;
    if (groups) {
      for (let g = 1; g < m.length; g++) {
        if (m.indices[g]) inputHighlights.push(tag({ start: m.indices[g][0], end: m.indices[g][1], kind: kindForGroup(g) }));
      }
    } else if (hlRe) {
      hlRe.lastIndex = mStart;   // lockstep with `re`: same pattern, literal runs wrapped
      inputHighlights.push(...groupSpansToRanges(hlRe.exec(src)).map(tag));
    }
    let litIdx = 0;
    for (const tok of tokens) {
      let normVal, dispVal, kind = null;
      if (tok.lit !== undefined) {
        normVal = toNorm(tok.lit);
        dispVal = tok.lit;
        if (!groups) kind = SEARCH_KINDS[litIdx++ % HL_COLORS];
      } else {
        if (armNorm) {
          const span = m.indices[tok.group];
          normVal = m[tok.group] || '';
          dispVal = span ? display.slice(dStart(span[0]), dEnd(span[0], span[1])) : '';
        } else {
          dispVal = m[tok.group] || '';
          normVal = toNorm(dispVal);
        }
        if (dispVal && groups) kind = kindForGroup(tok.group);
      }
      if (kind) {
        normHl.push({ start: outNorm.length, end: outNorm.length + normVal.length, kind });
        dispHl.push({ start: outDisp.length, end: outDisp.length + dispVal.length, kind, coord: 'display' });
      }
      outNorm += normVal;
      outDisp += dispVal;
    }
    inPos = mEnd;
    dispPos = dEnd(mStart, mEnd);
  }
  const tailD = display.slice(dispPos);
  outNorm += armNorm ? norm.slice(inPos) : toNorm(tailD);
  outDisp += tailD;
  // A norm-preserving rewrite (`\s` → `-`) never resolves in-list — the lookup
  // would just re-emit the input row; only the coined display form means anything.
  const inList = outNorm !== norm && wordlist.norms.has(outNorm);
  if (inList) return [{ entry: outNorm, inputHighlights, outputHighlights: normHl }];
  if (!allowUnlisted || (outNorm === norm && outDisp === display)) return [];
  // Array-wrap is load-bearing: it's the executor's synthetic-entry signal, so
  // an off-list result inherits the source score. Unwrap it and scores zero out.
  return [{ entry: [outDisp], inputHighlights, outputHighlights: dispHl }];
}
