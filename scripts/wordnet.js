// Fetches Open English WordNet 2025 (https://en-word.net/), licensed CC BY 4.0
// (https://creativecommons.org/licenses/by/4.0/), for the generators that derive
// data from it. Attribution rides in each generated file's header and
// THIRD-PARTY-NOTICES.
import { inflateRawSync } from 'node:zlib';

const ZIP = 'https://en-word.net/static/english-wordnet-2025.zip';

// Read named members from a zip via its central directory (EOCD at offset -22
// from EOF holds the entry count and directory offset; each directory record is
// 46 bytes + name/extra/comment and points at a local header).
function unzip(buf, wanted) {
  let p = buf.length - 22;
  while (p >= 0 && buf.readUInt32LE(p) !== 0x06054b50) p--;
  if (p < 0) throw new Error('no end-of-central-directory record');
  let cd = buf.readUInt32LE(p + 16);
  const out = {};
  for (let i = buf.readUInt16LE(p + 10); i > 0; i--) {
    const method = buf.readUInt16LE(cd + 10), compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28), extraLen = buf.readUInt16LE(cd + 30), commLen = buf.readUInt16LE(cd + 32);
    const lho = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);
    if (wanted.some(w => name.endsWith(w))) {
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + compSize);
      out[name.split('/').pop()] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    cd += 46 + nameLen + extraLen + commLen;
  }
  return out;
}

export async function fetchWordNet(members) {
  const res = await fetch(ZIP);
  if (!res.ok) throw new Error(`fetch ${ZIP}: ${res.status}`);
  const files = unzip(Buffer.from(await res.arrayBuffer()), members);
  const missing = members.filter(m => !files[m]);
  if (missing.length) throw new Error(`${missing.join(', ')} not found in archive`);
  return files;
}

export async function fetchWordNetLemmas() {
  const files = await fetchWordNet(['index.noun', 'index.verb', 'index.adj', 'index.adv']);
  const lemmas = new Set();
  for (const text of Object.values(files)) {
    for (const line of text.split('\n')) {
      const lemma = line.slice(0, line.indexOf(' '));
      if (/^[a-z]+$/.test(lemma)) lemmas.add(lemma);
    }
  }
  return lemmas;
}
