"use strict";
/* Sideshow gesture summon — global mouse gestures via uiohook-napi.
   Electron has no global mouse hook, so a native module is required.
   If the module cannot load, gestures are unavailable and the hotkey
   is the only summon. Supported gestures (all recorded by performing
   them once):
     - clicks: N rapid clicks (N >= 3) on one button within 600 ms.
     - hold: press and hold one button for a recorded duration (>= 800 ms).
     - drag: press a button and move in one cardinal direction (>= 60 px).
   Minimums keep accidental triggers low (a double-click or a short
   press is too common to use as a summon). */

let uIOhook = null;
let available = false;
try {
  const mod = require("uiohook-napi");
  uIOhook = mod.uIOhook;
  available = true;
} catch (e) {
  available = false;
}

const CLICK_WINDOW_MS = 600;
const MIN_CLICKS = 3;
const MIN_HOLD_MS = 800;
const MIN_DRAG_PX = 60;
const RECORD_TIMEOUT_MS = 6000;
const CLICK_SETTLE_MS = 700;

let onSummon = null;
let activeGesture = null;
let hookStarted = false;
let mode = "idle"; // idle | listening | recording

// Per-interaction tracking.
let downAt = 0;
let downPos = null;
let downButton = 0;
let path = [];
let maxMove = 0;
let clickTimes = [];
let clickButton = 0;
let recordResolve = null;
let recordTimer = null;
let recordQuietTimer = null;

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function dominantDirection(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < MIN_DRAG_PX) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function describe(g) {
  if (!g) return "None";
  if (g.type === "clicks") return g.count + " clicks";
  if (g.type === "hold") return "Hold " + (g.ms / 1000).toFixed(1) + "s";
  if (g.type === "drag") return "Drag " + g.direction;
  return "None";
}

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

function resetInteraction() {
  downAt = 0;
  downPos = null;
  downButton = 0;
  path = [];
  maxMove = 0;
}

function pruneClicks(now) {
  clickTimes = clickTimes.filter((t) => now - t <= CLICK_WINDOW_MS);
}

/* ---------- detection (listening for the recorded gesture) ---------- */

function matchGesture(type, e) {
  if (!activeGesture || !onSummon) return;
  const now = Date.now();
  if (type === "mousedown") {
    if (activeGesture.type === "clicks" && e.button === activeGesture.button) {
      pruneClicks(now);
      clickTimes.push(now);
      if (clickTimes.length >= activeGesture.count) {
        clickTimes = [];
        onSummon();
      }
    }
    downAt = now;
    downPos = { x: e.x, y: e.y };
    downButton = e.button;
    path = [{ x: e.x, y: e.y }];
    maxMove = 0;
  } else if (type === "mousemove" || type === "mousedragged") {
    if (downPos) {
      path.push({ x: e.x, y: e.y });
      maxMove = Math.max(maxMove, dist(downPos, { x: e.x, y: e.y }));
    }
  } else if (type === "mouseup") {
    if (!downPos) return;
    const dur = now - downAt;
    const end = { x: e.x, y: e.y };
    if (activeGesture.type === "hold" && e.button === activeGesture.button) {
      if (dur >= activeGesture.ms * 0.9 && maxMove < 15) onSummon();
    } else if (activeGesture.type === "drag" && e.button === activeGesture.button) {
      const dir = dominantDirection(downPos, end);
      if (dir === activeGesture.direction && maxMove >= activeGesture.distance * 0.8) onSummon();
    }
    resetInteraction();
  }
}

/* ---------- recording ---------- */

function finishRecord(gesture, error) {
  if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
  if (recordQuietTimer) { clearTimeout(recordQuietTimer); recordQuietTimer = null; }
  const resolve = recordResolve;
  recordResolve = null;
  mode = "idle";
  resetInteraction();
  clickTimes = [];
  if (resolve) resolve({ gesture: gesture || null, error: error || null });
}

function recordEvent(type, e) {
  if (mode !== "recording") return;
  const now = Date.now();
  if (type === "mousedown") {
    pruneClicks(now);
    clickTimes.push(now);
    clickButton = e.button;
    downAt = now;
    downPos = { x: e.x, y: e.y };
    downButton = e.button;
    path = [{ x: e.x, y: e.y }];
    maxMove = 0;
    if (recordQuietTimer) { clearTimeout(recordQuietTimer); recordQuietTimer = null; }
  } else if (type === "mousemove" || type === "mousedragged") {
    if (downPos) {
      path.push({ x: e.x, y: e.y });
      maxMove = Math.max(maxMove, dist(downPos, { x: e.x, y: e.y }));
    }
  } else if (type === "mouseup") {
    if (!downPos) return;
    const dur = now - downAt;
    const end = { x: e.x, y: e.y };
    if (maxMove >= MIN_DRAG_PX) {
      const dir = dominantDirection(downPos, end);
      if (dir) {
        finishRecord({ type: "drag", button: downButton, direction: dir, distance: Math.round(maxMove) });
        return;
      }
    }
    if (dur >= MIN_HOLD_MS && maxMove < 15) {
      finishRecord({ type: "hold", button: downButton, ms: Math.round(dur / 100) * 100 });
      return;
    }
    // Otherwise wait briefly to see if more clicks follow.
    resetInteraction();
    if (recordQuietTimer) clearTimeout(recordQuietTimer);
    recordQuietTimer = setTimeout(() => {
      // Count the burst ending at the last click (not "now" — by settle
      // time the clicks are all older than the window).
      const last = clickTimes.length ? clickTimes[clickTimes.length - 1] : 0;
      const burst = clickTimes.filter((t) => last - t <= CLICK_WINDOW_MS).length;
      if (burst >= MIN_CLICKS) {
        finishRecord({ type: "clicks", button: clickButton, count: burst });
      } else {
        finishRecord(null, "Too short — try a longer hold, more clicks, or a drag.");
      }
    }, CLICK_SETTLE_MS);
  }
}

/* uiohook-napi reports e.type as a number, so the event name is passed
   in explicitly instead of read from the event. A held-button move
   arrives as "mousedragged", not "mousemove". */
function onMouseEvent(type, e) {
  if (mode === "recording") recordEvent(type, e);
  else if (mode === "listening") matchGesture(type, e);
}

function ensureListener() {
  if (!available) return false;
  if (!startHook()) return false;
  if (!uIOhook._sideshowBound) {
    uIOhook.on("mousedown", (e) => onMouseEvent("mousedown", e));
    uIOhook.on("mouseup", (e) => onMouseEvent("mouseup", e));
    uIOhook.on("mousemove", (e) => onMouseEvent("mousemove", e));
    uIOhook.on("mousedragged", (e) => onMouseEvent("mousedragged", e));
    uIOhook._sideshowBound = true;
  }
  return true;
}

module.exports = {
  available,
  describe,
  getGesture: () => activeGesture,
  setGesture(gesture, summon) {
    activeGesture = gesture || null;
    onSummon = summon || null;
    if (!activeGesture) {
      mode = "idle";
      return;
    }
    if (ensureListener()) mode = "listening";
  },
  startListening() {
    if (activeGesture && ensureListener()) mode = "listening";
  },
  stop() {
    mode = "idle";
    stopHook();
  },
  /* Record one gesture. Resolves { gesture, error }. */
  record() {
    return new Promise((resolve) => {
      if (!available || !ensureListener()) {
        resolve({ gesture: null, error: "Gesture unavailable on this system." });
        return;
      }
      mode = "recording";
      resetInteraction();
      clickTimes = [];
      recordResolve = resolve;
      recordTimer = setTimeout(() => {
        finishRecord(null, "No gesture detected — try again.");
      }, RECORD_TIMEOUT_MS);
    });
  },
};
