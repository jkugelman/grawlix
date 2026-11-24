// Shared runs for Twins: a single word whose opening or closing letters,
// an unlikely sequence, recur across a word break in a phrase
// (PSILOCYBIN / PS I LOVE YOU, ATMOSPHERE / AT MOST).

const PREFIXES = new Set('in un re de dis mis non pre sub over under anti co ex en em im ir il'.split(' '));
export const RUN_MIN = 5;

// ─── Letter model ────────────────────────────────────

// Norms are padded at the start, or a common opening (UN-, INTER-) scores as
// rare as the same letters mid-word.
export function letterModel(norms) {
  const counts = letterCounts();
  for (const n of norms) counts.add(n);
  return counts.model();
}

export function letterCounts() {
  const tri = new Map(), bi = new Map();
  const add = (n) => {
    const w = '^^' + n;
    for (let i = 2; i < w.length; i++) {
      const k = w.slice(i - 2, i);
      bi.set(k, (bi.get(k) ?? 0) + 1);
      tri.set(k + w[i], (tri.get(k + w[i]) ?? 0) + 1);
    }
  };
  const model = () => (run, atStart) => {
    const w = (atStart ? '^^' : '') + run;
    let b = 0;
    for (let i = 2; i < w.length; i++) {
      const k = w.slice(i - 2, i);
      b -= Math.log2(((tri.get(k + w[i]) ?? 0) + 1) / ((bi.get(k) ?? 0) + 37));
    }
    return b / (w.length - 2);
  };
  return { add, model };
}

// ─── Matching ────────────────────────────────────────

function written(display, normOf) {
  const words = display.split(/[\s\-\/&]+/).map(normOf).filter(Boolean);
  const breaks = new Set();
  let n = 0;
  for (const w of words) { if (n) breaks.add(n); n += w.length; }
  return { t: words.join(''), breaks, words };
}

// The phrase's piece inside the run must not be a word or prefix: without
// that check compounds (EGGNOG / EGG NOODLE, BRICKLAYERS / THICK LAYERS)
// outnumber the finds more than twenty to one.
export function sharedRun(q, e, { normOf, isWord, wordOf }) {
  const a = written(q.display, normOf), b = written(e.display, normOf);
  const shorter = Math.min(a.t.length, b.t.length);
  for (const atStart of [true, false]) {
    let L = 0;
    while (L < shorter && (atStart ? a.t[L] === b.t[L] : a.t[a.t.length - 1 - L] === b.t[b.t.length - 1 - L])) L++;
    if (L < RUN_MIN || L < 0.4 * shorter || L === shorter) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (y.words.length > 1 || !wordOf(y === a ? q : e) || L < 0.4 * y.t.length) continue;
      const from = atStart ? 0 : x.t.length - L, to = from + L;
      const inner = [...x.breaks].filter((k) => k > from && k < to);
      if (!inner.some((k) => k - from >= 2 && to - k >= 2)) continue;
      const piece = atStart ? x.t.slice(0, Math.min(...inner)) : x.t.slice(Math.max(...inner), to);
      if ((piece.length >= 3 && isWord(piece)) || PREFIXES.has(piece) || glued(y.t, x.words, atStart)) continue;
      return { run: x.t.slice(from, to), atStart, cover: L / shorter };
    }
  }
  return null;
}

// John rated these junk: the single word is just the phrase's words run
// together (BYWAYS / BY WAY OF EXAMPLE, OOMPAHS / OOM-PAH-PAH BANDS).
function glued(word, words, atStart) {
  const ws = atStart ? words : [...words].reverse();
  let s = '';
  for (const w of ws.slice(0, -1)) {
    s = atStart ? s + w : w + s;
    if (s.length > word.length || !(atStart ? word.startsWith(s) : word.endsWith(s))) break;
    const rest = atStart ? word.slice(s.length) : word.slice(0, word.length - s.length);
    if (ws.indexOf(w) > 0 && INFLECTIONS.has(rest)) return true;
  }
  return false;
}
const INFLECTIONS = new Set(['', 's', 'es', 'ed', 'd', 'ing', 'er', 'ers']);

export const mayShareRun = (qNorm, norm) => norm.length >= RUN_MIN && qNorm.length >= RUN_MIN
  && (norm.startsWith(qNorm.slice(0, RUN_MIN)) || norm.endsWith(qNorm.slice(-RUN_MIN)));
