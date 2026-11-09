"use strict";
/* Packaging test: every local module main.js / preload.js requires must be
   covered by the electron-builder "files" list in package.json.
   The bug: the list named main.js + preload.js explicitly, so when
   position.js, bubble-options.js, gesture.js, doubletap.js and longclick.js
   were added as top-level modules, the Windows installer (electron-builder
   --win --dir + makensis) shipped an app.asar without them and the app
   crashed on launch with "Cannot find module './position.js'". The
   portable zips (electron-packager) copy the whole directory, so they
   were never affected — only the installer. A "*.js" glob covers current
   and future top-level modules. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf-8"));
const patterns = (pkg.build && pkg.build.files) || [];

function expandPattern(pattern) {
  if (pattern.endsWith("/**/*")) {
    const dir = path.join(DESKTOP, pattern.slice(0, -"/**/*".length));
    const out = [];
    (function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else out.push(path.relative(DESKTOP, p));
      }
    })(dir);
    return out;
  }
  if (pattern === "*.js") {
    return fs.readdirSync(DESKTOP)
      .filter((f) => f.endsWith(".js") && fs.statSync(path.join(DESKTOP, f)).isFile());
  }
  return [pattern];
}

function coveredFiles() {
  const set = new Set();
  for (const pattern of patterns) {
    for (const f of expandPattern(pattern)) set.add(f);
  }
  return set;
}

function localRequires(entryFile) {
  const src = fs.readFileSync(path.join(DESKTOP, entryFile), "utf-8");
  const found = new Set();
  for (const m of src.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
    let rel = path.normalize(path.join(path.dirname(entryFile), m[1]));
    if (!rel.endsWith(".js")) rel += ".js";
    found.add(rel);
  }
  return found;
}

test("electron-builder files list covers every module main.js requires", () => {
  const covered = coveredFiles();
  const required = localRequires("main.js");
  assert.ok(required.size > 0, "expected main.js to require local modules");
  for (const mod of required) {
    assert.ok(covered.has(mod), `main.js requires ./${mod} but the build.files list does not ship it`);
  }
});

test("electron-builder files list covers every module preload.js requires", () => {
  const covered = coveredFiles();
  for (const mod of localRequires("preload.js")) {
    assert.ok(covered.has(mod), `preload.js requires ./${mod} but the build.files list does not ship it`);
  }
});

test("main.js and preload.js themselves are shipped", () => {
  const covered = coveredFiles();
  assert.ok(covered.has("main.js"), "main.js not in build.files");
  assert.ok(covered.has("preload.js"), "preload.js not in build.files");
});
