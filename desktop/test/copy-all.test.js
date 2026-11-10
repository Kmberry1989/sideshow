"use strict";
/* Copy all: every field the event has, in value-bubble order, one
   per line — labeled (default) or plain. Pure function, no
   Electron. Empty fields are skipped in both formats, exactly like
   the value bubbles; the description goes last. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { copyAllText, COPY_ALL_FORMATS, COPY_ALL_FORMAT_LABELS } = require("../renderer/fields.js");

const DESKTOP = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const rendererJs = read(path.join(DESKTOP, "renderer", "renderer.js"));

const FULL = {
  title: "Christmas Ornaments",
  date: "2026-11-10",
  startTime: "17:30",
  endTime: "19:30",
  price: "$25",
  ages: "All ages",
  host: "Rochelle",
  location: "Fired Arts Studio",
  description: "Paint a ceramic ornament.",
};

test("labeled format: one labeled line per field, description last", () => {
  const text = copyAllText(FULL, "labeled");
  assert.equal(text, [
    "Name: Christmas Ornaments",
    "Date: Tuesday, November 10, 2026",
    "Time: 5:30 PM – 7:30 PM",
    "Price: $25",
    "Ages: All ages",
    "Host: Rochelle",
    "Location: Fired Arts Studio",
    "Description: Paint a ceramic ornament.",
  ].join("\n"));
});

test("plain format: values only, same order, one per line", () => {
  const text = copyAllText(FULL, "plain");
  assert.equal(text, [
    "Christmas Ornaments",
    "Tuesday, November 10, 2026",
    "5:30 PM – 7:30 PM",
    "$25",
    "All ages",
    "Rochelle",
    "Fired Arts Studio",
    "Paint a ceramic ornament.",
  ].join("\n"));
});

test("empty fields are skipped in both formats", () => {
  const sparse = { title: "Turkey Handprint", date: "2026-11-14", startTime: "11:00", price: "", ages: "", host: "", location: "" };
  assert.equal(copyAllText(sparse, "labeled"), [
    "Name: Turkey Handprint",
    "Date: Saturday, November 14, 2026",
    "Time: 11:00 AM",
  ].join("\n"));
  assert.equal(copyAllText(sparse, "plain"), [
    "Turkey Handprint",
    "Saturday, November 14, 2026",
    "11:00 AM",
  ].join("\n"));
});

test("dateless events have no Date line; no description means no Description line", () => {
  const ev = { title: "No date yet", date: "", startTime: "", description: "" };
  assert.equal(copyAllText(ev, "labeled"), "Name: No date yet");
  assert.equal(copyAllText(ev, "plain"), "No date yet");
  assert.equal(copyAllText(null, "labeled"), "");
  assert.equal(copyAllText({}, "plain"), "");
});

test("formats list and labels", () => {
  assert.deepEqual(COPY_ALL_FORMATS, ["labeled", "plain"]);
  assert.equal(COPY_ALL_FORMAT_LABELS.labeled, "Labeled");
  assert.equal(COPY_ALL_FORMAT_LABELS.plain, "Plain");
});

test("Copy all row lives at the end of the expanded event, key C copies it", () => {
  assert.ok(rendererJs.includes('copy-all-bubble'), "renderer must render a copy-all row");
  assert.ok(rendererJs.includes('copyAllText(ev, copyAllFormat)'), "Copy all must use the format setting");
  assert.ok(rendererJs.includes('const COPY_ALL_KEY = "c"'), "C must be the copy-all key");
  assert.ok(rendererJs.includes('key === COPY_ALL_KEY'), "single-key handler must handle C");
  assert.ok(rendererJs.includes("Copy all"), "row must be labeled Copy all");
});
