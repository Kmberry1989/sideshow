"use strict";
/* Sideshow double-tap summon — a lone modifier key tapped twice
   quickly summons/hides the panel. Uses uiohook-napi for a global
   keyboard hook (works while the panel is hidden and in other apps).
   Only fires when the key is tapped alone: no other key pressed in
   between, no other modifier held, not part of a combination. A held
   key never repeats (uiohook reports one keydown per physical press).
   If the native module cannot load, double-tap is unavailable and
   the hotkey + tray double-click are the summon. */

let uIOhook = null;
let available = false;
try {
  const mod = require("uiohook-napi");
  uIOhook = mod.uIOhook;
  available = true;
} catch (e) {
  available = false;
}

const DOUBLE_TAP_WINDOW_MS = 400;
/* Logical key → uiohook keycodes (left + right). Either side counts
   as the same key. */
const KEY_CODES = {
  Shift: [42, 54],
  Control: [29, 3613],
  Alt: [56, 3640],
  Meta: [3675, 3676],
};
const DOUBLE_TAP_KEYS = ["Shift", "Control", "Alt", "Meta"];
const CAPTURE_TIMEOUT_MS = 10000;

let hookStarted = false;
let detector = null;
let targetName = "Shift";
let onSummon = null;
let paused = false;
let mode = "idle"; // idle | listening | capturing
let captureResolve = null;
let captureTimer = null;

function keyNameForCode(code) {
  for (const name of DOUBLE_TAP_KEYS) {
    if (KEY_CODES[name].indexOf(code) >= 0) return name;
  }
  return null;
}

/* Modifier flags other than the target key itself. A tap counts only
   when no other modifier is held (it is not part of a combination). */
function otherModifierHeld(e, name) {
  if (name !== "Shift" && e.shiftKey) return true;
  if (name !== "Control" && e.ctrlKey) return true;
  if (name !== "Alt" && e.altKey) return true;
  if (name !== "Meta" && e.metaKey) return true;
  return false;
}

/* Pure double-tap state machine. Testable without the native hook:
   feed it {keycode, ctrlKey, altKey, shiftKey, metaKey} events. */
function createDetector(name, onDoubleTap, windowMs) {
  const win = windowMs || DOUBLE_TAP_WINDOW_MS;
  let lastTapAt = 0;
  let keyDown = false;
  return {
    keydown(e) {
      const hit = keyNameForCode(e.keycode);
      if (!hit || hit !== name) { lastTapAt = 0; return; } // another key breaks the sequence
      if (keyDown) return; // already held; no auto-repeat, but guard anyway
      if (otherModifierHeld(e, name)) { lastTapAt = 0; return; } // part of a combination
      const now = Date.now();
      keyDown = true;
      if (lastTapAt && now - lastTapAt <= win) {
        lastTapAt = 0;
        onDoubleTap();
      } else {
        lastTapAt = now;
      }
    },
    keyup(e) {
      if (keyNameForCode(e.keycode) === name) keyDown = false;
    },
    reset() { lastTapAt = 0; keyDown = false; },
  };
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

function finishCapture(keyName, error) {
  if (captureTimer) { clearTimeout(captureTimer); captureTimer = null; }
  const resolve = captureResolve;
  captureResolve = null;
  mode = onSummon ? "listening" : "idle";
  if (resolve) resolve({ key: keyName || null, error: error || null });
}

function captureKeydown(e) {
  const name = keyNameForCode(e.keycode);
  if (!name) {
    finishCapture(null, "Press Shift, Control, Alt, or Command — not that key.");
    return;
  }
  finishCapture(name, null);
}

function ensureListener() {
  if (!available) return false;
  if (!startHook()) return false;
  if (!uIOhook._sideshowDblBound) {
    uIOhook.on("keydown", (e) => {
      if (paused) return;
      if (mode === "capturing") captureKeydown(e);
      else if (mode === "listening" && detector) detector.keydown(e);
    });
    uIOhook.on("keyup", (e) => {
      if (paused) return;
      if (mode === "listening" && detector) detector.keyup(e);
    });
    uIOhook._sideshowDblBound = true;
  }
  return true;
}

module.exports = {
  available,
  DOUBLE_TAP_KEYS,
  DOUBLE_TAP_WINDOW_MS,
  keyNameForCode,
  createDetector,
  getKey: () => targetName,
  /* Set the double-tap key and the summon callback. Pass null for the
     key to turn double-tap off (the hotkey still works). */
  setKey(name, summon) {
    targetName = DOUBLE_TAP_KEYS.indexOf(name) >= 0 ? name : "Shift";
    onSummon = summon || null;
    detector = onSummon ? createDetector(targetName, onSummon) : null;
    if (onSummon && ensureListener()) mode = "listening";
    else mode = "idle";
  },
  setPaused(p) { paused = !!p; },
  /* Capture the next modifier key press. Resolves { key, error }.
     Only Shift / Control / Alt / Meta are accepted. */
  captureKey() {
    return new Promise((resolve) => {
      if (!available || !ensureListener()) {
        resolve({ key: null, error: "Double-tap unavailable on this system." });
        return;
      }
      mode = "capturing";
      captureResolve = resolve;
      captureTimer = setTimeout(() => {
        finishCapture(null, "No key pressed — try again.");
      }, CAPTURE_TIMEOUT_MS);
    });
  },
  stop() {
    mode = "idle";
    stopHook();
  },
};
