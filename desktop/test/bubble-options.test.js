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
  assert.equal(d.fieldStyles.n.bold, false);
  assert.equal(d.fieldStyles.n.color, "#a44a24");
  assert.equal(d.fieldStyles.z, undefined);
});

test("valid values survive normalization", () => {
  const d = bo.normalizeBubbleOptions({
    scale: 80, font: "serif", weight: "bold",
    borderColor: "#4a6fa5", shadowOn: false, shadowStrength: 75,
    bgColor: "#2b2118", cornerStyle: "jagged", cornerRadius: 0,
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
  assert.equal(d.cornerStyle, "jagged");
  assert.equal(d.cornerRadius, 0);
  assert.equal(d.align, "center");
  assert.equal(d.pulse, false);
  assert.equal(d.textColor, "#c9962e");
  assert.equal(d.fieldStyles.d.italic, true);
  assert.equal(d.fieldStyles.p.underline, true);
  assert.equal(d.fieldStyles.p.bold, true);
  // Untouched fields keep their defaults.
  assert.equal(d.fieldStyles.n.bold, true);
  assert.equal(d.fieldStyles.t.bold, false);
});

test("hexToRgb and rgba", () => {
  assert.deepEqual(bo.hexToRgb("#a44a24"), { r: 164, g: 74, b: 36 });
  assert.deepEqual(bo.hexToRgb("#fff"), { r: 255, g: 255, b: 255 });
  assert.equal(bo.hexToRgb("red"), null);
  assert.equal(bo.rgba("#2b2118", 0.5), "rgba(43, 33, 24, 0.5)");
  assert.equal(bo.rgba("nope", 0.5), null);
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
