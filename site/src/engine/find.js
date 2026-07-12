import { projectRangesToDisplay } from './norm.js';
import { buildSearchPattern } from './search.js';

export const FIND_MATCH_CAP = 999;   // bounded so the worker never ships O(results) data (worker-protocol.md)

// Advancing by the needle length (non-overlapping) matches the browser's find;
// advancing by 1 would silently diverge into overlapping hits. Offsets index
// `text` directly as display-coordinate ranges, which holds only because
// toLowerCase is length-preserving for the ASCII entries in play.
export function* findOccurrences(text, needleLower) {
  if (!text || !needleLower) return;
  const hay = text.toLowerCase();
  const len = needleLower.length;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needleLower, from);
    if (at === -1) return;
    yield { start: at, end: at + len };
    from = at + len;
  }
}

export const buildFindMatcher = query => buildSearchPattern(query ?? '', /* wholeWord */ false, /* literal */ true);

export function* findEntryOccurrences(matcher, wlEntry) {
  if (!matcher.test(wlEntry)) return;
  // Norm-arm spans arrive in norm coordinates; project or they highlight the wrong chars.
  for (const r of projectRangesToDisplay(matcher.searchRanges(wlEntry), wlEntry)) {
    yield { start: r.start, end: r.end };
  }
}
