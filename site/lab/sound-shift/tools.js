'use strict';

import { registerTools, TOOL_CATEGORIES } from '../../src/engine/tools.js';
import sound_shift from './sound-shift.js';

TOOL_CATEGORIES.unshift({ id: 'lab', label: 'Lab' });
registerTools({ sound_shift });
