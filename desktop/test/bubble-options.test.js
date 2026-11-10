"use strict";
/* Bubble options: defaults, normalization, readable ink. */
const test = require("node:test");
const assert = require("node:assert/strict");
const bo = require("../bubble-options.js");

test("defaults are the current look", () => {
  const d = bo.normalizeBubbleOptions(null);
  assert.equal(d.scale, 100);
  assert.equal(d.font, "mono");
  assert.equal(d.weight, "regular");
  assert.equal(d.borderColor, null);
  assert.equal(d.shadowOn, true);
  assert.equal(d.shadowStrength, 40);
  assert.equal(d.bgColor, null);
  assert.equal(d.cornerStyle, "smooth");
  assert.equal(d.cornerRadius, 32);
  assert.equal(d.align, "left");
  assert.equal(d.pulse, true);
  assert.equal(d.textColor, null);
  assert.equal(d.scrollbar, "slim");
  assert.equal(d.iconColor, null);
  assert.equal(d.separation, "bullets");
  // Scrollbar color unset = accent (current look); shape Pill (current).
  assert.equal(d.scrollbarColor, null);
  assert.equal(d.scrollbarShape, "pill");
  // Name bold is true (the title is already bold); the rest normal.
  assert.equal(d.fieldStyles.n.bold, true);
  assert.equal(d.fieldStyles.n.italic, false);
  assert.equal(d.fieldStyles.d.bold, false);
  assert.equal(d.fieldStyles.p.underline, false);
  assert.equal(d.fieldStyles.h.color, null);
});

test("normalization clamps and rejects bad values", () => {
  const d = bo.normalizeBubbleOptions({
    scale: 999, font: "comic", weight: "heavy",
    borderColor: "red", shadowOn: "yes", shadowStrength: -5,
    bgColor: "#zzzzzz", cornerStyle: "wavy", cornerRadius: 100,
    align: "top", pulse: "maybe", textColor: "blue",
    fieldStyles: { n: { bold: false, color: "#a44a24" }, z: { bold: true } },
  });
  assert.equal(d.scale, 150);
  assert.equal(d.font, "mono");
  assert.equal(d.weight, "regular");
  assert.equal(d.borderColor, null);
  assert.equal(d.shadowOn, true);
  assert.equal(d.shadowStrength, 0);
  assert.equal(d.bgColor, null);
  assert.equal(d.cornerStyle, "smooth");
  assert.equal(d.cornerRadius, 32);
  assert.equal(d.align, "left");
  assert.equal(d.pulse, true);
  assert.equal(d.textColor, null);
  assert.equal(d.scrollbar, "slim");
  assert.equal(d.iconColor, null);
  assert.equal(d.separation, "bullets");
  assert.equal(d.scrollbarColor, null);
  assert.equal(d.scrollbarShape, "pill");
  assert.equal(d.fieldStyles.n.bold, false);
  assert.equal(d.fieldStyles.n.color, "#a44a24");
  assert.equal(d.fieldStyles.z, undefined);
});

test("valid values survive normalization", () => {
  const d = bo.normalizeBubbleOptions({
    scale: 80, font: "serif", weight: "bold",
    borderColor: "#4a6fa5", shadowOn: false, shadowStrength: 75,
    bgColor: "#2b2118", cornerStyle: "right", cornerRadius: 0,
    align: "center", pulse: false, textColor: "#c9962e",
    fieldStyles: { d: { italic: true }, p: { underline: true, bold: true } },
  });
  assert.equal(d.scale, 80);
  assert.equal(d.font, "serif");
  assert.equal(d.weight, "bold");
  assert.equal(d.borderColor, "#4a6fa5");
  assert.equal(d.shadowOn, false);
  assert.equal(d.shadowStrength, 75);
  assert.equal(d.bgColor, "#2b2118");
  assert.equal(d.cornerStyle, "right");
  assert.equal(d.cornerRadius, 0);
  assert.equal(d.align, "center");
  assert.equal(d.pulse, false);
  assert.equal(d.textColor, "#c9962e");
  assert.equal(d.scrollbar, "slim");
  assert.equal(d.iconColor, null);
  assert.equal(d.separation, "bullets");
  assert.equal(d.fieldStyles.d.italic, true);
  assert.equal(d.fieldStyles.p.underline, true);
  assert.equal(d.fieldStyles.p.bold, true);
  // Untouched fields keep their defaults.
  assert.equal(d.fieldStyles.n.bold, true);
  assert.equal(d.fieldStyles.t.bold, false);
});

test("a saved jagged corner style falls back to Smooth (Jagged was removed)", () => {
  const d = bo.normalizeBubbleOptions({ cornerStyle: "jagged" });
  assert.equal(d.cornerStyle, "smooth");
  assert.deepEqual(bo.CORNER_STYLES, ["smooth", "right"]);
  assert.deepEqual(bo.CORNER_CYCLE, ["smooth", "right"]);
  assert.equal(bo.CORNER_LABELS.smooth, "Smooth");
  assert.equal(bo.CORNER_LABELS.right, "Right angle");
  assert.equal(bo.CORNER_LABELS.jagged, undefined);
});

test("hexToRgb and rgba", () => {
  assert.deepEqual(bo.hexToRgb("#a44a24"), { r: 164, g: 74, b: 36 });
  assert.deepEqual(bo.hexToRgb("#fff"), { r: 255, g: 255, b: 255 });
  assert.equal(bo.hexToRgb("red"), null);
  assert.equal(bo.rgba("#2b2118", 0.5), "rgba(43, 33, 24, 0.5)");
  assert.equal(bo.rgba("nope", 0.5), null);
});

test("scrollbar, icon color and separation survive normalization; bad values fall back", () => {
  const d = bo.normalizeBubbleOptions({
    scrollbar: "standard", iconColor: "#4a6fa5", separation: "lines",
  });
  assert.equal(d.scrollbar, "standard");
  assert.equal(d.iconColor, "#4a6fa5");
  assert.equal(d.separation, "lines");
  const bad = bo.normalizeBubbleOptions({
    scrollbar: "wide", iconColor: "red", separation: "grid",
  });
  assert.equal(bad.scrollbar, "slim");
  assert.equal(bad.iconColor, null);
  assert.equal(bad.separation, "bullets");
  assert.deepEqual(bo.SCROLLBAR_CYCLE, ["slim", "standard"]);
  assert.deepEqual(bo.SEPARATION_CYCLE, ["bullets", "lines", "spacing"]);
  assert.equal(bo.SEPARATION_LABELS.bullets, "Bullets");
});

test("scrollbar color and thumb shape survive normalization; bad values fall back", () => {
  const d = bo.normalizeBubbleOptions({
    scrollbarColor: "#4a6fa5", scrollbarShape: "square",
  });
  assert.equal(d.scrollbarColor, "#4a6fa5");
  assert.equal(d.scrollbarShape, "square");
  const bad = bo.normalizeBubbleOptions({
    scrollbarColor: "red", scrollbarShape: "round",
  });
  assert.equal(bad.scrollbarColor, null); /* unset = accent, the current look */
  assert.equal(bad.scrollbarShape, "pill");
  assert.deepEqual(bo.SCROLLBAR_SHAPE_CYCLE, ["pill", "rounded", "square"]);
  assert.equal(bo.SCROLLBAR_SHAPE_LABELS.pill, "Pill");
  assert.equal(bo.SCROLLBAR_SHAPE_LABELS.rounded, "Rounded");
  assert.equal(bo.SCROLLBAR_SHAPE_LABELS.square, "Square");
  assert.equal(bo.SCROLLBAR_SHAPE_RADIUS.pill, "999px");
  assert.equal(bo.SCROLLBAR_SHAPE_RADIUS.rounded, "6px");
  assert.equal(bo.SCROLLBAR_SHAPE_RADIUS.square, "0");
});

test("readableInkFor keeps text readable on dark and light backgrounds", () => {
  // White / light: dark ink.
  assert.deepEqual(bo.readableInkFor("#ffffff"), { ink: "#2b2118", soft: "#5d4f42" });
  assert.deepEqual(bo.readableInkFor("#e07a45"), { ink: "#2b2118", soft: "#5d4f42" });
  // Dark: light ink.
  assert.deepEqual(bo.readableInkFor("#2b2118"), { ink: "#f2e9df", soft: "#c4b3a1" });
  assert.deepEqual(bo.readableInkFor("#000000"), { ink: "#f2e9df", soft: "#c4b3a1" });
  assert.equal(bo.readableInkFor("not-a-color"), null);
});
