"use strict";
/* Node tests for the Google Calendar mapping + merge. Pure functions —
   no network, no sign-in. Time expectations are computed from the
   local timezone (new Date), so the tests pass in any timezone. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCalendarDescription, calendarEventToRecord, mergeEvents } = require("../renderer/calendar.js");

function pad(n) { return (n < 10 ? "0" : "") + n; }
function localParts(iso) {
  const d = new Date(iso);
  return {
    date: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()),
    time: pad(d.getHours()) + ":" + pad(d.getMinutes()),
  };
}

const ME_DESC = [
  "Wheel throwing for beginners.",
  "Host: Rochelle",
  "Price: $55",
  "Ages: 6-10",
  "111 W Sycamore St, Kokomo",
  "Details & registration: https://example.com/event/123",
].join("\n");

test("parseCalendarDescription extracts Host/Price/Ages/link, keeps free text", () => {
  const out = parseCalendarDescription(ME_DESC);
  assert.equal(out.host, "Rochelle");
  assert.equal(out.price, "$55");
  assert.equal(out.ages, "6-10");
  assert.equal(out.link, "https://example.com/event/123");
  assert.equal(out.description, "Wheel throwing for beginners.\n111 W Sycamore St, Kokomo");
});

test("parseCalendarDescription with plain text invents nothing", () => {
  const out = parseCalendarDescription("Team lunch.\nBring a dish.");
  assert.equal(out.host, "");
  assert.equal(out.price, "");
  assert.equal(out.ages, "");
  assert.equal(out.link, "");
  assert.equal(out.description, "Team lunch.\nBring a dish.");
  assert.deepEqual(parseCalendarDescription(""), { description: "", host: "", price: "", ages: "", link: "" });
  assert.deepEqual(parseCalendarDescription(null), { description: "", host: "", price: "", ages: "", link: "" });
});

test("parseCalendarDescription ignores lookalike lines", () => {
  const out = parseCalendarDescription("Hosted by: Sam\nPrice is $5\nAges 6+ welcome");
  assert.equal(out.host, "");
  assert.equal(out.price, "");
  assert.equal(out.ages, "");
});

test("calendarEventToRecord maps a timed event in local time", () => {
  const start = localParts("2026-11-21T10:00:00-05:00");
  const end = localParts("2026-11-21T11:30:00-05:00");
  const rec = calendarEventToRecord({
    id: "abc123",
    summary: "Santa's Little Wheel Potters",
    start: { dateTime: "2026-11-21T10:00:00-05:00" },
    end: { dateTime: "2026-11-21T11:30:00-05:00" },
    location: "111 W Sycamore St, Kokomo",
    description: ME_DESC,
  }, "primary");
  assert.equal(rec.title, "Santa's Little Wheel Potters");
  assert.equal(rec.date, start.date);
  assert.equal(rec.startTime, start.time);
  assert.equal(rec.endTime, end.time);
  assert.equal(rec.price, "$55");
  assert.equal(rec.ages, "6-10");
  assert.equal(rec.host, "Rochelle");
  assert.equal(rec.location, "111 W Sycamore St, Kokomo");
  assert.equal(rec.link, "https://example.com/event/123");
  assert.equal(rec.source, "gcal");
  assert.equal(rec.gcalId, "abc123");
  assert.equal(rec.calendarId, "primary");
  assert.equal(rec.id, "gcal:primary:abc123");
  assert.equal(rec._id, "gcal:primary:abc123");
});

test("calendarEventToRecord maps an all-day event with no times", () => {
  const rec = calendarEventToRecord({
    id: "allday1",
    summary: "Studio closed",
    start: { date: "2026-11-22" },
    end: { date: "2026-11-23" },
    description: "Holiday.",
  }, "primary");
  assert.equal(rec.date, "2026-11-22");
  assert.equal(rec.startTime, "");
  assert.equal(rec.endTime, "");
  assert.equal(rec.title, "Studio closed");
});

test("calendarEventToRecord without Main Eventer lines has no price/ages/host", () => {
  const rec = calendarEventToRecord({
    id: "plain1",
    summary: "Team lunch",
    start: { dateTime: "2026-11-21T12:00:00Z" },
    end: { dateTime: "2026-11-21T13:00:00Z" },
    description: "Bring a dish.",
  }, "work@example.com");
  assert.equal(rec.price, "");
  assert.equal(rec.ages, "");
  assert.equal(rec.host, "");
  assert.equal(rec.link, "");
  assert.equal(rec.description, "Bring a dish.");
  assert.equal(rec.id, "gcal:work@example.com:plain1");
});

test("mergeEvents dedups in favour of the Main Eventer record", () => {
  const me = [{
    _id: "doc1", title: "Santa's Little Wheel Potters", date: "2026-11-21",
    startTime: "10:00", price: "$55", host: "Rochelle",
  }];
  const cal = [{
    _id: "gcal:primary:abc", title: "  santa's little wheel potters ", date: "2026-11-21",
    startTime: "10:00", price: "", host: "",
  }];
  const merged = mergeEvents(me, cal);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]._id, "doc1"); /* Main Eventer record wins */
  assert.equal(merged[0].price, "$55");
});

test("mergeEvents keeps non-matching calendar events, Main Eventer first, calendar sorted", () => {
  const me = [
    { _id: "doc1", title: "B Event", date: "2026-11-21", startTime: "10:00" },
    { _id: "doc2", title: "A Event", date: "2026-11-20", startTime: "09:00" },
  ];
  const cal = [
    { _id: "gcal:p:x", title: "Later", date: "2026-11-22", startTime: "08:00" },
    { _id: "gcal:p:y", title: "Earlier", date: "2026-11-19", startTime: "18:00" },
    { _id: "gcal:p:z", title: "Same Day Later", date: "2026-11-21", startTime: "15:00" },
  ];
  const merged = mergeEvents(me, cal);
  assert.deepEqual(merged.map((e) => e._id), ["doc1", "doc2", "gcal:p:y", "gcal:p:z", "gcal:p:x"]);
});

test("mergeEvents does not match on title alone — date/time must match", () => {
  const me = [{ _id: "doc1", title: "Yoga", date: "2026-11-21", startTime: "10:00" }];
  const cal = [{ _id: "gcal:p:a", title: "Yoga", date: "2026-11-22", startTime: "10:00" }];
  assert.equal(mergeEvents(me, cal).length, 2);
  assert.equal(mergeEvents([], []).length, 0);
  assert.equal(mergeEvents(me, null).length, 1);
});
