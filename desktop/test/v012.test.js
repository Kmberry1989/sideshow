"use strict";
/* v0.1.12 batch: Next up / today first, Pin events, cached events
   (offline), Search Escape-to-clear, reminders with a configurable
   lead time (default off), and more fonts. Static checks for the
   pieces that need Electron to run live; the live behavior is
   verified headlessly in the smoke run. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const REPO = path.resolve(DESKTOP, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const mainJs = read(path.join(DESKTOP, "main.js"));
const preloadJs = read(path.join(DESKTOP, "preload.js"));
const rendererJs = read(path.join(DESKTOP, "renderer", "renderer.js"));
const stylesCss = read(path.join(DESKTOP, "renderer", "styles.css"));
const settingsHtml = read(path.join(DESKTOP, "renderer", "settings.html"));
const bubbleOptionsJs = read(path.join(DESKTOP, "bubble-options.js"));
const { nextUpcomingEvent, formatCountdown, eventStartMs } = require("../renderer/nextup.js");
const { weekDates } = require("../renderer/calendar.js");

function ev(title, date, startTime) {
  return { _id: title, title, date, startTime: startTime || "" };
}

test("next up: the soonest upcoming timed event wins", () => {
  const now = new Date(2026, 10, 10, 12, 0).getTime(); /* Tue Nov 10, noon */
  const list = [
    ev("Past", "2026-11-10", "10:00"),
    ev("Later today", "2026-11-10", "17:30"),
    ev("Tomorrow", "2026-11-11", "09:00"),
    ev("Next week", "2026-11-17", "09:00"),
  ];
  const next = nextUpcomingEvent(list, now);
  assert.ok(next, "must find a next event");
  assert.equal(next.event.title, "Later today");
  assert.equal(next.startMs, eventStartMs(list[1]));
  assert.equal(nextUpcomingEvent([ev("Past", "2026-11-10", "10:00")], now), null, "past events never count");
  assert.equal(nextUpcomingEvent([ev("Dateless", "", "")], now), null, "dateless events never count");
  assert.equal(nextUpcomingEvent([], now), null, "empty list has no next event");
});

test("next up: a date-only event counts for the rest of its day", () => {
  const now = new Date(2026, 10, 10, 12, 0).getTime();
  const allDay = ev("All day today", "2026-11-10", "");
  assert.equal(nextUpcomingEvent([allDay], now).event.title, "All day today");
  const yesterday = ev("All day yesterday", "2026-11-09", "");
  assert.equal(nextUpcomingEvent([yesterday], now), null, "yesterday's all-day event is over");
  /* A timed event later today beats an all-day event today (the
     all-day event sorts at the end of its day — it already started
     at midnight, so the timed one is the next thing starting). */
  const timed = ev("Later today", "2026-11-10", "17:30");
  assert.equal(nextUpcomingEvent([allDay, timed], now).event.title, "Later today");
  /* With nothing timed left today, the all-day event is next up. */
  assert.equal(nextUpcomingEvent([allDay], now).event.title, "All day today");
});

test("next up countdown: Starting now, minutes, hours, days", () => {
  const now = new Date(2026, 10, 10, 12, 0).getTime();
  const start = new Date(2026, 10, 10, 12, 0).getTime();
  assert.equal(formatCountdown(start, now, false), "Starting now");
  assert.equal(formatCountdown(start + 12 * 60000, now, false), "in 12m");
  assert.equal(formatCountdown(start + 135 * 60000, now, false), "in 2h 15m");
  assert.equal(formatCountdown(start + 60 * 60000, now, false), "in 1h");
  assert.equal(formatCountdown(start + 3 * 24 * 60 * 60000 + 2 * 60 * 60000, now, false), "in 3d 2h");
  assert.equal(formatCountdown(start, now, true), "Today");
  assert.equal(formatCountdown(new Date(2026, 10, 11, 0, 0).getTime(), now, true), "Tomorrow");
  assert.equal(formatCountdown(new Date(2026, 10, 14, 0, 0).getTime(), now, true), "Sat, Nov 14");
});

test("week view defaults to the current week", () => {
  const days = weekDates(new Date());
  const today = new Date();
  const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  assert.ok(days.some((d) => d.date === todayStr), "this week's days must include today");
  assert.ok(rendererJs.includes("let weekViewDate = new Date(now0.getFullYear(), now0.getMonth(), now0.getDate())"),
    "the week view must start on today");
});

test("next up row: rendered at the top of the tree, jumps to the branch, countdown ticks in place", () => {
  assert.ok(rendererJs.includes("function renderNextUp("), "renderer must have renderNextUp");
  assert.ok(rendererJs.includes('className = "bubble next-up"'), "Next up must be a bubble row");
  assert.ok(rendererJs.includes("function refreshNextUpCountdown("), "renderer must refresh the countdown in place");
  assert.ok(rendererJs.includes("setInterval(refreshNextUpCountdown, 30000)"), "countdown must tick every 30 seconds");
  assert.ok(rendererJs.includes("nextUpcomingEvent(visible)"), "Next up must come from the visible events");
  assert.ok(stylesCss.includes(".next-up {"), "styles must define .next-up");
  assert.ok(stylesCss.includes(".next-up-countdown"), "styles must define the countdown");
});

test("pin events: pinned section at the top, only in Pinned, persisted in settings", () => {
  assert.ok(rendererJs.includes("let pinnedIds = new Set()"), "renderer must hold the pinned ids");
  assert.ok(rendererJs.includes("function setEventPinned("), "renderer must have setEventPinned");
  assert.ok(rendererJs.includes("PIN_SVG"), "pin must be an SVG icon, never emoji");
  assert.ok(rendererJs.includes('className = "pinned-label"'), "Pinned section must be labeled");
  assert.ok(rendererJs.includes("pinnedIds.has(ev._id)"), "pinned events must be separated from the main list");
  assert.ok(rendererJs.includes("pinned.forEach((ev, i) => tree.appendChild(renderEventBranch(ev, i)))"),
    "pinned events must render in the Pinned section");
  assert.ok(rendererJs.includes("const rest = visible.filter((ev) => !pinnedIds.has(ev._id))"),
    "the main list must exclude pinned events");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:get-pinned-events"'), "main must handle get-pinned-events");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:set-pinned-events"'), "main must handle set-pinned-events");
  assert.ok(mainJs.includes('broadcastSettingsChange("pinned-events")'), "pin changes must broadcast to the bubble");
  assert.ok(preloadJs.includes('getPinnedEvents: () => ipcRenderer.invoke("sideshow:get-pinned-events")'),
    "preload must expose getPinnedEvents");
  assert.ok(preloadJs.includes('setPinnedEvents: (ids) => ipcRenderer.invoke("sideshow:set-pinned-events", ids)'),
    "preload must expose setPinnedEvents");
  assert.ok(rendererJs.includes('"pinned-events"'), "renderer must handle the pinned-events preview key");
  assert.ok(stylesCss.includes(".pin-btn.pinned"), "a pinned pin must fill in");
  assert.ok(stylesCss.includes(".pinned-label"), "styles must define .pinned-label");
});

test("cached events: offline cache file, saved from live data only, shown with an indicator", () => {
  assert.ok(mainJs.includes('const EVENTS_CACHE_FILE = "sideshow-events-cache.json"'), "main must name the cache file");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:get-cached-events"'), "main must handle get-cached-events");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:set-cached-events"'), "main must handle set-cached-events");
  assert.ok(preloadJs.includes('getCachedEvents: () => ipcRenderer.invoke("sideshow:get-cached-events")'),
    "preload must expose getCachedEvents");
  assert.ok(preloadJs.includes('setCachedEvents: (value) => ipcRenderer.invoke("sideshow:set-cached-events", value)'),
    "preload must expose setCachedEvents");
  assert.ok(rendererJs.includes("let cachedMode = false"), "renderer must track cached mode");
  assert.ok(rendererJs.includes("function saveEventCache("), "renderer must save the cache from live data");
  assert.ok(rendererJs.includes("Showing cached events"), "the tree must say when it shows cached events");
  assert.ok(rendererJs.includes("getCachedEvents()"), "renderer must load the cache at startup");
  /* The snapshot error keeps the last fetched events instead of
     the error state. */
  const sub = rendererJs.slice(rendererJs.indexOf("unsubscribe = onSnapshot"));
  assert.ok(sub.includes("cachedMode = true"), "a failed fetch must fall back to the cache");
});

test("search: Escape clears the search first, a second Escape hides the panel", () => {
  assert.ok(rendererJs.includes('searchInput.value = ""'), "Escape must clear the search box");
  assert.ok(rendererJs.includes('searchQuery = ""'), "Escape must clear the search filter");
  assert.ok(rendererJs.includes("searchInput.focus()"), "clearing must keep the search box focused");
});

test("reminders: off by default, one configurable lead time, list in one constant", () => {
  /* One constant — Kyle's pick (Nov 10, 2026): 5, 15, 30, 60. */
  assert.ok(mainJs.includes("const REMINDER_LEAD_MINUTES = [5, 15, 30, 60];"),
    "the lead-time list must be one constant: [5, 15, 30, 60]");
  assert.ok(mainJs.includes("const REMINDER_LEAD_DEFAULT = 15;"), "the default lead must be 15 minutes");
  assert.ok(mainJs.includes("function reminderLeadMinutes()"), "main must normalize the lead time");
  assert.ok(!mainJs.includes("REMINDER_LEADS"), "the fixed 1-day / 1-hour leads must be gone");
  assert.ok(mainJs.includes("return settings.reminders === true;"), "reminders must default off");
  assert.ok(rendererJs.includes("let remindersOn = false;"), "the renderer must default reminders off");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:get-reminder-lead"'), "main must handle get-reminder-lead");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:set-reminder-lead"'), "main must handle set-reminder-lead");
  assert.ok(preloadJs.includes('getReminderLead: () => ipcRenderer.invoke("sideshow:get-reminder-lead")'),
    "preload must expose getReminderLead");
  assert.ok(preloadJs.includes('setReminderLead: (minutes) => ipcRenderer.invoke("sideshow:set-reminder-lead", minutes)'),
    "preload must expose setReminderLead");
  assert.ok(settingsHtml.includes('id="reminderLeadRow"'), "settings must have a Remind me row");
  assert.ok(settingsHtml.includes('id="reminderLeadBtn"'), "settings must have a Remind me button");
  assert.ok(settingsHtml.includes("15 min before"), "the lead button must show the current lead");
  assert.ok(rendererJs.includes("REMINDER_LEAD_OPTIONS"), "the renderer must cycle the lead list");
  /* The lead row only shows while reminders are on. */
  assert.ok(rendererJs.includes('row.hidden = !remindersOn'), "the lead row must hide while reminders are off");
  /* A fired reminder plays the current sound style's copy sound
     when Sound is on. */
  assert.ok(mainJs.includes('panel.webContents.send("sideshow:play-sound")'), "main must ask the panel to play the reminder sound");
  assert.ok(preloadJs.includes("onPlaySound"), "preload must expose onPlaySound");
  assert.ok(rendererJs.includes("onPlaySound"), "renderer must play the sound on a fired reminder");
  assert.ok(rendererJs.includes("if (soundOn) playCopySound()"), "the reminder sound must respect Sound on/off");
});

test("fonts: six more system fonts in the list, no downloads", () => {
  const bubbleOptions = require("../bubble-options.js");
  for (const font of ["georgia", "palatino", "verdana", "tahoma", "trebuchet", "courier"]) {
    assert.ok(bubbleOptions.FONTS[font], "font list must include " + font);
    assert.ok(bubbleOptions.FONT_LABELS[font], "font labels must include " + font);
    assert.ok(bubbleOptions.FONT_CYCLE.indexOf(font) >= 0, "font cycle must include " + font);
  }
  assert.equal(Object.keys(bubbleOptions.FONTS).length, 10, "ten fonts total");
  assert.equal(bubbleOptions.normalizeBubbleOptions({ font: "georgia" }).font, "georgia", "a new font must survive normalize");
  assert.equal(bubbleOptions.normalizeBubbleOptions({ font: "nope" }).font, "mono", "an unknown font must fall back to Mono");
  assert.equal(bubbleOptions.normalizeBubbleOptions({}).font, "mono", "the default font must stay Mono");
  /* System fonts only — nothing to download. */
  for (const stack of Object.values(bubbleOptions.FONTS)) {
    assert.ok(!/url\(|@font-face|http/.test(stack), "font stacks must be system fonts, no downloads: " + stack);
  }
});
