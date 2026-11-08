"use strict";
/* Node tests for the double-tap + long-click summon state machines.
   The detectors are pure logic — fed synthetic events, no native
   hook needed. */
const test = require("node:test");
const assert = require("node:assert/strict");
const doubletap = require("../doubletap.js");
const longclick = require("../longclick.js");

function keyEvent(keycode, mods) {
  return Object.assign({ keycode, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, mods || {});
}

test("keyNameForCode maps left and right modifiers to one logical key", () => {
  assert.equal(doubletap.keyNameForCode(42), "Shift");
  assert.equal(doubletap.keyNameForCode(54), "Shift");
  assert.equal(doubletap.keyNameForCode(29), "Control");
  assert.equal(doubletap.keyNameForCode(3613), "Control");
  assert.equal(doubletap.keyNameForCode(56), "Alt");
  assert.equal(doubletap.keyNameForCode(3640), "Alt");
  assert.equal(doubletap.keyNameForCode(3675), "Meta");
  assert.equal(doubletap.keyNameForCode(30), null);
});

test("double-tap fires on two lone Shift taps within the window", () => {
  let fired = 0;
  const d = doubletap.createDetector("Shift", () => { fired++; });
  d.keydown(keyEvent(42, { shiftKey: true }));
  d.keyup(keyEvent(42));
  assert.equal(fired, 0);
  d.keydown(keyEvent(42, { shiftKey: true }));
  d.keyup(keyEvent(42));
  assert.equal(fired, 1);
});

test("double-tap fires on left then right Shift", () => {
  let fired = 0;
  const d = doubletap.createDetector("Shift", () => { fired++; });
  d.keydown(keyEvent(42, { shiftKey: true }));
  d.keyup(keyEvent(42));
  d.keydown(keyEvent(54, { shiftKey: true }));
  d.keyup(keyEvent(54));
  assert.equal(fired, 1);
});

test("another key in between breaks the double-tap sequence", () => {
  let fired = 0;
  const d = doubletap.createDetector("Shift", () => { fired++; });
  d.keydown(keyEvent(42, { shiftKey: true }));
  d.keyup(keyEvent(42));
  d.keydown(keyEvent(30)); // 'a' — typing
  d.keyup(keyEvent(30));
  d.keydown(keyEvent(42, { shiftKey: true }));
  d.keyup(keyEvent(42));
  assert.equal(fired, 0);
});

test("a combination (Shift held with Ctrl) does not count as a tap", () => {
  let fired = 0;
  const d = doubletap.createDetector("Shift", () => { fired++; });
  d.keydown(keyEvent(42, { shiftKey: true, ctrlKey: true }));
  d.keyup(keyEvent(42));
  d.keydown(keyEvent(42, { shiftKey: true }));
  d.keyup(keyEvent(42));
  assert.equal(fired, 0);
});

test("a held key does not repeat-fire, and a third tap starts a new sequence", () => {
  let fired = 0;
  const d = doubletap.createDetector("Shift", () => { fired++; }, 400);
  d.keydown(keyEvent(42, { shiftKey: true }));
  d.keydown(keyEvent(42, { shiftKey: true })); // repeat while held
  d.keyup(keyEvent(42));
  assert.equal(fired, 0);
  d.keydown(keyEvent(42, { shiftKey: true }));
  d.keyup(keyEvent(42));
  assert.equal(fired, 1);
  d.keydown(keyEvent(42, { shiftKey: true })); // third tap: new sequence, no fire
  d.keyup(keyEvent(42));
  assert.equal(fired, 1);
  d.keydown(keyEvent(42, { shiftKey: true })); // fourth tap: completes the new pair
  d.keyup(keyEvent(42));
  assert.equal(fired, 2);
});

test("double-tap respects a short window (two taps 1s apart do not fire)", () => {
  let fired = 0;
  const d = doubletap.createDetector("Shift", () => { fired++; }, 400);
  const realNow = Date.now;
  let now = 1000000;
  Date.now = () => now;
  try {
    d.keydown(keyEvent(42, { shiftKey: true }));
    d.keyup(keyEvent(42));
    now += 1000;
    d.keydown(keyEvent(42, { shiftKey: true }));
    d.keyup(keyEvent(42));
    assert.equal(fired, 0);
  } finally {
    Date.now = realNow;
  }
});

test("long-click fires on a hold past the threshold, not on a quick click", () => {
  let fired = 0;
  const d = longclick.createDetector({ button: 1, ms: 1000 }, () => { fired++; });
  const realNow = Date.now;
  let now = 2000000;
  Date.now = () => now;
  try {
    d.mousedown({ button: 1, x: 100, y: 100 });
    now += 100; // quick click
    d.mouseup({ button: 1, x: 100, y: 100 });
    assert.equal(fired, 0);
    d.mousedown({ button: 1, x: 100, y: 100 });
    now += 1200; // long hold
    d.mouseup({ button: 1, x: 100, y: 100 });
    assert.equal(fired, 1);
  } finally {
    Date.now = realNow;
  }
});

test("long-click ignores the wrong button and a drag", () => {
  let fired = 0;
  const d = longclick.createDetector({ button: 2, ms: 1000 }, () => { fired++; });
  const realNow = Date.now;
  let now = 3000000;
  Date.now = () => now;
  try {
    d.mousedown({ button: 1, x: 100, y: 100 }); // left, but right is configured
    now += 1500;
    d.mouseup({ button: 1, x: 100, y: 100 });
    assert.equal(fired, 0);
    d.mousedown({ button: 2, x: 100, y: 100 });
    now += 300;
    d.mousemove({ button: 2, x: 200, y: 100 }); // drag 100px
    now += 1200;
    d.mouseup({ button: 2, x: 200, y: 100 });
    assert.equal(fired, 0);
  } finally {
    Date.now = realNow;
  }
});

test("longclick.describe names the button and hold length", () => {
  assert.equal(longclick.describe({ button: 1, ms: 1000 }), "Left 1.0s");
  assert.equal(longclick.describe({ button: 2, ms: 1500 }), "Right 1.5s");
  assert.equal(longclick.describe(null), "None");
});
