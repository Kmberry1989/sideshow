"use strict";
/* Week journal view: the week's 7 days starting Sunday (the same
   week start as the month grid), date shifting for navigation, and
   the header view cycle tree -> month -> week -> tree. Pure
   functions — no Electron, no sign-in. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { weekDates, shiftDateStr, groupEventsByDate } = require("../renderer/calendar.js");

const DESKTOP = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const rendererJs = read(path.join(DESKTOP, "renderer", "renderer.js"));
const indexHtml = read(path.join(DESKTOP, "renderer", "index.html"));
const stylesCss = read(path.join(DESKTOP, "renderer", "styles.css"));

test("weekDates returns the 7 days starting Sunday", () => {
  /* Tue Nov 10, 2026 -> week Sun Nov 8 .. Sat Nov 14. */
  const days = weekDates(new Date(2026, 10, 10));
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.date), [
    "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11",
    "2026-11-12", "2026-11-13", "2026-11-14",
  ]);
  assert.equal(days[0].day, 8);
  assert.equal(days[6].day, 14);
  /* A Sunday itself starts its own week. */
  assert.equal(weekDates(new Date(2026, 10, 8))[0].date, "2026-11-08");
  /* A Saturday ends the week it is in. */
  assert.equal(weekDates(new Date(2026, 10, 14))[6].date, "2026-11-14");
});

test("weekDates crosses a month boundary", () => {
  /* Sat Nov 28, 2026 -> week Sun Nov 22 .. Sat Nov 28; the next
     week runs Sun Nov 29 .. Sat Dec 5. */
  const days = weekDates(new Date(2026, 10, 30));
  assert.deepEqual(days.map((d) => d.date), [
    "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02",
    "2026-12-03", "2026-12-04", "2026-12-05",
  ]);
  assert.equal(days[0].month, 10);
  assert.equal(days[2].month, 11);
});

test("weekDates matches the month grid's week start", () => {
  /* The month grid starts weeks Sunday; the journal week for any
     day in a grid week is that same Sunday. Nov 2026 starts Sun
     Nov 1, so the week of Wed Nov 4 starts Nov 1. */
  const days = weekDates(new Date(2026, 10, 4));
  assert.equal(days[0].date, "2026-11-01");
  /* And the week is 7 consecutive days. */
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1].date + "T00:00:00Z");
    const cur = new Date(days[i].date + "T00:00:00Z");
    assert.equal(cur.getTime() - prev.getTime(), 24 * 60 * 60 * 1000);
  }
});

test("shiftDateStr moves a date by days for week navigation", () => {
  assert.equal(shiftDateStr("2026-11-08", 7), "2026-11-15");
  assert.equal(shiftDateStr("2026-11-15", -7), "2026-11-08");
  assert.equal(shiftDateStr("2026-11-30", 1), "2026-12-01");
  assert.equal(shiftDateStr("2026-12-01", -1), "2026-11-30");
  assert.equal(shiftDateStr("", 7), "");
  assert.equal(shiftDateStr("soon", 7), "");
});

test("the week view groups by start date, same rules as the month grid", () => {
  const evs = [
    { _id: "a", title: "Ornaments", date: "2026-11-10", startTime: "17:30" },
    { _id: "b", title: "Turkey", date: "2026-11-14", startTime: "11:00" },
    { _id: "c", title: "No date", date: "" },
  ];
  const byDate = groupEventsByDate(evs);
  assert.equal((byDate["2026-11-10"] || []).length, 1);
  assert.equal((byDate["2026-11-14"] || []).length, 1);
  assert.equal(byDate["2026-11-11"], undefined); /* empty day: no entry, just the heading */
  assert.equal(byDate[""], undefined);
});

test("header button cycles tree -> month -> week -> tree", () => {
  assert.ok(rendererJs.includes('const VIEW_CYCLE = ["tree", "calendar", "week"]'),
    "renderer must define the three-mode view cycle");
  assert.ok(rendererJs.includes("function cycleViewMode()"), "renderer must have cycleViewMode");
  assert.ok(rendererJs.includes("function renderWeek()"), "renderer must have renderWeek");
  assert.ok(rendererJs.includes("function shiftWeek("), "renderer must have shiftWeek");
  assert.ok(rendererJs.includes("Week of "), "week label must say Week of");
});

test("week view container exists and shares the calendar backdrop and border", () => {
  assert.ok(indexHtml.includes('id="weekView"'), "index.html must have a weekView container");
  assert.ok(indexHtml.includes('class="calendar-view week-view"'),
    "week view must share the calendar-view class (same backdrop, border, scrollbar)");
  assert.ok(stylesCss.includes(".week-day"), "styles must define week-day sections");
  assert.ok(stylesCss.includes(".week-event"), "styles must define week event rows");
  assert.ok(stylesCss.includes(".week-time"), "styles must define week time");
  assert.ok(rendererJs.includes('weekViewDate = new Date(n.getFullYear(), n.getMonth(), n.getDate())'),
    "week label click must jump back to the current week");
});
