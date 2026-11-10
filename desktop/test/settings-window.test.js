"use strict";
/* Settings-window test: settings lives in its own window
   (renderer/settings.html), not in the bubble (renderer/index.html),
   and the bubble gets live-preview updates from main.
   The bug this guards: the gear used to swap the bubble itself to
   a settings view, so appearance changes could only be judged by
   flipping back and forth — and the bubble was the settings card.
   Static checks (no Electron needed): the form exists exactly once,
   in settings.html; main opens it as a separate framed window,
   shows the bubble as a preview, restores the bubble's visibility
   on close, and broadcasts appearance changes to the bubble; the
   renderer routes the gear / Esc / X through the new IPC. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const RENDERER = path.join(DESKTOP, "renderer");
const read = (p) => fs.readFileSync(p, "utf8");
const indexHtml = read(path.join(RENDERER, "index.html"));
const settingsHtml = read(path.join(RENDERER, "settings.html"));
const mainJs = read(path.join(DESKTOP, "main.js"));
const preloadJs = read(path.join(DESKTOP, "preload.js"));
const rendererJs = read(path.join(RENDERER, "renderer.js"));

/* Every control the settings form is supposed to have. */
const SETTINGS_IDS = [
  "settingsView", "settingsCloseBtn", "settingsTabs", "settingsStatus",
  "tab-position", "tab-appearance", "tab-text", "tab-summon", "tab-general", "tab-events",
  "positionBtn", "appearanceBtns", "appearanceGlassBtn", "appearanceShadedBtn",
  "appearanceClearBtn", "transparencySlider", "scaleSlider", "scaleValue",
  "fontBtn", "weightBtn", "borderSwatches", "borderColorInput",
  "shadowBtn", "shadowStrengthSlider", "shadowStrengthValue",
  "bgSwatches", "bgColorInput", "cornerStyleBtn", "cornerRadiusSlider",
  "cornerRadiusValue", "alignBtn", "pulseBtn", "scrollbarBtn",
  "iconSwatches", "iconColorInput", "separationBtn", "textColorSwatches",
  "textColorInput", "fieldOutline", "hotkeyBtn", "doubletapBtn",
  "gestureBtn", "gestureClearBtn", "longclickBtn", "longclickClearBtn",
  "authLabel", "signInBtn", "signOutBtn", "soundBtn", "motionBtn",
  "remindersBtn", "reminderLeadRow", "reminderLeadBtn", "accentSwatches", "calendarToggleBtn", "calendarPicker",
  "calendarPickerStatus", "calendarList", "eventsList",
];

test("settings form lives in settings.html, not in the bubble", () => {
  assert.ok(fs.existsSync(path.join(RENDERER, "settings.html")), "renderer/settings.html missing");
  for (const id of SETTINGS_IDS) {
    assert.ok(settingsHtml.includes('id="' + id + '"'), "settings.html is missing #" + id);
    assert.ok(!indexHtml.includes('id="' + id + '"'), "index.html still contains #" + id);
  }
  assert.ok(!settingsHtml.includes('id="bubbleView"'), "settings.html must not contain the bubble");
  assert.ok(!settingsHtml.includes('id="settingsBackBtn"'), "no back button in a standalone window");
  assert.ok(settingsHtml.includes("<title>Sideshow Settings</title>"), "settings window title");
  assert.ok(settingsHtml.includes('src="bundle.js"'), "settings.html loads the shared bundle");
  assert.ok(settingsHtml.includes('href="styles.css"'), "settings.html loads the shared styles");
});

test("bubble keeps the gear and the search bar, and nothing else", () => {
  assert.ok(indexHtml.includes('id="bubbleView"'), "bubble view missing from index.html");
  assert.ok(indexHtml.includes('id="settingsBtn"'), "gear missing from the bubble header");
  assert.ok(indexHtml.includes('id="searchInput"'), "search bar missing from the bubble header");
  assert.ok(indexHtml.includes('id="closeBtn"'), "close button missing from the bubble header");
  assert.ok(!indexHtml.includes("settingsView"), "index.html still mentions the settings view");
});

test("main opens settings as a separate framed window with preview + restore", () => {
  assert.ok(mainJs.includes("function openSettingsWindow()"), "openSettingsWindow missing");
  assert.ok(mainJs.includes("function closeSettingsWindow()"), "closeSettingsWindow missing");
  assert.ok(mainJs.includes('"renderer", "settings.html"'), "settings window must load settings.html");
  assert.ok(mainJs.includes('title: "Sideshow Settings"'), "settings window title");
  assert.ok(mainJs.includes("frame: true"), "settings window must be framed");
  assert.ok(mainJs.includes("transparent: false"), "settings window must be opaque");
  assert.ok(mainJs.includes("alwaysOnTop: false"), "settings window must not be always-on-top");
  assert.ok(mainJs.includes("settingsWindow.focus()"), "opening settings twice must focus, not duplicate");
  assert.ok(mainJs.includes("panelVisibleBeforeSettings"), "bubble visibility must be remembered at open");
  assert.ok(mainJs.includes("if (!panelVisibleBeforeSettings) hidePanel();"), "closing settings must restore the bubble's visibility");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:open-settings"'), "open-settings IPC missing");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:close-settings"'), "close-settings IPC missing");
});

test("main broadcasts appearance changes to the bubble for live preview", () => {
  for (const key of ["appearance", "bubble-options", "motion", "accent", "calendar"]) {
    assert.ok(mainJs.includes('broadcastSettingsChange("' + key + '")'), "no broadcast for " + key);
  }
  assert.ok(mainJs.includes('panel.webContents.send("sideshow:settings-changed", key)'), "broadcast must target the panel");
});

test("preload exposes the settings-window API", () => {
  for (const name of ["openSettings", "closeSettings", "onSettingsChanged"]) {
    assert.ok(preloadJs.includes(name + ":"), "preload missing " + name);
  }
  assert.ok(preloadJs.includes('"sideshow:open-settings"'), "open-settings channel missing");
  assert.ok(preloadJs.includes('"sideshow:close-settings"'), "close-settings channel missing");
  assert.ok(preloadJs.includes('"sideshow:settings-changed"'), "settings-changed channel missing");
});

test("renderer routes gear / Esc / X to the settings window and listens for preview updates", () => {
  assert.ok(rendererJs.includes("IS_SETTINGS_WINDOW"), "window-mode detection missing");
  assert.ok(rendererJs.includes("window.sideshow.openSettings()"), "gear must open the settings window");
  assert.ok(!rendererJs.includes("showSettingsView"), "in-bubble settings view must be gone");
  assert.ok(!rendererJs.includes("showBubbleView"), "in-bubble settings view must be gone");
  assert.ok(rendererJs.includes('if (IS_SETTINGS_WINDOW) { window.sideshow.closeSettings(); return; }'), "Esc must close the settings window");
  assert.ok(rendererJs.includes("window.sideshow.closeSettings()"), "settings X must close the settings window");
  assert.ok(rendererJs.includes('window.sideshow.onSettingsChanged(async (key) => {'), "live-preview listener missing");
  for (const key of ['"appearance"', '"bubble-options"', '"motion"', '"accent"', '"calendar"']) {
    assert.ok(rendererJs.includes("key === " + key), "preview listener must handle " + key);
  }
});

test("settings.html ships in the packaged app", () => {
  const pkg = JSON.parse(read(path.join(DESKTOP, "package.json")));
  const files = (pkg.build && pkg.build.files) || [];
  assert.ok(files.indexOf("renderer/**/*") >= 0, "renderer/**/* must stay in build.files");
});
