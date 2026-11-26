'use strict';

import { registerTools, TOOL_CATEGORIES } from '../../src/engine/tools.js';
import storm_surge from './storm-surge.js';

TOOL_CATEGORIES.unshift({ id: 'lab', label: 'Lab' });
registerTools({ storm_surge });
