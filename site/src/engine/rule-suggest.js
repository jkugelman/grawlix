'use strict';

// ─── Rule query suggestions ───────────────────────────────────────────────────
// What the rule editor offers at the caret: fields, then values, then a joining
// operator. Pure: the editor fills in match counts from the worker by asking for
// each suggestion's `probe` query. See docs/wordlists.md § Rescore rules.

import { analyzeQuery, compileQuery, quoteValue, QUERY_FIELDS } from './rule-query.js';

// ─── Catalog ──────────────────────────────────────────────────────────────────

const WORD_CATEGORY_DESC = {
  proper: 'A name: Obama, iPhone, McDonald',
  initialism: 'NASA, MRIs, U.S.',
  abbreviation: 'Ends in a period: Mt., hrs.',
  'roman numeral': 'XVIII, Pius VII',
};
const CHAR_CATEGORY_DESC = {
  digits: '0 through 9: 10pm, 2nd',
  punctuation: 'Hyphens, apostrophes, periods and the like',
  symbols: '$, %, + and the like',
};
const IS_VALUES = [
  ['plain', 'No capitals, not counting I: chafe at, bagel'],
  ...Object.entries(WORD_CATEGORY_DESC),
  ...Object.keys(CHAR_CATEGORY_DESC).map(k => [k, `Nothing but ${k}`]),
];

const INFO = {
  score: {
    short: 'Score in this wordlist',
    desc: 'The score this wordlist gives the entry.',
  },
  length: {
    short: 'Number of letters',
    desc: 'How many letters, not counting spaces or punctuation.',
    examples: [['3', '3 letters'], ['4-5', '4 or 5 letters'], ['10+', '10 or more'], ['15', 'Spans a 15×15 grid'], ['16+', 'Too long for a 15×15']],
  },
  words: {
    short: 'Number of words',
    desc: 'How many words, split at spaces, dashes and slashes.',
    examples: [['1', 'A single word'], ['2', 'Two words'], ['3+', 'Three or more']],
  },
  is: {
    short: 'Proper, initialism, plain…',
    desc: 'What the whole entry is.',
  },
  'is not': {
    short: 'None of these categories',
    desc: 'The whole entry is none of these.',
  },
  contains: {
    short: 'Text or a category anywhere',
    desc: 'Has a word of this category, a character of this kind, or this text anywhere.',
  },
  'starts with': {
    short: 'Begins with text or a category',
    desc: 'The first word is of this category, the first character is of this kind, or the entry begins with this text.',
  },
  'ends with': {
    short: 'Finishes with text or a category',
    desc: 'The last word is of this category, the last character is of this kind, or the entry ends with this text.',
  },
  pattern: {
    short: 'Search pattern, like *ing',
    desc: 'The whole entry matches a pattern like the ones the search box takes.',
    examples: [['*ing', 'Ends in ING'], ['re*', 'Starts with RE'], ['*[xz]*', 'Has an X or a Z'], ['?@?@?', 'Five letters, vowels 2nd and 4th']],
    hint: '<code>?</code> any letter · <code>*</code> any letters · <code>@</code> vowel · <code>#</code> consonant · <code>[abc]</code> one of these',
  },
  regex: {
    short: 'Regular expression, like ing$',
    desc: 'A regular expression, tested against the entry. Letter case is ignored.',
    examples: [['ing$', 'Ends in ING'], ['^(re|un)', 'Starts with RE or UN'], ['(.)\\1\\1', 'A letter three times in a row'], ["'s$", "Ends in 's"]],
  },
};
const POSITION_HINT = 'Quote text with spaces: <code>" up"</code>.';
const POSITION_TEXT = { any: 'zz', start: 're', end: 'ing' };

export const OP_DESC = {
  and: 'Both sides must match',
  or: 'Either side can match',
  not: 'The next condition must not match',
  '(': 'Start a group',
  ')': 'Close the group',
};

export const QUERY_REFERENCE = {
  fields: QUERY_FIELDS.map(f => ({
    name: f.name,
    desc: INFO[f.name].desc,
    examples: f.type === 'is' ? IS_VALUES.map(([v]) => v)
      : f.type === 'position' ? ['proper', 'roman numeral', 'digits', quoteValue(POSITION_TEXT[f.where])]
      : f.name === 'score' ? ['50', '50+', '30-49']
      : f.type === 'range' ? INFO[f.name].examples.slice(0, 3).map(([v]) => v)
      : INFO[f.name].examples.slice(0, 3).map(([v]) => quoteValue(v)),
  })),
  operators: [
    ['and', OP_DESC.and, 'is: proper and words: 1'],
    ['or', OP_DESC.or, 'length: 3 or length: 15'],
    ['not', OP_DESC.not, 'not ends with: " up"'],
    ['( )', 'Group conditions', '(words: 1 or length: 3-4) and score: 50'],
  ],
};

const isList = f => f && (f.type === 'is' || f.type === 'position');
const isWs = ch => ch === ' ' || ch === '\t' || ch === '\n' || ch === ' ';

// ─── Errors and descriptions ──────────────────────────────────────────────────

// An error at the caret is usually a clause still being typed (`score:` before
// its value), so it stays hidden until the caret moves past it.
export function visibleErrors(s, caret = -1) {
  const { errors } = analyzeQuery(s);
  if (caret < 0) return errors;
  return errors.filter(e => !(caret >= e.start && s.slice(e.end, caret).trim() === ''));
}

export function describeAt(s, c) {
  for (const t of analyzeQuery(s).tokens) {
    if (c < t.start || c > t.end) continue;
    if (t.kind === 'clause' && t.field) return { field: t.field.name, desc: INFO[t.field.name].desc };
    if (t.kind === 'op') return { op: t.op, desc: OP_DESC[t.op] + '.' };
  }
  return null;
}

// The fields and categories a bare list (no display) can't answer: it has no
// capitals, spaces or punctuation, so they match nothing or everything there.
const DISPLAY_CATEGORIES = new Set(['proper', 'initialism', 'abbreviation', 'roman numeral', 'punctuation', 'spaces']);
export function readsDisplay(query) {
  return analyzeQuery(query).tokens.some(t => t.kind === 'clause' && t.field
    && (t.field.type === 'is' || t.field.name === 'words'
      || (t.field.type === 'position' && t.items.some(it => !it.quoted && DISPLAY_CATEGORIES.has(it.text.toLowerCase().replace(/\s+/g, ' '))))));
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

function fuzzy(name, q) {
  q = q.toLowerCase().trim();
  if (!q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(' ').some(w => w.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  let k = 0;
  for (const ch of name) if (ch === q[k]) k++;
  return k === q.length ? 4 : -1;
}

function mk(s, kind, label, desc, rs, re, body, opts = {}) {
  const lead = opts.lead && rs > 0 && !isWs(s[rs - 1]) && s[rs - 1] !== '(' ? ' ' : '';
  const follow = s[re];
  const followOk = follow !== undefined && (isWs(follow) || follow === ')' || follow === ',');
  const trail = opts.noTrail || followOk ? '' : ' ';
  const insert = lead + body + trail;
  let caret = rs + insert.length;
  if (!opts.noTrail && follow !== undefined && isWs(follow)) caret += 1;
  return { kind, label, desc, rs, re, insert, caret, probe: opts.probe ?? null, match: opts.match ?? '' };
}

const validValue = (f, v) => !compileQuery(`${f.name}: ${v}`).errors.length;

// An unclosed quote still counts, or typing `"ab` would offer nothing.
function typedText(f, p) {
  const t = analyzeQuery(`${f.name}: ${p}`).tokens[0];
  if (t?.kind !== 'clause' || t.items.length !== 1 || (t.error && !t.error.incomplete)) return null;
  return t.items[0].text || null;
}

function valueChoices(f, prefix, chosen, ctx) {
  const p = prefix.trim();
  const lower = p.toLowerCase();
  const out = [];
  const add = (v, d) => { if (!out.some(o => o.v === v)) out.push({ v, d }); };
  if (f.type === 'range') {
    if (p && validValue(f, p)) add(p, 'Use this value');
    if (/^\d+$/.test(p)) add(p + '+', `${p} or more`);
    const examples = f.name === 'score'
      ? [...(ctx.tiers ?? []).map(t => [String(t.score), t.note || '']), ['50+', '50 or higher'], ['30-49', '30 through 49']]
      : INFO[f.name].examples;
    for (const [v, d] of examples) if (v.startsWith(lower)) add(v, d);
  } else if (f.type === 'is') {
    for (const [v, d] of IS_VALUES) if (!chosen.includes(v) && v.includes(lower)) add(v, d);
  } else if (f.type === 'position') {
    const text = typedText(f, p)?.toLowerCase() ?? '';
    const quoted = /^["“]/.test(p);
    const cats = [...Object.entries(WORD_CATEGORY_DESC), ...Object.entries(CHAR_CATEGORY_DESC)];
    if (f.where === 'any') cats.push(['spaces', 'More than one word']);
    if (!quoted) for (const [v, d] of cats) if (!chosen.includes(v) && v.includes(text)) add(v, d);
    if (text && (quoted || !cats.some(([v]) => v === text))) {
      const here = f.where === 'any' ? 'This text anywhere' : f.where === 'start' ? 'Begins with this text' : 'Ends with this text';
      add(quoteValue(text), here);
      // Only the ends can name a whole word: `contains: " x "` would miss a first or last word.
      if (f.where !== 'any' && !/\s/.test(text)) add(quoteValue(f.where === 'start' ? `${text} ` : ` ${text}`), `The word “${text}”`);
    }
  } else {
    const text = typedText(f, p);
    if (text && validValue(f, quoteValue(text))) add(quoteValue(text), f.type === 'pattern' ? 'Use this pattern' : 'Use this expression');
    for (const [v, d] of INFO[f.name].examples) if (!text || v.includes(text)) add(quoteValue(v), d);
  }
  return out;
}

function fieldItems(s, rs, re, prefix, lead) {
  return QUERY_FIELDS
    .map(f => ({ f, r: fuzzy(f.name, prefix) }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map(({ f }) => mk(s, 'field', f.name, INFO[f.name].short, rs, re, f.name + ':', { lead, match: prefix }));
}

function opItems(s, ops, rs, re, prefix = '') {
  return ops.filter(op => op.startsWith(prefix.toLowerCase()))
    .map(op => mk(s, 'op', op, OP_DESC[op], rs, re, op, { lead: true, noTrail: op === '(', match: prefix }));
}

function valueSpan(s, t) {
  let vStart = t.colon + 1;
  while (vStart < t.end && isWs(s[vStart])) vStart++;
  const value = s.slice(vStart, t.end).trimEnd();
  return { vStart, vEnd: vStart + value.length, value };
}

function inValue(s, t, c) {
  const { vEnd, value } = valueSpan(s, t);
  if (c <= vEnd) return true;
  if (s.slice(vEnd, c).trim() !== '') return false;
  return !value || value.endsWith(',') || !!t.error;
}

// The item under the caret, or the one a run of spaces leads into, is edited
// whole: filtering on only the part before the caret would let Tab cut off the
// rest (30 with the caret after the 3 became 3).
function itemAt(s, t, c) {
  return t.items.find(it => c >= it.start && c <= it.end)
    ?? t.items.find(it => it.start > c && s.slice(c, it.start).trim() === '');
}

function valueMode(s, t, a, b, ctx) {
  const f = t.field;
  if (!f) return { groups: [], hint: 'Fix the field name first.' };
  const c = a;
  const { vStart, vEnd, value } = valueSpan(s, t);
  let item;
  if (!value) item = { start: Math.min(c, vStart), end: Math.max(c, vStart) };
  else if (c > vEnd) item = value.endsWith(',') ? { start: c, end: c } : { ...t.items[t.items.length - 1], end: c };
  else item = itemAt(s, t, c) ?? { start: c, end: c };
  const prefix = b > a ? '' : s.slice(item.start, item.end);
  const chosen = isList(f) ? t.items.filter(it => it.start !== item.start).map(it => it.text.toLowerCase()) : [];
  const rs = item.start, re = Math.max(item.end, b);
  const items = valueChoices(f, prefix, chosen, ctx)
    .map(o => mk(s, 'value', o.v, o.d, rs, re, o.v, { lead: true, probe: `${f.name}: ${o.v}`, match: prefix.trim() }));
  return {
    groups: [{ label: `Values for ${f.name}`, items, counts: true }],
    hint: INFO[f.name].hint ?? (f.type === 'position' ? POSITION_HINT : null),
    active: items.length ? 0 : -1,
  };
}

export function suggest(s, a, b = a, ctx = {}) {
  const { tokens: toks } = analyzeQuery(s);
  const c = a;
  const depthBefore = toks.filter(t => t.end <= c).reduce((d, t) => d + (t.kind === 'lparen') - (t.kind === 'rparen'), 0);

  for (const t of toks) {
    if (t.kind === 'clause') {
      if (c >= t.start && c <= t.colon) {
        const prefix = s.slice(t.start, t.nameEnd).replace(/\s+/g, ' ');
        return { groups: [{ label: 'Fields', items: fieldItems(s, t.start, t.colon + 1, prefix, false) }], active: 0 };
      }
      if (c > t.colon && inValue(s, t, c)) return valueMode(s, t, a, b, ctx);
    } else if ((t.kind === 'word' || t.kind === 'op') && c >= t.start && c <= t.end) {
      const prefix = s.slice(t.start, t.end);
      const prev = toks[toks.indexOf(t) - 1];
      const after = prev && (prev.kind === 'clause' || prev.kind === 'rparen');
      if (t.kind === 'op') {
        const ops = after ? ['and', 'or'] : ['not'];
        const items = opItems(s, ops, t.start, t.end);
        return { groups: [{ label: 'Operators', items }], active: Math.max(0, items.findIndex(x => x.label === t.op)) };
      }
      const ops = opItems(s, after ? ['and', 'or'] : ['not'], t.start, t.end, prefix);
      const fields = fieldItems(s, t.start, t.end, prefix, false);
      const groups = [{ label: 'Fields', items: fields }, { label: 'Operators', items: ops }];
      return { groups: after ? groups.reverse() : groups, active: 0 };
    }
  }

  const prev = toks.filter(t => t.end <= c).pop();
  if (!prev || prev.kind === 'op' || prev.kind === 'lparen') {
    return {
      groups: [
        { label: 'Fields', items: fieldItems(s, c, b, '', true) },
        { label: 'Operators', items: opItems(s, ['not', '('], c, b) },
      ],
      active: 0,
    };
  }
  const groups = [{ label: 'Join with', items: opItems(s, depthBefore > 0 ? ['and', 'or', ')'] : ['and', 'or'], c, b) }];
  if (prev.kind === 'clause' && isList(prev.field) && !prev.error) {
    const chosen = prev.items.map(it => it.text.toLowerCase());
    const { vEnd } = valueSpan(s, prev);
    const more = valueChoices(prev.field, '', chosen, ctx).slice(0, 8)
      .map(o => mk(s, 'value', o.v, o.d, vEnd, b, ', ' + o.v, { probe: `${prev.field.name}: ${o.v}` }));
    if (more.length) groups.push({ label: `Add to ${prev.field.name}`, items: more, counts: true });
  }
  groups.push({ label: 'Or add another condition', items: fieldItems(s, c, b, '', true) });
  return { groups, active: -1 };
}
