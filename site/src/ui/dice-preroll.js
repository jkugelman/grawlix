'use strict';

// ─── Dice pre-roll ── see docs/design.md § Twins ──────────────────────────────

import { sendPreroll, stopPreroll, onPrerollState, prerollContextFor, runInFlight } from './pipeline-worker.js';

const QUIET_MS = 1500;
let quietMs = QUIET_MS;
let getStack = () => [];
let timer = null;
let asked = false;
let shown = null;
// Taken on a click before the worker hears of it: a state already in flight
// would otherwise offer the same entry again.
const taken = new Set();

export function mountDicePreroll(stackGetter) {
  getStack = stackGetter;
  onPrerollState(data => {
    shown = data;
    for (const d of taken) if (d !== data.probing && !data.queue.some(r => r.display === d)) taken.delete(d);
  });
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, onActivity, true);
  armDicePreroll();
}

function target() {
  const stack = getStack();
  const row = stack.findIndex(r => r.def.dice && !r.grouped);
  return row < 0 ? null : { stack, row };
}

export function armDicePreroll() {
  clearTimeout(timer);
  timer = null;
  if (target()) timer = setTimeout(fire, quietMs);
}

function fire() {
  timer = null;
  if (runInFlight()) return;   // the run's settle re-arms
  const t = target();
  if (!t) return;
  sendPreroll(t.stack, t.row);
  asked = true;
}

// A press on the die is the click that takes over the roll in flight; stopping
// on it would abort that roll and the click would quietly start from scratch.
function onActivity(e) {
  if (e.target.closest?.('.tool-row-dice')) return;
  if (asked) { stopPreroll(); asked = false; }
  armDicePreroll();
}

function viewFor(t) {
  if (!shown || shown.context !== prerollContextFor(t.stack, t.row)) return { queue: [], probing: null };
  const queue = shown.queue.filter(r => !taken.has(r.display));
  const probing = shown.probing && !taken.has(shown.probing) ? shown.probing : null;
  return { queue, head: queue[0]?.display ?? null, strong: !!queue[0]?.strong, probing,
    tried: shown.tried, gaveUp: shown.gaveUp, adoptions: shown.adoptions };
}

export function takePrerolled(row) {
  const t = target();
  if (!t || t.row !== row) return null;
  const v = viewFor(t);
  const pick = v.head ?? v.probing;
  if (pick) taken.add(pick);
  return pick;
}

export function setDiceQuietMsForTest(ms) {
  quietMs = ms ?? QUIET_MS;
  armDicePreroll();
}

export function dicePrerollViewForTest() {
  const t = target();
  return t ? viewFor(t) : null;
}
