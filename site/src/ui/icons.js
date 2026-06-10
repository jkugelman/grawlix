'use strict';

// ─── Wordlist icons ───────────────────────────────────────────────────────────

import { esc } from '../core/util.js';
import { INITIALS_PALETTE } from '../core/constants.js';

function nameToInitials(name) {
  const words = name.trim().split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function hashStringMod(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

function nameColorIndex(name) { return hashStringMod(name, INITIALS_PALETTE.length); }

export function buildInitialsIconHTML(name, colorSeed = name) {
  const initials = esc(nameToInitials(name));
  const ci = nameColorIndex(colorSeed);
  return `<svg class="wordlist-icon wordlist-icon-initials ic-${ci}" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3"/><text x="8" y="8" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="700" font-size="8" letter-spacing="-0.02em">${initials}</text></svg>`;
}

export function buildEmojiIconHTML(emoji) {
  return `<svg class="wordlist-icon wordlist-icon-emoji" viewBox="0 0 16 16" aria-hidden="true"><text x="8" y="8" text-anchor="middle" dominant-baseline="central" font-size="13">${esc(emoji)}</text></svg>`;
}

export function buildImgIconHTML(url) {
  return `<img src="${esc(url)}" class="wordlist-icon wordlist-icon-img" onerror="this.style.display='none'" alt="">`;
}

// descriptor: null | { type: 'emoji', value } | { type: 'img', url }
export function buildIconHTML(descriptor, name, seed) {
  if (descriptor?.type === 'emoji') return buildEmojiIconHTML(descriptor.value);
  if (descriptor?.type === 'img')   return buildImgIconHTML(descriptor.url);
  return buildInitialsIconHTML(name, seed);
}

export function colorSeed(obj) {
  return obj.url || obj.name;
}

export function getWordlistIcon(wordlist) {
  return buildIconHTML(wordlist.icon, wordlist.name, colorSeed(wordlist));
}

let _mergedIcon = null;
export function getMergedIcon() { return _mergedIcon ??= buildEmojiIconHTML('⭐'); }
