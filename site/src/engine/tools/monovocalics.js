'use strict';

export default {
  name: 'Monovocalics', icon: '👩‍🎤', category: 'letters',
  desc: 'Only one distinct vowel',
  example: 'TOOCOOLFORSCHOOL',
  params: [],
  kind: 'filter', inputHighlights: false, outputHighlights: false,
  run(entry) {
    let vowel = '';
    let prevWasLetter = false;
    for (const ch of entry) {
      if (ch < 'a' || ch > 'z') { prevWasLetter = false; continue; }
      let v = '';
      if (ch === 'a' || ch === 'e' || ch === 'i' || ch === 'o' || ch === 'u') v = ch;
      else if (ch === 'y' && prevWasLetter) v = 'y';
      if (v) {
        if (!vowel) vowel = v;
        else if (v !== vowel) return false;
      }
      prevWasLetter = true;
    }
    return !!vowel;
  },
};
