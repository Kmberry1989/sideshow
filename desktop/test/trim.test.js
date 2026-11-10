"use strict";
/* Unit tests for scripts/prune-locales.js: the package-size trim keeps only
   en-US English and drops every other Chromium locale, on both layouts
   (win32/linux locales/*.pak, darwin *.lproj dirs). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { pruneLocales } = require("../scripts/prune-locales");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sideshow-trim-"));
}

test("win32/linux layout: keeps en-US.pak, removes the rest", () => {
  const root = tmp();
  const locales = path.join(root, "locales");
  fs.mkdirSync(locales);
  for (const name of ["en-US.pak", "de.pak", "fr.pak", "ja.pak"]) {
    fs.writeFileSync(path.join(locales, name), "x".repeat(10));
  }
  const result = pruneLocales(root, "win32");
  assert.equal(result.kept, "en-US.pak");
  assert.equal(result.removed.length, 3);
  assert.equal(result.removedBytes, 30);
  assert.deepEqual(fs.readdirSync(locales), ["en-US.pak"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("darwin layout: keeps en.lproj, removes the rest", () => {
  const root = tmp();
  const resources = path.join(
    root, "Sideshow.app", "Contents", "Frameworks",
    "Electron Framework.framework", "Versions", "A", "Resources",
  );
  fs.mkdirSync(resources, { recursive: true });
  for (const name of ["en.lproj", "de.lproj", "fr.lproj"]) {
    fs.mkdirSync(path.join(resources, name));
    fs.writeFileSync(path.join(resources, name, "locale.pak"), "x".repeat(10));
  }
  const result = pruneLocales(root, "darwin");
  assert.equal(result.kept, "en.lproj");
  assert.equal(result.removed.length, 2);
  assert.equal(result.removedBytes, 20);
  assert.deepEqual(fs.readdirSync(resources), ["en.lproj"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("missing locales dir is a no-op, not an error", () => {
  const root = tmp();
  const result = pruneLocales(root, "linux");
  assert.equal(result.removed.length, 0);
  assert.equal(result.removedBytes, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
