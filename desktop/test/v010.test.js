"use strict";
/* v0.1.10 static checks (no Electron needed): drag from anywhere
   on the panel, calendar view backdrop from the existing background
   settings, White in the color swatches, and one-tap preset themes.
   Each test names the user-facing behavior it guards so a future
   edit that silently drops one fails loudly here first. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const RENDERER = path.join(DESKTOP, "renderer");
const read = (p) => fs.readFileSync(p, "utf8");
const settingsHtml = read(path.join(RENDERER, "settings.html"));
const stylesCss = read(path.join(RENDERER, "styles.css"));
const rendererJs = read(path.join(RENDERER, "renderer.js"));
const dragJs = read(path.join(RENDERER, "drag.js"));
const mainJs = read(path.join(DESKTOP, "main.js"));
/* Body of the first CSS rule whose selector starts a line as `sel`, or null.
   (Line-anchored: a combined selector line like ".x, .settings-body {"
   must not match ".settings-body".) */
const ruleBody = (css, sel) => {
  const m = css.match(new RegExp("(?:^|\\n)" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "s"));
  return m ? m[1] : null;
};

test("drag from anywhere: a document pointerdown starts the drag, not the root alone", () => {
  assert.ok(!rendererJs.includes("onRootMouseDown"), "the root-only drag handler must be gone");
  assert.ok(!rendererJs.includes('root.addEventListener("mousedown"'), "the root must not carry its own drag listener");
  assert.ok(rendererJs.includes('from "./drag.js"'), "renderer must import the drag helper");
  assert.ok(rendererJs.includes("classifyDragTarget(e.target)"), "the document pointerdown must classify its target");
  assert.ok(rendererJs.includes("fromRoot: info.fromRoot"), "the drag must remember whether it started on the root");
  assert.ok(rendererJs.includes("if (IS_SETTINGS_WINDOW) return;"), "the settings window must never start a panel drag");
});

test("drag from anywhere: only the root's click toggles the focused event", () => {
  assert.ok(rendererJs.includes("else if (allowToggle && fromRoot)"), "the no-drag toggle must be gated on the root origin and on a real pointerup");
  assert.ok(dragJs.includes("DRAG_EXCLUDE_SELECTOR"), "the input exclusion must live in the drag module");
  assert.ok(rendererJs.includes("suppressClickAfterDrag"), "a drag must not also fire the click under it");
  assert.ok(rendererJs.includes('document.addEventListener("click"'), "the click suppressor must exist");
  assert.ok(rendererJs.includes("e.stopPropagation()"), "the suppressor must stop the post-drag click");
});

test("drag from anywhere: the whole visible panel is interactive, not click-through", () => {
  const sel = rendererJs.slice(rendererJs.indexOf("const CLICKABLE_SELECTOR"), rendererJs.indexOf(";", rendererJs.indexOf("const CLICKABLE_SELECTOR")));
  assert.ok(sel.includes(".bubble-tree"), "tree gaps must not pass clicks through to the desktop");
  assert.ok(sel.includes(".calendar-view"), "calendar cells must not pass clicks through to the desktop");
  assert.ok(sel.includes(".bubble-header"), "header gaps must not pass clicks through to the desktop");
  assert.ok(sel.includes("input"), "the search input must stay in the clickable set");
});

test("calendar backdrop: the grid uses the existing bubble fill, no new setting", () => {
  const view = stylesCss.slice(stylesCss.indexOf(".calendar-view {"), stylesCss.indexOf("}", stylesCss.indexOf(".calendar-view {")));
  assert.ok(view.includes("background: var(--bubble-fill)"), "the calendar view must take the bubble fill as its backdrop");
  assert.ok(view.includes("border-radius: var(--corner-radius, 32px)"), "the calendar backdrop must keep the rounded look");
  assert.ok(view.includes("border: 1.5px solid var(--bubble-border-user, var(--bubble-border))"), "the calendar backdrop must carry the bubble border");
  assert.ok(!rendererJs.includes("calendarBackdrop") && !rendererJs.includes("calBackdrop"), "no new backdrop setting may exist");
});

test("White is a pickable color swatch, but never an accent", () => {
  assert.ok(rendererJs.includes('{ value: "#ffffff", label: "White" }'), "White must be in COLOR_SWATCHES");
  const accent = rendererJs.slice(rendererJs.indexOf("const ACCENT_SWATCHES"), rendererJs.indexOf("let accentSettingValue"));
  assert.ok(!accent.includes("#ffffff"), "a white accent would be invisible on the light fills");
  const color = rendererJs.slice(rendererJs.indexOf("const COLOR_SWATCHES"), rendererJs.indexOf("async function saveBubbleOptions"));
  assert.ok(color.includes('#ffffff'), "White must be in the color list feeding the four pickers");
});

test("preset themes: Studio, Dark, Light set the existing settings in one tap", () => {
  assert.ok(rendererJs.includes('{ id: "studio", label: "Studio", appearance: "glass", bgColor: "#a44a24", accent: "#a44a24" }'), "Studio preset missing or wrong");
  assert.ok(rendererJs.includes('{ id: "dark", label: "Dark", appearance: "shaded", bgColor: "#2b2118", accent: "#a44a24" }'), "Dark preset missing or wrong");
  assert.ok(rendererJs.includes('{ id: "light", label: "Light", appearance: "glass", bgColor: "#ffffff", accent: "#a44a24" }'), "Light preset missing or wrong");
  assert.ok(settingsHtml.includes('id="presetBtns"'), "preset buttons missing from the Appearance tab");
  assert.ok(rendererJs.includes("buildPresetButtons();"), "preset buttons must be built at startup");
  const apply = rendererJs.slice(rendererJs.indexOf("async function applyPreset"), rendererJs.indexOf("/* ---------- bubble appearance ---------- */"));
  assert.ok(apply.includes("setAppearance(p.appearance)"), "a preset must set the look through the existing setting");
  assert.ok(apply.includes("setAccent(p.accent)"), "a preset must set the accent through the existing setting");
  assert.ok(apply.includes("saveBubbleOptions()"), "a preset must persist the background through the existing setting");
  assert.ok(apply.includes("bubbleOptions.textColor = null"), "a preset must leave text ink to auto so it reads on its background");
  /* Every preset color comes from the existing palette — nothing invented. */
  for (const hex of ["#a44a24", "#2b2118", "#ffffff"]) {
    assert.ok(rendererJs.includes(hex), hex + " must already be in the swatch palette");
  }
});

/* ---------- touch: Pointer Events, one path ---------- */

test("drag is Pointer Events only: no mouse-only drag listeners remain", () => {
  assert.ok(!rendererJs.includes('addEventListener("mousedown"'), "no mousedown drag listener");
  assert.ok(!rendererJs.includes('addEventListener("mouseup"'), "no mouseup drag listener");
  assert.ok(!rendererJs.includes("touchstart") && !rendererJs.includes("touchend") && !rendererJs.includes("touchmove"), "no separate touch handlers");
  for (const ev of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    assert.ok(rendererJs.includes(`addEventListener("${ev}"`), `pointer ${ev} listener present`);
  }
});

test("drag tracks the starting pointer and ignores other pointers", () => {
  assert.ok(rendererJs.includes("pointerId: e.pointerId"), "dragState stores the starting pointerId");
  assert.ok(rendererJs.includes("e.pointerId !== dragState.pointerId"), "move/up/cancel ignore other pointers");
});

test("pointercancel aborts the drag without the root toggle", () => {
  assert.ok(rendererJs.includes('addEventListener("pointercancel"'), "pointercancel listener present");
  assert.ok(rendererJs.includes("endPanelDrag(false)"), "cancel ends the drag with no toggle");
  assert.ok(rendererJs.includes("endPanelDrag(true)"), "pointerup still ends the drag with the toggle");
});

test("touch drags from a scroll area only engage when horizontal", () => {
  assert.ok(dragJs.includes("shouldEngageDrag"), "the gate must live in the drag module");
  assert.ok(rendererJs.includes("shouldEngageDrag(e.pointerType, dragState.inScrollArea"), "the pointermove handler must apply the gate");
  assert.ok(rendererJs.includes("inScrollArea: info.inScrollArea"), "the drag must remember whether it started in a scroll area");
});

test("touch-action: manipulation on interactive elements, pan-y on scroll containers, none on the header", () => {
  assert.ok(/button, input, select, a\s*\{\s*touch-action: manipulation;/.test(stylesCss), "buttons/inputs get manipulation (no tap delay)");
  for (const sel of [".bubble-tree", ".calendar-view", ".settings-body"]) {
    const rule = ruleBody(stylesCss, sel);
    assert.ok(rule && /touch-action:\s*pan-y/.test(rule), `${sel} scrolls natively (pan-y)`);
  }
  const header = ruleBody(stylesCss, ".bubble-header");
  assert.ok(header && /touch-action:\s*none/.test(header), "header never scrolls, so a drag from it always moves the window");
  assert.ok(stylesCss.includes("-webkit-touch-callout: none"), "no long-press callout");
});

test("eye button has a fingertip-sized hit area with the same visual size", () => {
  const rule = ruleBody(stylesCss, ".eye-btn");
  assert.ok(rule && /width:\s*34px/.test(rule) && /height:\s*34px/.test(rule), "eye hit area is 34px");
  assert.ok(rule && /padding:\s*6px/.test(rule), "eye padding grows the hit area");
  assert.ok(rule && /margin:\s*-5px -6px -6px -4px/.test(rule), "negative margins keep the layout footprint at 22px");
});

test("tray single-click is the touch summon path (no new summon needed)", () => {
  assert.ok(mainJs.includes('tray.on("click"'), "tray click handler exists");
  assert.ok(mainJs.includes("requestToggle()"), "tray click toggles the panel");
});
