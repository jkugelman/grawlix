'use strict';

import { boot } from './boot.js';
// Last: the test surface imports from every layer, so it must load after all of
// them are initialized. Its only side effect is assigning window.__grawlixTest /
// window._db; it is otherwise inert and adds nothing to the production path.
import './test-api.js';

// main.js lands at src/main.js in both dev and the bundle, so these resolve the
// same in both.
boot({
  workerURL: new URL('./engine/worker.js', import.meta.url),
  siteRoot: new URL('../', import.meta.url),
});
