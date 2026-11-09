"use strict";
/* Node tests for the Sideshow panel positioning. The positioning is
   pure logic — fed synthetic cursor positions and work areas, no
   Electron needed. The bug under test: with a fixed 560px window the
   bubble landed ~576px above a low cursor ("way up into weird
   land"); with the window fitted to the content it stays next to
   the cursor. */
const test = require("node:test");
const assert = require("node:assert/strict");
const pos = require("../position.js");

/* A MacBook Air-ish screen: 1440x900, menu bar 25px, dock ~75px. */
const AIR = { x: 0, y: 25, width: 1440, height: 800 };
const SMALL = { x: 0, y: 0, width: 1024, height: 400 }; /* shorter than the 560 max */
const SECOND = { x: 1440, y: -100, width: 1920, height: 1080 }; /* display above-right of primary */

function inside(p, bounds, w, h) {
  return p.x >= bounds.x && p.y >= bounds.y
    && p.x + w <= bounds.x + bounds.width
    && p.y + h <= bounds.y + bounds.height;
}

test("follow-cursor, cursor top-left: bubble just below-right of the pointer", () => {
  const p = pos.panelPositionNearCursor({ x: 100, y: 100 }, AIR, 200);
  assert.deepEqual(p, { x: 116, y: 116 });
});

test("follow-cursor, cursor low on screen with SHORT content: bubble stays near the cursor (the bug case)", () => {
  // One or two events: the fitted window is ~200px tall, not 560.
  const p = pos.panelPositionNearCursor({ x: 700, y: 700 }, AIR, 200);
  assert.ok(inside(p, AIR, pos.PANEL_W, 200), "panel must stay on-screen");
  // The bubble (window top) is just above the cursor, not ~576px up.
  assert.ok(Math.abs(p.y - 700) <= 220, "bubble top within ~220px of cursor, got y=" + p.y);
  assert.ok(p.y < 700, "flipped above the cursor");
  // The old fixed-560 behaviour would have put the top at 700-16-560=124.
  assert.ok(p.y > 400, "not thrown way up; got y=" + p.y);
});

test("follow-cursor, cursor low on screen with a FULL 560 tree: panel stays on-screen, bottom edge at the cursor", () => {
  const p = pos.panelPositionNearCursor({ x: 700, y: 700 }, AIR, 560);
  assert.ok(inside(p, AIR, pos.PANEL_W, 560));
  assert.equal(p.y + 560, 700 - pos.CURSOR_GAP); /* bottom edge just above the cursor */
});

test("follow-cursor, cursor near the right edge: flips left, stays on-screen", () => {
  const p = pos.panelPositionNearCursor({ x: 1400, y: 200 }, AIR, 200);
  assert.ok(inside(p, AIR, pos.PANEL_W, 200));
  assert.ok(p.x + pos.PANEL_W <= 1400 - pos.CURSOR_GAP, "panel is left of the cursor");
});

test("follow-cursor, cursor in the bottom-right corner: flips both ways, stays on-screen", () => {
  const p = pos.panelPositionNearCursor({ x: 1420, y: 800 }, AIR, 200);
  assert.ok(inside(p, AIR, pos.PANEL_W, 200));
  assert.ok(p.x < 1420 && p.y < 800);
});

test("small work area (shorter than the 560 max): fitted height fits, panel follows the cursor", () => {
  const h = pos.clampHeight(200, SMALL.height);
  assert.equal(h, 200);
  const p = pos.panelPositionNearCursor({ x: 500, y: 300 }, SMALL, h);
  assert.ok(inside(p, SMALL, pos.PANEL_W, h));
  // With the old fixed 560 the clamp pinned the top to the work-area top.
  assert.ok(p.y > SMALL.y, "not pinned to the top of the work area");
});

test("work area shorter than the minimum: height caps at the work area, panel pins to its top", () => {
  const h = pos.clampHeight(560, 100);
  assert.equal(h, 100);
  const p = pos.panelPositionNearCursor({ x: 100, y: 50 }, { x: 0, y: 0, width: 800, height: 100 }, h);
  assert.deepEqual(p, { x: 116, y: 0 });
});

test("multi-monitor: second display with an offset origin stays on that display", () => {
  const p = pos.panelPositionNearCursor({ x: 2000, y: 500 }, SECOND, 200);
  assert.ok(inside(p, SECOND, pos.PANEL_W, 200), "panel stays on the second display");
  assert.ok(p.x >= SECOND.x && p.y >= SECOND.y);
});

test("fixed positions anchor to the cursor's display work area", () => {
  const h = 200;
  assert.deepEqual(pos.resolvePanelPosition("top-left", null, { x: 700, y: 400 }, AIR, h), { x: 0, y: 25 });
  assert.deepEqual(pos.resolvePanelPosition("top-right", null, { x: 700, y: 400 }, AIR, h), { x: 1040, y: 25 });
  assert.deepEqual(pos.resolvePanelPosition("bottom-left", null, { x: 700, y: 400 }, AIR, h), { x: 0, y: 625 });
  assert.deepEqual(pos.resolvePanelPosition("bottom-right", null, { x: 700, y: 400 }, AIR, h), { x: 1040, y: 625 });
  assert.deepEqual(pos.resolvePanelPosition("center", null, { x: 700, y: 400 }, AIR, h), { x: 520, y: 325 });
});

test("fixed positions on a second display use that display, not the primary", () => {
  const p = pos.resolvePanelPosition("bottom-right", null, { x: 2000, y: 500 }, SECOND, 200);
  assert.deepEqual(p, { x: 1440 + 1920 - 400, y: -100 + 1080 - 200 });
});

test("custom: a saved dragged spot is reused, clamped on-screen", () => {
  const p = pos.resolvePanelPosition("custom", { x: 300, y: 300 }, { x: 700, y: 400 }, AIR, 200);
  assert.deepEqual(p, { x: 300, y: 300 });
  const off = pos.resolvePanelPosition("custom", { x: 5000, y: 5000 }, { x: 700, y: 400 }, AIR, 200);
  assert.ok(inside(off, AIR, pos.PANEL_W, 200), "an off-screen saved spot is clamped back on-screen");
});

test("custom with no saved spot yet falls back to follow-cursor", () => {
  const p = pos.resolvePanelPosition("custom", null, { x: 100, y: 100 }, AIR, 200);
  assert.deepEqual(p, { x: 116, y: 116 });
});

test("normalizePositionSetting: unknown mode falls back to cursor, bad custom is dropped", () => {
  assert.deepEqual(pos.normalizePositionSetting(null), { mode: "cursor", custom: null });
  assert.deepEqual(pos.normalizePositionSetting({ mode: "sideways" }), { mode: "cursor", custom: null });
  assert.deepEqual(pos.normalizePositionSetting({ mode: "top-left", custom: { x: "a", y: 1 } }), { mode: "top-left", custom: null });
  assert.deepEqual(pos.normalizePositionSetting({ mode: "custom", custom: { x: 120.6, y: 300 } }), { mode: "custom", custom: { x: 121, y: 300 } });
});

test("clampHeight: tall content grows to the work area (no fixed 560 cap)", () => {
  assert.equal(pos.clampHeight(undefined, 800), pos.PANEL_MIN_H);
  assert.equal(pos.clampHeight(9999, 800), 800);
  assert.equal(pos.clampHeight(1200, 800), 800);
  assert.equal(pos.clampHeight(200, 800), 200);
  assert.equal(pos.clampHeight(50, 800), pos.PANEL_MIN_H);
});
