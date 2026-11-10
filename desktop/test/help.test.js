"use strict";
/* Help wiring (no Electron needed): the help page lives in docs/,
   GitHub Pages serves it from main, the tray menu has a Help item
   that opens the live URL, and the Settings window's General tab
   has an "Open help" button that opens the same URL. The URL must
   be the live Pages URL (returned by the Pages API when the site
   was enabled), never a guessed or placeholder one. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const REPO = path.resolve(DESKTOP, "..");
const RENDERER = path.join(DESKTOP, "renderer");
const read = (p) => fs.readFileSync(p, "utf8");
const mainJs = read(path.join(DESKTOP, "main.js"));
const preloadJs = read(path.join(DESKTOP, "preload.js"));
const rendererJs = read(path.join(RENDERER, "renderer.js"));
const settingsHtml = read(path.join(RENDERER, "settings.html"));
const helpHtml = read(path.join(REPO, "docs", "index.html"));

const HELP_URL = "https://kmberry1989.github.io/sideshow/";

test("help page exists and covers Sideshow v0.1.10", () => {
  assert.ok(helpHtml.includes("Sideshow v0.1.10"), "help page must name the version it documents");
  for (const section of ["Summoning", "Calendar view", "Settings window", "Google Calendar", "Signing in", "Installing"]) {
    assert.ok(helpHtml.includes(section), "help page must cover: " + section);
  }
  assert.ok(!helpHtml.includes("TODO") && !helpHtml.includes("Lorem ipsum"), "help page must have no placeholder content");
});

test("tray menu has a Help item opening the live help URL", () => {
  assert.ok(mainJs.includes('const HELP_URL = "' + HELP_URL + '"'), "main.js must define the live Pages URL");
  assert.ok(mainJs.includes('{ label: "Help", click: () => { shell.openExternal(HELP_URL); } }'),
    "tray menu must have a Help item opening the help URL");
});

test("Settings General tab has an Open help button wired to the same URL", () => {
  assert.ok(settingsHtml.includes('id="helpBtn"'), "settings.html must have a help button");
  assert.ok(rendererJs.includes('window.sideshow.openHelp()'), "renderer must call openHelp on the button");
  assert.ok(preloadJs.includes('openHelp: () => ipcRenderer.invoke("sideshow:open-help")'),
    "preload must expose openHelp");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:open-help"'),
    "main must handle sideshow:open-help");
});
