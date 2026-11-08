"use strict";
/* Node tests for the shared field formatting. No fake data — the tests
   use the same record shape Main Eventer saves. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDateVal, parseTimeVal, fmtTime, fmtDateLong, eventChips, eventTitle, eventSubtitle, eventMatches } = require("../renderer/fields.js");

const full = {
  title: "Santa's Little Wheel Potters",
  date: "2026-11-21",
  startTime: "10:00",
  endTime: "11:30",
  price: "$55",
  ages: "6-10",
  host: "Rochelle",
  location: "111 W Sycamore St, Kokomo",
};

test("date and time formatting", () => {
  const d = parseDateVal("2026-11-21");
  assert.equal(fmtDateLong(d), "Saturday, November 21, 2026");
  assert.equal(fmtTime(parseTimeVal("10:00")), "10:00 AM");
  assert.equal(fmtTime(parseTimeVal("11:30")), "11:30 AM");
  assert.equal(fmtTime(parseTimeVal("00:00")), "12:00 AM");
  assert.equal(fmtTime(parseTimeVal("12:00")), "12:00 PM");
  assert.equal(parseDateVal(""), null);
  assert.equal(parseTimeVal(""), null);
});

test("eventChips returns one chip per non-empty field, in order", () => {
  const chips = eventChips(full);
  assert.deepEqual(chips.map((c) => c.label), ["Name", "Date", "Start", "End", "Price", "Ages", "Host", "Location"]);
  assert.equal(chips[0].value, "Santa's Little Wheel Potters");
  assert.equal(chips[1].value, "Saturday, November 21, 2026");
  assert.equal(chips[2].value, "10:00 AM");
  assert.equal(chips[3].value, "11:30 AM");
});

test("eventChips omits blank fields cleanly", () => {
  const chips = eventChips({ title: "X", date: "", startTime: "", endTime: "", price: "", ages: "", host: "", location: "" });
  assert.deepEqual(chips.map((c) => c.label), ["Name"]);
  const empty = eventChips({});
  assert.deepEqual(empty, []);
});

test("eventTitle and eventSubtitle", () => {
  assert.equal(eventTitle(full), "Santa's Little Wheel Potters");
  assert.equal(eventTitle({}), "Untitled");
  assert.equal(eventSubtitle(full), "Sat, Nov 21 · 10:00 AM");
  assert.equal(eventSubtitle({}), "");
});

test("eventMatches filters by title, host, or location", () => {
  assert.equal(eventMatches(full, "wheel"), true);
  assert.equal(eventMatches(full, "Rochelle"), true);
  assert.equal(eventMatches(full, "Kokomo"), true);
  assert.equal(eventMatches(full, "turkey"), false);
  assert.equal(eventMatches(full, ""), true);
});
