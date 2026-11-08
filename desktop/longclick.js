"use strict";
/* Sideshow long-click summon — press and hold one mouse button to
   summon/hide the panel. The user picks the button (left or right)
   and the hold length (recorded by performing the hold). Uses
   uiohook-napi for a global mouse hook (works while the panel is
   hidden and in other apps). A normal click (quick press-and-release)
   never fires it, and a drag (movement) never fires it.
   NOTE: a long RIGHT click also opens the system's context menu —
   the hook only observes, it cannot suppress it. The panel still
   summons on top. Long LEFT click has no such conflict.
   If the native module cannot load, long-click is unavailable. */

let uIOhook = null;
let available = false;
try {
  const mod = require("uiohook-napi");
  uIOhook = mod.uIOhook;
  available = true;
} catch (e) {
  available = false;
}

/* uiohook mouse buttons: 1 = left, 2 = right, 3 = middle. */
const BUTTONS = { left: 1, right: 2 };
const BUTTON_NAMES = { 1: "left", 2: "right" };
const MIN_HOLD_MS = 500; /* shorter than this is a normal click */
const MAX_MOVE_PX = 15; /* a drag is not a hold */
const RECORD_TIMEOUT_MS = 10000;

let hookStarted = false;
let detector = null;
let config = null; /* { button: 1|2, ms: number } */
let onSummon = null;
let paused = false;
let mode = "idle"; // idle | listening | recording
let recordResolve = null;
let recordTimer = null;
/* Recording state. */
let recDownAt = 0;
let recDownPos = null;
let recDownButton = 0;
let recMaxMove = 0;

function startHook() {
  if (!available || hookStarted) return available;
  try {
    uIOhook.start();
    hookStarted = true;
    return true;
  } catch (e) {
    available = false;
    return false;
  }
}

function stopHook() {
  if (!available || !hookStarted) return;
  try { uIOhook.stop(); } catch (e) { /* already stopped */ }
  hookStarted = false;
}

/* Pure long-click state machine. Testable without the native hook:
   feed it {button, x, y} events. */
function createDetector(cfg, onSummonFn) {
  let downAt = 0;
  let downPos = null;
  let downButton = 0;
  let maxMove = 0;
  return {
    mousedown(e) {
      if (!cfg || e.button !== cfg.button) return;
      downAt = Date.now();
      downPos = { x: e.x, y: e.y };
      downButton = e.button;
      maxMove = 0;
    },
    mousemove(e) {
      if (downPos) {
        maxMove = Math.max(maxMove, Math.hypot(e.x - downPos.x, e.y - downPos.y));
      }
    },
    mouseup(e) {
      if (!downPos || e.button !== downButton) return;
      const dur = Date.now() - downAt;
      const held = dur >= cfg.ms * 0.9 && maxMove < MAX_MOVE_PX;
      downAt = 0;
      downPos = null;
      maxMove = 0;
      if (held) onSummonFn();
    },
    reset() { downAt = 0; downPos = null; maxMove = 0; },
  };
}

function describe(cfg) {
  if (!cfg) return "None";
  const name = BUTTON_NAMES[cfg.button] || "left";
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  return label + " " + (cfg.ms / 1000).toFixed(1) + "s";
}

function finishRecord(cfg, error) {
  if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
  const resolve = recordResolve;
  recordResolve = null;
  mode = onSummon ? "listening" : "idle";
  recDownAt = 0;
  recDownPos = null;
  recMaxMove = 0;
  if (resolve) resolve({ config: cfg || null, error: error || null });
}

function recordEvent(type, e) {
  if (mode !== "recording") return;
  if (type === "mousedown") {
    recDownAt = Date.now();
    recDownPos = { x: e.x, y: e.y };
    recDownButton = e.button;
    recMaxMove = 0;
  } else if (type === "mousemove" || type === "mousedragged") {
    if (recDownPos) {
      recMaxMove = Math.max(recMaxMove, Math.hypot(e.x - recDownPos.x, e.y - recDownPos.y));
    }
  } else if (type === "mouseup") {
    if (!recDownPos || e.button !== recDownButton) return;
    const dur = Date.now() - recDownAt;
    const button = recDownButton;
    recDownAt = 0;
    recDownPos = null;
    if (button !== 1 && button !== 2) {
      finishRecord(null, "Use the left or right button.");
      return;
    }
    if (dur < MIN_HOLD_MS || recMaxMove >= MAX_MOVE_PX) {
      finishRecord(null, "Hold longer — press and hold the button.");
      return;
    }
    finishRecord({ button, ms: Math.round(dur / 100) * 100 }, null);
  }
}

function ensureListener() {
  if (!available) return false;
  if (!startHook()) return false;
  if (!uIOhook._sideshowLcBound) {
    uIOhook.on("mousedown", (e) => {
      if (paused) return;
      if (mode === "recording") recordEvent("mousedown", e);
      else if (mode === "listening" && detector) detector.mousedown(e);
    });
    uIOhook.on("mouseup", (e) => {
      if (paused) return;
      if (mode === "recording") recordEvent("mouseup", e);
      else if (mode === "listening" && detector) detector.mouseup(e);
    });
    uIOhook.on("mousemove", (e) => {
      if (paused) return;
      if (mode === "recording") recordEvent("mousemove", e);
      else if (mode === "listening" && detector) detector.mousemove(e);
    });
    uIOhook.on("mousedragged", (e) => {
      if (paused) return;
      if (mode === "recording") recordEvent("mousedragged", e);
      else if (mode === "listening" && detector) detector.mousemove(e);
    });
    uIOhook._sideshowLcBound = true;
  }
  return true;
}

module.exports = {
  available,
  BUTTONS,
  BUTTON_NAMES,
  MIN_HOLD_MS,
  createDetector,
  describe,
  getConfig: () => config,
  /* Set the long-click config and the summon callback. Pass null for
     the config to turn long-click off. */
  setConfig(cfg, summon) {
    config = (cfg && (cfg.button === 1 || cfg.button === 2) && cfg.ms >= MIN_HOLD_MS)
      ? { button: cfg.button, ms: cfg.ms } : null;
    onSummon = summon || null;
    detector = (config && onSummon) ? createDetector(config, onSummon) : null;
    if (detector && ensureListener()) mode = "listening";
    else mode = "idle";
  },
  setPaused(p) { paused = !!p; },
  /* Record one long press. Resolves { config, error }. The button
     held and the hold length become the summon. */
  record() {
    return new Promise((resolve) => {
      if (!available || !ensureListener()) {
        resolve({ config: null, error: "Long-click unavailable on this system." });
        return;
      }
      mode = "recording";
      recordResolve = resolve;
      recordTimer = setTimeout(() => {
        finishRecord(null, "No hold detected — try again.");
      }, RECORD_TIMEOUT_MS);
    });
  },
  stop() {
    mode = "idle";
    stopHook();
  },
};
