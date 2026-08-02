import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const doc = read('docs', 'components.md');

function section(title) {
  const body = doc.split(/^## /m).find(s => s.startsWith(title));
  assert.ok(body, `docs/components.md has no "## ${title}" section — the guard below parses it, so renaming the heading silently disables the check`);
  return body;
}

function tableNames(body, pattern) {
  const names = new Set();
  for (const line of body.split('\n')) {
    if (!line.startsWith('|')) continue;
    const firstCell = line.split('|')[1] || '';
    for (const m of firstCell.matchAll(pattern)) names.add(m[1]);
  }
  return names;
}

test('docs/components.md lists every export of ui/components.js', () => {
  const src = read('site', 'src', 'ui', 'components.js');
  const exported = new Set(
    [...src.matchAll(/^export\s+(?:function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]),
  );
  assert.ok(exported.size >= 15, `expected to find the components.js surface, parsed ${exported.size} exports`);

  const documented = tableNames(section('`ui/components.js`'), /`([A-Za-z_$][\w$]*)[(`]/g);

  const undocumented = [...exported].filter(n => !documented.has(n)).sort();
  assert.deepEqual(undocumented, [],
    `new export(s) in ui/components.js with no row in docs/components.md — add them so the next person finds them instead of rebuilding them`);

  const stale = [...documented].filter(n => !exported.has(n)).sort();
  assert.deepEqual(stale, [],
    `docs/components.md documents export(s) ui/components.js no longer has — a stale row is worse than no row`);
});

test('every CSS class named in docs/components.md has a rule in app.css', () => {
  const css = read('site', 'css', 'app.css');
  const named = tableNames(section('Shared CSS vocabulary'), /`\.([a-z][a-z0-9-]*)`/g);
  assert.ok(named.size >= 20, `expected to parse the CSS vocabulary table, found ${named.size} classes`);

  const missing = [...named].filter(c => !new RegExp(`\\.${c}(?![\\w-])`).test(css)).sort();
  assert.deepEqual(missing, [],
    `docs/components.md names class(es) that no longer exist in app.css`);
});
