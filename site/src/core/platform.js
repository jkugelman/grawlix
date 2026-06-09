'use strict';

// ─── Platform ───────────────────────────────────────────────────────────────

let _browser = null;
export function getBrowser() {
  if (_browser) return _browser;
  const ua = navigator.userAgent;
  const brands = navigator.userAgentData?.brands?.map(b => b.brand).join(' ') || '';
  if (/Firefox\//.test(ua))                                return _browser = { id: 'firefox', icon: 'icon-browser-firefox', name: 'Firefox' };
  if (/Edg\//.test(ua))                                    return _browser = { id: 'edge',    icon: 'icon-browser-edge',    name: 'Edge' };
  if (/Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua))   return _browser = { id: 'safari',  icon: 'icon-browser-safari',  name: 'Safari' };
  const fork = /\b(Brave|OPR|Vivaldi)\b/.test(ua) || /\b(Brave|Opera|Vivaldi|Arc)\b/.test(brands);
  if (!fork && /Chrome\//.test(ua) && (!brands || /Google Chrome/.test(brands)))
    return _browser = { id: 'chrome', icon: 'icon-browser-chrome', name: 'Chrome' };
  return _browser = { id: 'other', icon: 'icon-globe', name: 'your browser' };
}

export const isMobile = () =>
  navigator.userAgentData?.mobile
  ?? !window.matchMedia('(any-pointer: fine) and (any-hover: hover)').matches;

let _hoverCapable = null;
export function hoverCapable() { return _hoverCapable ??= window.matchMedia('(hover: hover)'); }
