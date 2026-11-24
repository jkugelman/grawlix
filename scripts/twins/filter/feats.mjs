const code = (s, i) => s.charCodeAt(i) * 128 + s.charCodeAt(i + 1);

export function letterSig(e) {
  const c = e.c, bg = new Map();
  for (let i = 0; i + 1 < c.length; i++) { const k = code(c, i); bg.set(k, (bg.get(k) ?? 0) + 1); }
  return { n: e.norm.length, m: c.length, hist: e.hist, bg, nbg: Math.max(0, c.length - 1) };
}

export function phoneSigs(e) {
  if (!e.sound) return null;
  return e.sound.vs.map(({ p }) => {
    const hist = new Map(), bg = new Map();
    for (let i = 0; i < p.length; i++) {
      hist.set(p[i], (hist.get(p[i]) ?? 0) + 1);
      if (i + 1 < p.length) { const k = p[i] * 256 + p[i + 1]; bg.set(k, (bg.get(k) ?? 0) + 1); }
    }
    return { n: p.length, hist, bg, nbg: Math.max(0, p.length - 1) };
  });
}

const common = (a, b) => { let c = 0; for (const [k, v] of a) { const w = b.get(k); if (w) c += Math.min(v, w); } return c; };

export function letterPair(A, B) {
  let hd = 0;
  for (let k = 0; k < 36; k++) hd += Math.abs(A.hist[k] - B.hist[k]);
  const cm = common(A.bg, B.bg);
  const L = Math.min(A.n, B.n);
  return { L, hd, dl: Math.abs(A.m - B.m), miss: Math.max(A.nbg - cm, B.nbg - cm), cm };
}

// Each measure takes its best reading pair on its own, so a filter on
// either never rejects a pair that some reading pair would pass.
export function phonePair(As, Bs) {
  if (!As || !Bs) return null;
  let hd = Infinity, miss = Infinity;
  for (const A of As) for (const B of Bs) {
    const L = Math.min(A.n, B.n);
    let h = 0;
    for (const [k, v] of A.hist) h += Math.abs(v - (B.hist.get(k) ?? 0));
    for (const [k, v] of B.hist) if (!A.hist.has(k)) h += v;
    const cm = common(A.bg, B.bg);
    hd = Math.min(hd, h / L);
    miss = Math.min(miss, Math.max(A.nbg - cm, B.nbg - cm) / L);
  }
  return { hd, miss };
}
