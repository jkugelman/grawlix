'use strict';

import './tools.js';
import { boot } from '../../src/boot.js';
import '../../src/test-api.js';

boot({
  workerURL: new URL('./worker.js', import.meta.url),
  siteRoot: new URL('../../', import.meta.url),
});
