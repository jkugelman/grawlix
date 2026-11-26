'use strict';

// A lab page is served from /lab/<name>/, so a page-relative URL resolves
// against the wrong directory there; resolve against the site root.
let root = null;

export function configureSite(opts) { root = opts.root; }

export function siteURL(path) { return new URL(path, root).href; }
