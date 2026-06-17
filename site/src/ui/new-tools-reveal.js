'use strict';

// ─── New-tools reveal ─────────────────────────────────────────────────────────

import { lootRowSizes } from '../engine/new-tools.js';
import { buildToolCardHTML } from './tool-stack.js';
import { setToastsSuppressed } from './toasts.js';

const MAX_PER_ROW = 4;

export const NewToolsReveal = (() => {
  let overlay, scene, chest, flash, banner, loot, dismissBtn;
  let dismissable = false;
  let barrelBuilt = false;
  let timers = [];

  // Lock the page without a layout shift: overflow:hidden drops its scrollbar, so
  // pad the freed width back (measured live; 0 with overlay scrollbars). A
  // reserved gutter (scrollbar-gutter) would instead leave a strip the fixed
  // backdrop can't paint over.
  function lockScroll() {
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty('--nt-sbw', sbw + 'px');
    document.documentElement.classList.add('nt-scroll-lock');
  }
  function unlockScroll() {
    document.documentElement.classList.remove('nt-scroll-lock');
  }

  const after = (ms, fn) => timers.push(setTimeout(fn, ms));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mount() {
    overlay = document.createElement('div');
    overlay.id = 'new-tools-reveal';
    overlay.className = 'nt-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'New tools added');
    overlay.inert = true;
    overlay.innerHTML = `
      <div class="nt-backdrop"></div>
      <div class="nt-scroll">
        <div class="nt-banner"></div>
        <div class="nt-scene">
          <div class="nt-rays"></div>
          <div class="nt-aura"></div>
          <div class="nt-flash"></div>
          <div class="nt-chest">
            <div class="nt-chest-3d">
              <div class="nt-cf nt-cf-back"></div>
              <div class="nt-cf nt-cf-bottom"></div>
              <div class="nt-cf nt-cf-left"></div>
              <div class="nt-cf nt-cf-right"></div>
              <div class="nt-glow"></div>
              <div class="nt-cf nt-cf-front">
                <span class="nt-band nt-band-l"></span><span class="nt-band nt-band-r"></span>
                <span class="nt-lock"></span>
              </div>
              <div class="nt-lid"></div>
            </div>
          </div>
        </div>
        <div class="nt-loot"></div>
        <button type="button" class="nt-dismiss">Hell yeah</button>
      </div>`;
    document.body.appendChild(overlay);

    scene     = overlay.querySelector('.nt-scene');
    chest     = overlay.querySelector('.nt-chest');
    flash     = overlay.querySelector('.nt-flash');
    banner    = overlay.querySelector('.nt-banner');
    loot      = overlay.querySelector('.nt-loot');
    dismissBtn = overlay.querySelector('.nt-dismiss');

    dismissBtn.addEventListener('click', dismiss);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') dismiss(); });
  }

  function buildBarrel() {
    const lid = overlay.querySelector('.nt-lid');
    const R = parseFloat(getComputedStyle(overlay.querySelector('.nt-chest-3d')).getPropertyValue('--d')) / 2;
    const K = 16;
    const step = 180 / K;
    const segH = 2 * R * Math.tan((step / 2) * Math.PI / 180) + 1;
    const frag = document.createDocumentFragment();
    for (let k = 0; k < K; k++) {
      const mid = (k + 0.5) * step;
      const rad = mid * Math.PI / 180;
      const seg = document.createElement('div');
      seg.className = 'nt-seg';
      seg.style.height = segH + 'px';
      seg.style.marginTop = (-segH / 2) + 'px';
      seg.style.transform = `translateZ(${R}px) rotateX(${mid}deg) translateZ(${R}px)`;
      const lit = Math.max(0, 0.9 * Math.sin(rad) + 0.43 * Math.cos(rad));
      seg.style.filter = `brightness(${(0.5 + 0.7 * lit).toFixed(3)})`;
      frag.appendChild(seg);
    }
    const under = document.createElement('div');
    under.className = 'nt-lid-under';
    lid.append(frag, under);
    barrelBuilt = true;
  }

  function reset() {
    timers.forEach(clearTimeout);
    timers = [];
    dismissable = false;
    overlay.classList.remove('show', 'dismissing');
    unlockScroll();
    setToastsSuppressed(false);
    overlay.inert = true;
    dismissBtn.classList.remove('show');
    scene.className = 'nt-scene';
    banner.className = 'nt-banner';
    banner.textContent = '';
    loot.innerHTML = '';
  }

  function buildLoot(tools) {
    const CARD_W = window.innerWidth <= 759 ? 160 : 200, GAP = 12;
    const avail = Math.min(window.innerWidth - 40, 980);
    const fit = Math.max(1, Math.min(MAX_PER_ROW, Math.floor((avail + GAP) / (CARD_W + GAP))));
    let idx = 0;
    lootRowSizes(tools.length, fit).forEach(size => {
      const line = document.createElement('div');
      line.className = 'nt-line';
      line.innerHTML = tools.slice(idx, idx + size)
        .map(([key, tool]) => buildToolCardHTML(key, tool, { allButton: false }))
        .join('');
      idx += size;
      loot.appendChild(line);
    });
    loot.querySelectorAll('.tool-card').forEach(c => { c.style.opacity = '0'; });
  }

  function flyLoot() {
    const rect = chest.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height * 0.35;
    const cards = [...loot.querySelectorAll('.tool-card')];
    cards.forEach((card, i) => {
      const r = card.getBoundingClientRect();
      const dx = originX - (r.left + r.width / 2);
      const dy = originY - (r.top + r.height / 2);
      const tilt = (i - (cards.length - 1) / 2) * 7;
      card.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.12) rotate(${tilt}deg)`, opacity: 0 },
        { transform: `translate(${dx * 0.18}px, ${dy * 0.3 - 36}px) scale(1.08) rotate(${tilt / 3}deg)`, opacity: 1, offset: 0.7 },
        { transform: 'translate(0,0) scale(1) rotate(0)', opacity: 1 },
      ], { duration: 720, delay: i * 130, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'both' });
    });
  }

  function burst(count) {
    const colors = ['#ffd96b', '#ffe9a8', '#fff3c4', '#ffffff'];
    for (let i = 0; i < 18 + count * 4; i++) {
      const p = document.createElement('span');
      p.className = 'nt-particle';
      const size = 5 + Math.random() * 9;
      p.style.width = p.style.height = size + 'px';
      p.style.background = colors[i % colors.length];
      p.style.left = `calc(50% - ${size / 2}px)`;
      p.style.top = '40%';
      scene.appendChild(p);
      const ang = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 1.5;
      const dist = 80 + Math.random() * 170;
      p.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) scale(.2)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      after(1300, () => p.remove());
    }
  }

  function enableDismiss() {
    dismissBtn.classList.add('show');
    dismissable = true;
    dismissBtn.focus({ preventScroll: true });
  }

  function dismiss() {
    if (!dismissable) return;
    dismissable = false;
    dismissBtn.classList.remove('show');
    if (reduced()) { reset(); return; }
    overlay.classList.add('dismissing');
    const target = (document.querySelector('.featured-more-tile') || document.getElementById('featured-row'))?.getBoundingClientRect();
    const tx = target ? target.left + target.width / 2 : window.innerWidth / 2;
    const ty = target ? target.top + target.height / 2 : 0;
    const cards = loot.querySelectorAll('.tool-card');
    // Deliberately no opacity here, and the overlay fade is held until the flight
    // ends — re-adding either dissolves the cards mid-trip (the bug this fixes).
    cards.forEach(card => {
      const r = card.getBoundingClientRect();
      card.animate([
        { transform: 'translate(0,0) scale(1)' },
        { transform: `translate(${tx - (r.left + r.width / 2)}px, ${ty - (r.top + r.height / 2)}px) scale(.12)` },
      ], { duration: 520, easing: 'cubic-bezier(.5,0,.7,.2)', fill: 'forwards' });
    });
    overlay.inert = true;
    after(580, () => {
      overlay.classList.remove('show');
      unlockScroll();
      setToastsSuppressed(false);
    });
  }

  function show(tools) {
    if (!tools.length) return;
    reset();
    if (!barrelBuilt) buildBarrel();
    banner.textContent = tools.length === 1 ? '✦ New tool added ✦' : '✦ New tools added ✦';
    buildLoot(tools);
    overlay.classList.add('show');
    lockScroll();
    setToastsSuppressed(true);
    overlay.inert = false;

    if (reduced()) {
      scene.classList.add('open');
      banner.classList.add('in');
      loot.querySelectorAll('.tool-card').forEach(c => { c.style.opacity = '1'; });
      enableDismiss();
      return;
    }

    scene.classList.add('appear');
    after(620, () => scene.classList.remove('appear'));
    after(450, () => scene.classList.add('charging'));
    after(2400, () => { scene.classList.remove('charging'); scene.classList.add('windup'); });
    after(2720, () => {
      scene.classList.remove('windup');
      scene.classList.add('open');
      flash.animate([
        { opacity: 0, transform: 'scale(.4)' },
        { opacity: 1, transform: 'scale(1)', offset: .25 },
        { opacity: 0, transform: 'scale(1.4)' },
      ], { duration: 600, easing: 'ease-out' });
      burst(tools.length);
    });
    after(3050, () => { banner.classList.add('in'); flyLoot(); });
    // After the last card has flown in (fly starts at 3050, staggered 130ms, 720ms each).
    after(3050 + Math.max(0, tools.length - 1) * 130 + 720 + 250, enableDismiss);
  }

  return { mount, show };
})();
