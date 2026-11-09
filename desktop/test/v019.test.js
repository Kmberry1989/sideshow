"use strict";
/* v0.1.9 static checks (no Electron needed): hide/show + edit,
   themed scrollbar, icon color, calendar view, entry separation,
   key badge at the end, Dock-style hover magnification, and the
   overlay framing rule (always-on-top, no horizontal scrolling).
   Each test names the user-facing behavior it guards so a future
   edit that silently drops one fails loudly here first. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const RENDERER = path.join(DESKTOP, "renderer");
const read = (p) => fs.readFileSync(p, "utf8");
const indexHtml = read(path.join(RENDERER, "index.html"));
const settingsHtml = read(path.join(RENDERER, "settings.html"));
const stylesCss = read(path.join(RENDERER, "styles.css"));
const mainJs = read(path.join(DESKTOP, "main.js"));
const preloadJs = read(path.join(DESKTOP, "preload.js"));
const rendererJs = read(path.join(RENDERER, "renderer.js"));
const bubbleOptionsJs = read(path.join(DESKTOP, "bubble-options.js"));

test("key badge sits after the value text, not before it", () => {
  const i = rendererJs.indexOf("value-bubble");
  const badgeAt = rendererJs.indexOf("key-badge", rendererJs.indexOf("vb.innerHTML"));
  const valueAt = rendererJs.indexOf("value-text", rendererJs.indexOf("vb.innerHTML"));
  assert.ok(badgeAt > valueAt && valueAt > 0, "the key badge must come after the value text in the value bubble");
  assert.ok(rendererJs.includes('</span><span class="key-badge">'), "badge must follow the value span directly");
});

test("overlay stays always-on-top in the panel window", () => {
  assert.ok(mainJs.includes("alwaysOnTop: true"), "createPanel must keep alwaysOnTop: true");
  assert.ok(mainJs.includes("alwaysOnTop: false"), "the settings window must not be always-on-top");
});

test("no horizontal scrolling in any bubble view", () => {
  assert.ok(stylesCss.includes(".bubble-tree {") && stylesCss.includes("overflow-x: hidden"), "the tree must never scroll sideways");
  assert.ok(stylesCss.includes(".calendar-view {") && stylesCss.includes("overflow-x: hidden"), "the calendar must never scroll sideways");
  assert.ok(stylesCss.includes(".cal-grid { display: grid; grid-template-columns: repeat(7, 1fr);"), "the calendar grid must be 7 equal columns");
  assert.ok(stylesCss.includes(".cal-event {") && stylesCss.includes("text-overflow: ellipsis"), "calendar entries must truncate, not overflow");
  assert.ok(stylesCss.includes(".bubble-tree[hidden], .calendar-view[hidden] { display: none; }"), "the hidden view must not take space");
});

test("hide/show: hidden-events IPC exists end to end", () => {
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:get-hidden-events"'), "get-hidden-events IPC missing");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:set-hidden-events"'), "set-hidden-events IPC missing");
  assert.ok(mainJs.includes('broadcastSettingsChange("hidden-events")'), "hiding must broadcast to the bubble");
  assert.ok(preloadJs.includes("getHiddenEvents:"), "preload missing getHiddenEvents");
  assert.ok(preloadJs.includes("setHiddenEvents:"), "preload missing setHiddenEvents");
  assert.ok(rendererJs.includes("hiddenIds"), "renderer must track hidden ids");
  assert.ok(rendererJs.includes("setEventHidden"), "renderer must have the hide/show toggle");
  assert.ok(rendererJs.includes("visibleEvents()"), "the bubble must render visible events only");
  assert.ok(rendererJs.includes("All events hidden."), "hiding everything must say so, not pretend the bank is empty");
});

test("hide/show: the eye sits on each event entry", () => {
  assert.ok(rendererJs.includes("EYE_SVG"), "eye icon missing");
  assert.ok(rendererJs.includes("EYE_OFF_SVG"), "eye-off icon missing (Settings list)");
  assert.ok(rendererJs.includes('class="eye-btn"'), "eye button missing");
  assert.ok(rendererJs.includes("e.stopPropagation()"), "the eye must not also toggle the event open");
});

test("edit events: the Settings Events list writes back to Firestore", () => {
  assert.ok(settingsHtml.includes('id="tab-events"'), "Events tab panel missing from settings.html");
  assert.ok(settingsHtml.includes('id="eventsList"'), "events list container missing");
  assert.ok(rendererJs.includes("SETTINGS_TABS") && rendererJs.includes('"events"'), "Events must be a settings tab");
  assert.ok(rendererJs.includes("renderEventsList"), "Events list renderer missing");
  assert.ok(rendererJs.includes("saveEventEdit"), "event save missing");
  assert.ok(rendererJs.includes("updateDoc(doc(db, COLLECTION, ev._id), patch)"), "edits must write the same Firestore doc");
  assert.ok(rendererJs.includes("serverTimestamp()"), "edits must stamp updatedAt so newest-first order holds");
  assert.ok(rendererJs.includes("ev.source === \"gcal\""), "Google Calendar events must stay read-only in the list");
});

test("themed scrollbar: accent thumb, transparent track, Slim/Standard", () => {
  assert.ok(bubbleOptionsJs.includes('scrollbar: "slim"'), "scrollbar must default to Slim");
  assert.ok(stylesCss.includes("::-webkit-scrollbar-thumb") && stylesCss.includes("background: var(--accent)"), "scrollbar thumb must take the accent");
  assert.ok(stylesCss.includes("::-webkit-scrollbar-track") && stylesCss.includes("background: transparent"), "scrollbar track must be transparent");
  assert.ok(stylesCss.includes("--scroll-w: 6px") && stylesCss.includes("--scroll-w: 12px"), "both widths must exist");
  assert.ok(settingsHtml.includes('id="scrollbarBtn"'), "scrollbar control missing from Appearance");
});

test("icon color: a setting for the header icons, defaulting to theme ink", () => {
  assert.ok(bubbleOptionsJs.includes("iconColor: null"), "icon color must default to null (theme ink)");
  assert.ok(stylesCss.includes("--icon-color-user"), "icon color variable missing from styles");
  assert.ok(stylesCss.includes("color: var(--icon-color-user, var(--ink-soft))"), "header icons must use the icon color with a theme-ink fallback");
  assert.ok(settingsHtml.includes('id="iconSwatches"') && settingsHtml.includes('id="iconColorInput"'), "icon color control missing from Appearance");
  assert.ok(rendererJs.includes("iconColor"), "renderer must apply the icon color");
});

test("entry separation: all three options exist and the default is Bullets", () => {
  assert.ok(bubbleOptionsJs.includes('separation: "bullets"'), "separation must default to Bullets");
  assert.ok(bubbleOptionsJs.includes('SEPARATIONS = ["bullets", "lines", "spacing"]'), "all three separation options must exist");
  assert.ok(stylesCss.includes(".sep-bullets .event-bubble::before"), "bullets style missing");
  assert.ok(stylesCss.includes(".sep-lines .event-branch:not(:last-child)"), "divider-lines style missing");
  assert.ok(stylesCss.includes(".sep-spacing .event-branch"), "extra-spacing style missing");
  assert.ok(settingsHtml.includes('id="separationBtn"'), "separation control missing from Appearance");
});

test("calendar view: toggle, grid, and click-to-branch exist", () => {
  assert.ok(indexHtml.includes('id="calendarViewBtn"'), "calendar toggle missing from the bubble header");
  assert.ok(indexHtml.includes('id="calendarView"'), "calendar view container missing");
  assert.ok(rendererJs.includes("renderCalendar"), "calendar renderer missing");
  assert.ok(rendererJs.includes("monthGrid(calViewYear, calViewMonth)"), "calendar must build from the month grid");
  assert.ok(rendererJs.includes("setBubbleViewMode"), "view switching missing");
  assert.ok(rendererJs.includes("focusedEvent = ev;") && rendererJs.includes('setBubbleViewMode("tree")'), "clicking a calendar entry must open that event's branch in the tree");
});

test("hover magnification: inner bubbles only, motion-full only, siblings deflate", () => {
  assert.ok(stylesCss.includes(".motion-full .bubble-tree .event-bubble:hover { transform: scale(1.05); }"), "hovered event must inflate");
  assert.ok(stylesCss.includes(".motion-full .bubble-tree .value-bubble:hover { transform: scale(1.05); }"), "hovered value must inflate");
  assert.ok(stylesCss.includes(":has(.event-branch:hover) .event-branch:not(:hover) .event-bubble { transform: scale(0.98); }"), "other entries must deflate while one is hovered");
  assert.ok(!stylesCss.includes(".motion-reduced .bubble-tree .event-bubble:hover"), "reduced motion must not magnify");
  assert.ok(!stylesCss.includes(".motion-off .bubble-tree .event-bubble:hover"), "motion off must not magnify");
});
