'use strict';

// ─── Utility ──────────────────────────────────────────────────────────────────

export function nameFromPath(str) {
  return str.split('/').pop().replace(/\.[^.]+$/, '');
}

export function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function pluralize(n, singular, pluralForm = singular + 's') {
  return `${n.toLocaleString()} ${plural(n, singular, pluralForm)}`;
}

// Just the inflected noun, no count — for when the count appears elsewhere in
// the sentence, or not at all. (`pluralize` is the count-prefixed form.)
export function plural(n, singular, pluralForm = singular + 's') {
  return n === 1 ? singular : pluralForm;
}

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const yr = Math.floor(d / 365);
  return `${yr} year${yr === 1 ? '' : 's'} ago`;
}

export function buildHelpHTML(rows, opts = {}) {
  const items = rows.map(([code, desc, rowOpts]) => {
    const token = rowOpts?.ghost
      ? `<i class="help-ghost">${esc(code)}</i>`
      : `<kbd>${esc(code)}</kbd>`;
    return `<span>${token} ${esc(desc)}</span>`;
  }).join('');
  const oneCol = opts.cols === 1 ? ' one-col' : '';
  const footer = opts.link
    ? `<div class="help-link"><a href="${esc(opts.link.url)}" target="_blank" rel="noopener">${esc(opts.link.text)}</a></div>`
    : '';
  return `<div class="help-grid${oneCol}">${items}</div>${footer}`;
}
