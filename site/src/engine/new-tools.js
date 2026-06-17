'use strict';

export function lootRowSizes(count, fit) {
  if (count <= 0) return [];
  const rows = Math.ceil(count / fit);
  const base = Math.floor(count / rows);
  const extra = count % rows;
  return Array.from({ length: rows }, (_, r) => base + (r < extra ? 1 : 0));
}

export function unseenToolSlugs(allSlugs, seenSlugs) {
  const seen = new Set(seenSlugs);
  return allSlugs.filter(slug => !seen.has(slug));
}
