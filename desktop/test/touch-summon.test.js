"use strict";
/* Touch summon: the panel must start interactive on show, so a tap
   lands even when the mouse cursor is elsewhere. Before this fix the
   panel started click-through (ignore=true) and only mouse movement
   flipped it back — after a tray-tap summon on a touchscreen the
   bubble stayed untappable, because touch has no hover. Static
   checks: main starts interactive, and the showing handler may only
   ever turn input on from the showing cursor position, never off. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const mainJs = read(path.join(DESKTOP, "main.js"));
const rendererJs = read(path.join(DESKTOP, "renderer", "renderer.js"));

function fnBody(src, name) {
  const start = src.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " must exist");
  const next = src.indexOf("\nfunction ", start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

test("showPanel starts interactive, not click-through", () => {
  const body = fnBody(mainJs, "showPanel");
  assert.ok(body.includes("setIgnoreMouseEvents(false)"), "showPanel must start with mouse input on");
  assert.ok(!body.includes("setIgnoreMouseEvents(true"), "showPanel must not start click-through");
});

test("the showing handler may only turn input on, never off", () => {
  const start = rendererJs.indexOf("onPanelShowing(");
  assert.ok(start >= 0, "the panel-showing handler must exist");
  const body = rendererJs.slice(start, rendererJs.indexOf("});", start));
  assert.ok(body.includes("ignoreMouseState = false"), "the showing handler must seed interactive state");
  assert.ok(body.includes("elementFromPoint(data.x, data.y)"), "the showing position must be checked against the page");
  assert.ok(body.indexOf("elementFromPoint") < body.indexOf("updateIgnoreMouse"), "the check must gate the update");
});
