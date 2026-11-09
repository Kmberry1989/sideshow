"use strict";
/* Calendar view: month grid + grouping events by date. Pure
   functions — no Electron, no sign-in. The grid must always be
   6 weeks x 7 cells starting Sunday, with adjacent-month days
   included (dimmed, not blank); events group by their start date
   only, and dateless events stay out of the grid. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { daysInMonth, monthGrid, groupEventsByDate } = require("../renderer/calendar.js");

test("daysInMonth handles February in leap and common years", () => {
  assert.equal(daysInMonth(2026, 1), 28);
  assert.equal(daysInMonth(2024, 1), 29);
  assert.equal(daysInMonth(2026, 10), 30);
  assert.equal(daysInMonth(2026, 11), 31);
});

test("monthGrid is 6 weeks of 7 cells starting Sunday", () => {
  /* November 2026: Nov 1 is a Sunday, so the grid starts Nov 1. */
  const nov = monthGrid(2026, 10);
  assert.equal(nov.length, 6);
  nov.forEach((week) => assert.equal(week.length, 7));
  assert.equal(nov[0][0].date, "2026-11-01");
  assert.equal(nov[0][0].day, 1);
  assert.equal(nov[0][0].inMonth, true);
  assert.equal(nov[5][6].date, "2026-12-12");
  assert.equal(nov[5][6].inMonth, false);
  /* December 2026: Dec 1 is a Tuesday, so the grid starts on the
     Sunday before — Nov 29. */
  const dec = monthGrid(2026, 11);
  assert.equal(dec[0][0].date, "2026-11-29");
  assert.equal(dec[0][0].inMonth, false);
  assert.equal(dec[0][2].date, "2026-12-01");
  assert.equal(dec[0][2].inMonth, true);
  /* Every cell's date is a valid YYYY-MM-DD and days are sequential. */
  const flat = nov.flat();
  for (let i = 1; i < flat.length; i++) {
    const prev = new Date(flat[i - 1].date + "T00:00:00");
    const cur = new Date(flat[i].date + "T00:00:00");
    assert.equal(cur.getTime() - prev.getTime(), 24 * 60 * 60 * 1000);
  }
});

test("groupEventsByDate groups by start date, drops dateless events", () => {
  const evs = [
    { _id: "a", title: "Ornaments", date: "2026-11-10", startTime: "17:30", endTime: "19:30" },
    { _id: "b", title: "Turkey", date: "2026-11-14", startTime: "11:00" },
    { _id: "c", title: "Tree", date: "2026-11-14", startTime: "18:00" },
    { _id: "d", title: "No date", date: "" },
    { _id: "e", title: "Bad date", date: "soon" },
    { _id: "f", title: "Null date", date: null },
  ];
  const byDate = groupEventsByDate(evs);
  assert.deepEqual(Object.keys(byDate).sort(), ["2026-11-10", "2026-11-14"]);
  assert.equal(byDate["2026-11-10"].length, 1);
  assert.equal(byDate["2026-11-10"][0]._id, "a");
  assert.equal(byDate["2026-11-14"].length, 2);
  /* Multi-day events sit on their start date only — one entry. */
  assert.equal(groupEventsByDate([{ _id: "g", title: "Long", date: "2026-11-20" }])["2026-11-20"].length, 1);
  assert.deepEqual(groupEventsByDate([]), {});
  assert.deepEqual(groupEventsByDate(null), {});
});
