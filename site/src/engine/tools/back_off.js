'use strict';

import { makeAffixTool } from './affix.js';

export default makeAffixTool({
  name: 'Back off', icon: '🍑', category: 'side',
  desc: 'Remove letters from the back',
  example: 'party → part',
  reverseName: 'Back on', reverseSlug: 'back_on',
  side: 'back',
});
