'use strict';

export function wordSplits(display) {
  const stripped = display.split(/[ ]+/).filter(Boolean);
  const splits = [stripped];
  if (stripped.some(w => w.includes('-'))) {
    splits.push(stripped.flatMap(w => w.split(/-+/).filter(Boolean)));
  }
  return splits;
}

export default {
  name: 'Initialisms', icon: '🔠', category: 'phrase',
  desc: 'Starting letters spell a word',
  example: 'hot → Helen of Troy',
  params: [{ placeholder: 'word' }],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  matchOn: 'display',
  isInert: params => !((params && params['word'] || '').trim()),
  prepare(params) { return (params['word'] || '').trim().toLowerCase(); },
  run(displayText, target, wordlist) {
    if (!target) return true;
    for (const split of wordSplits(displayText)) {
      if (split.length !== target.length) continue;
      let ok = true;
      for (let i = 0; i < split.length; i++) {
        if (split[i][0].toLowerCase() !== target[i]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  },
  group: {
    key: displayText => {
      const words = displayText.split(/[ ]+/).filter(Boolean);
      if (words.length < 2) return null;
      let initialism = '';
      for (const w of words) initialism += w[0].toLowerCase();
      return initialism;
    },
    anchor: (key, wordlist) => wordlist.byNorm.get(key) || null,
    anchorLabel: 'Initialism',
  },
};
