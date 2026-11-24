//   node ratepage.mjs batch.json --batch 5 --out index.html [--lede "…"]
// batch.json: [{ n, a, b, pre }] — pre: true sets the pair aside as
// Claude-marked junk, shown collapsed for overriding.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const items = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const batch = opt('--batch', '?');
const rate = items.filter((x) => !x.pre), pre = items.filter((x) => x.pre);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const style = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ratepage.css'), 'utf8');
const li = (x) => `<li class="item" id="i${x.n}" data-n="${x.n}"${x.pre ? ' data-pre="junk"' : ''}><div class="pair"><span class="num">${x.n}</span><span class="a">${esc(x.a)}</span><span class="sep">/</span><span class="b">${esc(x.b)}</span></div><div class="btns" role="group" aria-label="Rate pair ${x.n}"><button type="button" data-v="good">Good</button><button type="button" data-v="ok">OK</button><button type="button" data-v="junk">Junk</button></div><button type="button" class="note-btn" aria-expanded="false">Add note</button><textarea class="note" id="note${x.n}" rows="2" aria-label="Note on pair ${x.n}" placeholder="Why?" hidden></textarea></li>`;
const lede = opt('--lede', `${rate.length} pairs from the scorer's results, in random order.`)
  + ' Tap Good, OK or Junk on any you have an opinion about, and Add note to say why. Then Copy ratings and paste into chat. Skip whatever you like.';
const pairs = Object.fromEntries(items.map((x) => [x.n, `${x.a} / ${x.b}`]));

const html = `<title>Twins Rating Batch ${esc(batch)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap">
${style}
<div class="wrap">
  <h1>Rate these twins</h1>
  <p class="lede">${esc(lede)}</p>
  <ol id="list">
${rate.map(li).join('\n')}
  </ol>
${pre.length ? `  <details class="pre"><summary>${pre.length} pairs I marked junk (tap to override)</summary>
  <p class="lede">Spelling variants, inflections and word-family relatives. Tap a different rating to override; untouched ones stay junk.</p>
  <ol id="prelist">
${pre.map(li).join('\n')}
  </ol></details>` : ''}
</div>
<div class="bar"><div class="bar-in"><div class="tally" id="tally">0 rated</div><button type="button" id="copy">Copy ratings</button></div>
<textarea id="out" rows="3" readonly hidden aria-label="Ratings text"></textarea></div>
<script>
const KEY = 'twins-batch${esc(batch)}', NKEY = KEY + '-notes', PAIRS = ${JSON.stringify(pairs)};
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
const r = load(KEY), notes = load(NKEY);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(r)); localStorage.setItem(NKEY, JSON.stringify(notes)); } catch {} };
const pre = new Set([...document.querySelectorAll('.item[data-pre]')].map(li => li.dataset.n));
const value = n => r[n] ?? (pre.has(n) ? 'junk' : undefined);
function paint() {
  document.querySelectorAll('.item').forEach(li => {
    const n = li.dataset.n, v = value(n), ta = li.querySelector('.note'), nb = li.querySelector('.note-btn');
    li.querySelectorAll('.btns button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    if (notes[n] && ta.value !== notes[n]) ta.value = notes[n];
    nb.classList.toggle('has', !!notes[n]);
    nb.textContent = ta.hidden ? (notes[n] ? 'Edit note' : 'Add note') : 'Hide note';
  });
  const c = {good: 0, ok: 0, junk: 0};
  Object.entries(r).forEach(([n, v]) => { if (!pre.has(n)) c[v]++; });
  const over = Object.keys(r).filter(n => pre.has(n) && r[n] !== 'junk').length;
  const nn = Object.values(notes).filter(Boolean).length;
  document.getElementById('tally').textContent = \`\${c.good + c.ok + c.junk} rated · \${c.good} good · \${c.ok} ok · \${c.junk} junk\` + (over ? \` · \${over} overrides\` : '') + (nn ? \` · \${nn} notes\` : '');
}
const text = () => {
  const head = ['good','ok','junk'].map(v => {
    const ns = Object.keys(r).filter(n => r[n] === v && !(pre.has(n) && v === 'junk')).map(Number).sort((a, b) => a - b);
    return ns.length ? \`\${v}: \${ns.join(', ')}\` : '';
  }).filter(Boolean).join('; ');
  const ns = Object.keys(notes).filter(n => notes[n] && notes[n].trim()).map(Number).sort((a, b) => a - b);
  const body = ns.map(n => \`\${n} (\${PAIRS[n]}, \${value(String(n)) ?? 'unrated'}): \${notes[n].trim()}\`).join('\\n');
  return \`Batch ${esc(batch)} \${head}\` + (body ? '\\nNotes:\\n' + body : '');
};
document.querySelectorAll('ol').forEach(ol => {
  ol.addEventListener('click', e => {
    const nb = e.target.closest('.note-btn');
    if (nb) {
      const ta = nb.parentElement.querySelector('.note');
      ta.hidden = !ta.hidden; nb.setAttribute('aria-expanded', String(!ta.hidden));
      if (!ta.hidden) ta.focus();
      paint(); return;
    }
    const b = e.target.closest('.btns button'); if (!b) return;
    const n = b.closest('.item').dataset.n;
    if (value(n) === b.dataset.v) delete r[n]; else r[n] = b.dataset.v;
    save(); paint();
  });
  ol.addEventListener('input', e => {
    const ta = e.target.closest('.note'); if (!ta) return;
    const n = ta.closest('.item').dataset.n;
    if (ta.value.trim()) notes[n] = ta.value; else delete notes[n];
    save(); paint();
  });
});
document.getElementById('copy').addEventListener('click', e => {
  const t = text(), out = document.getElementById('out');
  out.value = t;
  if (!navigator.clipboard) { out.hidden = false; out.select(); return; }
  navigator.clipboard.writeText(t).then(() => { e.target.textContent = 'Copied'; setTimeout(() => e.target.textContent = 'Copy ratings', 1500); })
    .catch(() => { out.hidden = false; out.select(); });
});
document.querySelectorAll('.note').forEach(ta => { if (notes[ta.closest('.item').dataset.n]) ta.hidden = false; });
paint();
</script>
`;
fs.writeFileSync(opt('--out', 'index.html'), html);
console.log(`${rate.length} to rate, ${pre.length} set aside`);
