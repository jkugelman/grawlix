'use strict';

import { makeAffixTool } from './affix.js';

export default makeAffixTool({
  name: 'Head off', icon: '🍈', category: 'side',
  desc: 'Remove letters from the front',
  example: 'swing → wing',
  reverseName: 'Head on', reverseSlug: 'head_on',
  side: 'front',
});
