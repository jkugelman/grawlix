'use strict';

// ─── Translating words into the sound dialect ────────────────────────────────
// Phone search's lowercase words are shorthand. Each is read through CMU and
// written out as sounds, with the ways a word can be heard spelled as sound sets,
// and the resulting text is what the tool parses and searches. So the panel's
// "Searching for" lines are exactly what runs, and pasting them back gives the
// same results. Entries are read raw, so every fold lives here, widened in both
// directions: a fold that let either side's sound meet the other's becomes a set
// holding both. See docs/phonetics.md § Phone search.

import { parsePhoneQuery } from './phone-dialect.js';
import { itemsOf, widerSplits, soundsOrSpelled } from './phone-reading.js';
import { isVowel, flapsAt, coalescedWithY } from './phonetics.js';

const MAX_READINGS = 16;
const MAX_LINES = 32;

// CMU splits IY from IH, UW from UH and EY from EH before R arbitrarily: HERE IY R
// but NEAR IH R, SHARE EH R but PLOWSHARE EY R.
const BEFORE_R = { IY: 'IH', IH: 'IY', UW: 'UH', UH: 'UW', EY: 'EH', EH: 'EY' };
const WEAK = new Set(['AA', 'AE', 'AH', 'AO', 'EH', 'IH', 'UH']);
// CMU writes ACHOO's first vowel AA2, a full "ah" MASSACHUSETTS (AH0) and STATUE
// (AE1) would otherwise never meet. Only a secondary "ah" or "uh": widen an
// unstressed one and TUBA finds TOO BAD, a secondary I and INSULT finds CONSULT.
const LOOSE_AH = ['AA', 'AE', 'AH', 'AO'];

const printSet = names => (names.length === 1 ? names[0] : `[${names.join(' ')}]`);

// Folds look only inside the word: across a break, THE RACE would lose its IY.
export function wordAtoms(toks) {
  return toks.map((tok, i) => {
    if (!isVowel(tok)) return (tok === 'T' || tok === 'D') && flapsAt(toks, i) ? '[D T]' : tok;
    const bare = tok.slice(0, 2), stress = tok.slice(2);
    const names = new Set([bare]);
    if (toks[i + 1] === 'R') {
      const pair = BEFORE_R[bare];
      // PAYROLL's EY starts a syllable the R opens; it stays apart from EH.
      if (pair && !((bare === 'EY' || bare === 'EH') && isVowel(toks[i + 2] ?? '-'))) names.add(pair);
    } else if (bare === 'AA' || bare === 'AO') {
      names.add('AA').add('AO');
    }
    const loose = stress === '2' && ['AA', 'AE', 'AH'].includes(bare);
    if (loose) LOOSE_AH.forEach(n => names.add(n));
    const sorted = [...names].sort();
    if (loose || (stress === '0' && WEAK.has(bare))) sorted.push('AX');
    return printSet(sorted);
  });
}

// CMU writes the R after AY and AW as its own syllable or not on a whim: TIRE AY
// ER, SPIRE AY R, WIRE both.
function pronVariants(toks) {
  const out = [toks];
  const i = toks.findIndex((t, k) => /^A[YW]\d$/.test(t) && (toks[k + 1] === 'ER0' || toks[k + 1] === 'R'));
  if (i >= 0) out.push([...toks.slice(0, i + 1), toks[i + 1] === 'R' ? 'ER0' : 'R', ...toks.slice(i + 2)]);
  return out;
}

function runReadings(items) {
  let combos = [[]];
  for (const item of items) {
    const next = [];
    for (const words of combos) {
      for (const sound of item.sounds) {
        for (const toks of pronVariants(sound.toks)) {
          if (next.length < MAX_READINGS) next.push([...words, toks]);
          const prev = words.at(-1);
          const merged = prev && toks[0] === 'Y' && toks.length > 1 && coalescedWithY(prev.at(-1), item.letters);
          if (merged && next.length < MAX_READINGS) next.push([...words.slice(0, -1), [...prev.slice(0, -1), merged], toks.slice(1)]);
        }
      }
    }
    combos = next;
  }
  return combos.map(words => ({ atoms: words.flatMap(wordAtoms), tail: words.at(-1) ?? null }));
}

const typed = (text, el) => (el.type === 'star' ? '*' : text.slice(el.s, el.e).replace(/\s+/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']'));

export function translatePhoneQuery(text, readWords, { replacement = false } = {}) {
  const parsed = parsePhoneQuery(text, { replacement });
  if (parsed.error) return { text: null, lines: [], error: parsed.error };
  const lines = [];
  for (const alt of parsed.alts) {
    const context = (els, not) => (els.length ? `(${not ? '^ ' : ''}${els.map(el => typed(text, el)).join(' ')})` : null);
    const before = context(alt.before, alt.beforeNot), after = context(alt.after, alt.afterNot);
    let readings = [{ atoms: [], tail: null }];
    for (const [k, el] of alt.body.entries()) {
      let pieces;
      if (el.type === 'word') {
        const { items } = readWords(el.text);
        if (!items.length || items.includes(null)) {
          return { text: null, lines: [], error: { s: el.s, e: el.e, msg: `There's no pronunciation for <code>${el.text.replace(/[&<>]/g, '')}</code>.`, final: true } };
        }
        pieces = runReadings(items);
      } else {
        pieces = [{ atoms: [typed(text, el)], tail: null }];
      }
      const next = [];
      for (const r of readings) for (const p of pieces) if (next.length < MAX_READINGS) next.push({ atoms: [...r.atoms, ...p.atoms], tail: p.tail });
      readings = next;
    }
    const seqs = [];
    for (const r of readings) {
      const ends = r.tail && !after ? endings(r.atoms, r.tail) : [r.atoms];
      for (const atoms of ends) seqs.push([before, ...atoms, after].filter(Boolean));
    }
    for (const seq of mergedOneApart(seqs)) lines.push(seq.join(' '));
  }
  const unique = withoutCovered([...new Set(lines)]).slice(0, MAX_LINES);
  return { text: unique.join(', '), lines: unique, error: null };
}

// A word ending the query can't see what follows it in the entry, so a fold an R
// there would have stopped is split off and fenced with a "not followed by".
function endings(atoms, tail) {
  const last = tail.at(-1), head = n => atoms.slice(0, atoms.length - n);
  const out = [];
  // MA isn't MORE: the cot–caught merger stops before R.
  if (/^A[AO]\d$/.test(last)) {
    out.push([...head(1), printSet(namesOf(atoms.at(-1)).filter(n => n !== 'AO'))], [...head(1), 'AO', '(^ R)']);
  } else if (last === 'R' && /^EH\d$/.test(tail.at(-2) ?? '')) {
    // PAIR isn't PAYROLL: EY meets EH only where the R closes the syllable.
    out.push([...head(2), printSet(namesOf(atoms.at(-2)).filter(n => n !== 'EY')), 'R'], [...head(2), 'EY', 'R', '(^ @)']);
  } else {
    out.push(atoms);
  }
  // CMU ends TABBY on IY but has STABBING's vowel as IH, which many speakers say
  // as IY before NG; only there, or MONEY would find FEMINIST.
  if (last === 'IY0') out.push([...head(1), 'IH', '(NG)']);
  return out;
}

const namesOf = atom => (atom.startsWith('[') ? atom.slice(1, -1).split(' ') : [atom]);
const bySet = (a, b) => (a === 'AX') - (b === 'AX') || (a < b ? -1 : a > b ? 1 : 0);

// Only readings one sound apart merge: sets at two places would also match the
// crossings, which neither reading says.
function mergedOneApart(seqs) {
  const out = seqs.map(seq => [...seq]);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i], b = out[j];
        if (a.length !== b.length) continue;
        const diff = a.flatMap((atom, k) => (atom === b[k] ? [] : [k]));
        if (diff.length !== 1 || /^[(*]/.test(a[diff[0]]) || /^[(*]/.test(b[diff[0]])) continue;
        const k = diff[0];
        const names = [...new Set([...namesOf(a[k]), ...namesOf(b[k])])].sort(bySet);
        a[k] = names.length === 1 ? names[0] : `[${names.join(' ')}]`;
        out.splice(j, 1);
        merged = true;
      }
    }
  }
  return out;
}

function withoutCovered(lines) {
  const alts = lines.map(line => parsePhoneQuery(line).alts[0]);
  const covers = (big, small) => {
    const same = (x, y) => x.length === y.length && x.every((el, i) => el.type === y[i].type && [...(el.codes ?? [])].every(c => y[i].codes?.has(c)));
    return big.body.length === small.body.length && big.beforeNot === small.beforeNot && big.afterNot === small.afterNot
      && same(small.before, big.before) && same(big.before, small.before)
      && same(small.after, big.after) && same(big.after, small.after)
      && same(small.body, big.body);
  };
  return lines.filter((line, i) => !alts.some((big, j) => j !== i && covers(big, alts[i]) && (!covers(alts[i], big) || j < i)));
}

export const queryWordReader = spacing => wordsText => itemsOf(wordsText, widerSplits(spacing), soundsOrSpelled);
