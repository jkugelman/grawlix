'use strict';

export default {
  name: 'Supervocalics', icon: '🌈', category: 'letters',
  desc: 'Each of A E I O U exactly once',
  example: 'air quote · euphoria',
  params: [
    { key: 'y', type: 'checkbox', label: 'And Y',
      title: 'Also require exactly one Y' },
  ],
  kind: 'filter', input: 'plain', output: 'plain',
  run(entry, params) {
    let a = 0, e = 0, i = 0, o = 0, u = 0, y = 0;
    for (const ch of entry) {
      if (ch === 'a') a++;
      else if (ch === 'e') e++;
      else if (ch === 'i') i++;
      else if (ch === 'o') o++;
      else if (ch === 'u') u++;
      else if (ch === 'y') y++;
    }
    return a === 1 && e === 1 && i === 1 && o === 1 && u === 1 && (!params.y || y === 1);
  },
};
