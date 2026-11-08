"use strict";
/* Sideshow — desktop main process.
   Tray / menu-bar app. No window on launch. A global hotkey toggles a
   small always-on-top panel that shows the saved Main Eventer events.
   Sign-in is Google OAuth in the system browser with a localhost
   redirect (the desktop-app flow). No secrets are printed or logged. */

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, clipboard, safeStorage, nativeImage, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

const DEFAULT_HOTKEY = "CommandOrControl+Shift+E";
const OAUTH_PORT = 53682;
const TOKEN_FILE = "sideshow-token.json";
const SETTINGS_FILE = "sideshow-settings.json";

let tray = null;
let panel = null;
let config = null;
let oauthServer = null;
let oauthState = null;
let oauthVerifier = null;
let settings = {};
let currentHotkey = DEFAULT_HOTKEY;
/* Effective motion for the panel fade ("full" | "reduced" | "off").
   The renderer computes it from the user's motion setting plus the
   OS reduced-motion preference and tells main via IPC. Defaults to
   full; a missing or late value never blocks showing the panel. */
let effectiveMotion = "full";

/* Gesture summon (global mouse hook). Loaded lazily so a missing
   native module never breaks the app — the hotkey still works. */
let gesture = null;
try {
  gesture = require("./gesture.js");
} catch (e) {
  gesture = null;
}

/* ---------- settings (hotkey + gesture), stored in userData ---------- */

function settingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (e) { /* no settings yet */ }
  return {};
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings), "utf8");
  } catch (e) { /* settings not persisted */ }
}

/* ---------- hotkey ---------- */

/* An Electron accelerator needs at least one modifier plus one key. */
function isValidAccelerator(acc) {
  if (typeof acc !== "string" || !acc) return false;
  const mods = ["CommandOrControl", "CmdOrCtrl", "Command", "Cmd", "Control", "Ctrl", "Alt", "Option", "Shift", "Super", "Meta"];
  const parts = acc.split("+");
  const hasMod = parts.some((p) => mods.indexOf(p) >= 0);
  const keys = parts.filter((p) => mods.indexOf(p) < 0);
  return hasMod && keys.length === 1 && keys[0].length > 0;
}

/* Register a new hotkey, keeping the old one if the new one fails
   (invalid, or already taken by the system/another app). */
function registerHotkey(acc) {
  if (!isValidAccelerator(acc)) return false;
  globalShortcut.unregister(currentHotkey);
  const ok = globalShortcut.register(acc, togglePanel);
  if (!ok) {
    globalShortcut.register(currentHotkey, togglePanel);
    return false;
  }
  currentHotkey = acc;
  return true;
}

function applyGesture() {
  if (!gesture || !gesture.available) return;
  gesture.setGesture(settings.gesture || null, togglePanel);
}

function configPaths() {
  return [
    path.join(app.getPath("userData"), "firebase-config.json"),
    path.join(__dirname, "firebase-config.json"),
  ];
}

function loadConfig() {
  for (const p of configPaths()) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.firebase && parsed.firebase.projectId) return parsed;
    } catch (e) { /* missing or unreadable; try next */ }
  }
  return null;
}

function configStatus() {
  const fb = config && config.firebase;
  const hasFirebase = !!(fb && fb.apiKey && fb.authDomain && fb.projectId && fb.appId);
  const oa = config && config.googleOAuth;
  const hasOAuth = !!(oa && oa.clientId && oa.clientSecret);
  return { hasConfig: hasFirebase, hasOAuth };
}

function tokenPath() {
  return path.join(app.getPath("userData"), TOKEN_FILE);
}

function storeRefreshToken(refreshToken) {
  try {
    let value = refreshToken;
    if (safeStorage.isEncryptionAvailable()) {
      value = safeStorage.encryptString(refreshToken).toString("base64");
    }
    fs.writeFileSync(tokenPath(), JSON.stringify({ v: 1, enc: safeStorage.isEncryptionAvailable(), token: value }), "utf8");
  } catch (e) { /* token not persisted; sign-in stays session-only */ }
}

function readRefreshToken() {
  try {
    const data = JSON.parse(fs.readFileSync(tokenPath(), "utf8"));
    if (!data || !data.token) return null;
    if (data.enc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(data.token, "base64"));
    }
    return data.token;
  } catch (e) { return null; }
}

function clearRefreshToken() {
  try { fs.unlinkSync(tokenPath()); } catch (e) { /* already gone */ }
}

function createPanel() {
  panel = new BrowserWindow({
    width: 400,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#faf6f1",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  panel.loadFile(path.join(__dirname, "renderer", "index.html"));
  panel.on("blur", () => { if (panel && panel.isVisible()) hidePanel(); });
  panel.on("closed", () => { panel = null; });
}

function togglePanel() {
  if (!panel) return;
  if (panel.isVisible()) { hidePanel(); return; }
  showPanel();
}

/* Smooth open/close: fade the window in/out instead of an instant
   appear/disappear. The renderer plays a soft sound on the
   panel-showing / panel-hiding messages. Fade length follows the
   effective motion setting: full ~150ms, reduced ~50ms, off instant. */
let fadeTimer = null;

/* Fade duration in ms for the panel open/close, from the effective
   motion. "off" (0) means show/hide instantly. */
function fadeDurationMs() {
  if (effectiveMotion === "off") return 0;
  if (effectiveMotion === "reduced") return 50;
  return 150;
}

function setPanelOpacity(v) {
  try { if (panel) panel.setOpacity(v); } catch (e) { /* opacity unsupported */ }
}

/* Position the panel next to the cursor: just below-right by a small
   offset so it does not cover the pointer. If the cursor is near the
   right or bottom edge, flip to the left / above instead; clamp to
   the work area so the whole panel stays on-screen. Still uses the
   cursor's display, so it appears on the right monitor. */
const PANEL_W = 400;
const PANEL_H = 560;
const CURSOR_GAP = 16;

function panelPositionNearCursor(cursor, bounds) {
  let x = cursor.x + CURSOR_GAP;
  let y = cursor.y + CURSOR_GAP;
  if (x + PANEL_W > bounds.x + bounds.width) x = cursor.x - CURSOR_GAP - PANEL_W;
  if (y + PANEL_H > bounds.y + bounds.height) y = cursor.y - CURSOR_GAP - PANEL_H;
  x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - PANEL_W));
  y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - PANEL_H));
  return { x: Math.round(x), y: Math.round(y) };
}

function showPanel() {
  if (!panel) return;
  const cursor = require("electron").screen.getCursorScreenPoint();
  const display = require("electron").screen.getDisplayNearestPoint(cursor);
  const bounds = display.workArea;
  const pos = panelPositionNearCursor(cursor, bounds);
  panel.setPosition(pos.x, pos.y);
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  const dur = fadeDurationMs();
  if (dur <= 0) {
    setPanelOpacity(1);
    panel.show();
    panel.focus();
    panel.webContents.send("sideshow:panel-showing");
    return;
  }
  setPanelOpacity(0);
  panel.show();
  panel.focus();
  panel.webContents.send("sideshow:panel-showing");
  let o = 0;
  const step = 30 / dur;
  fadeTimer = setInterval(() => {
    o += step;
    if (o >= 1) {
      setPanelOpacity(1);
      clearInterval(fadeTimer);
      fadeTimer = null;
    } else {
      setPanelOpacity(o);
    }
  }, 30);
}

function hidePanel() {
  if (!panel || !panel.isVisible()) return;
  panel.webContents.send("sideshow:panel-hiding");
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  const dur = fadeDurationMs();
  if (dur <= 0) {
    setPanelOpacity(1);
    if (panel) panel.hide();
    return;
  }
  let o = 1;
  const step = 30 / dur;
  fadeTimer = setInterval(() => {
    o -= step;
    if (o <= 0) {
      clearInterval(fadeTimer);
      fadeTimer = null;
      setPanelOpacity(1);
      if (panel) panel.hide();
    } else {
      setPanelOpacity(o);
    }
  }, 30);
}

function createTray() {
  const iconPath = path.join(__dirname, "assets", "icon.png");
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Sideshow");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Sideshow", click: togglePanel },
    { label: "Sign in", click: () => { togglePanel(); startSignIn(); } },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
  tray.on("click", togglePanel);
}

/* ---------- reminders + badge (optional; never blocks the core) ----------

   The renderer sends the saved events (id, name, date YYYY-MM-DD,
   startTime HH:MM) whenever the list changes. Main schedules two
   reminders per event (1 day and 1 hour before start), shows a system
   notification for each, and keeps a badge count of upcoming events.
   Reminders are on by default and can be turned off in settings.
   The badge does not require reminders and reminders do not require
   the badge. If notifications are denied by the OS, reminders are
   skipped silently — the panel still works. */

const REMINDER_FILE = "sideshow-reminders.json";
const REMINDER_LEADS = [
  { lead: "1d", ms: 24 * 60 * 60 * 1000, label: "tomorrow" },
  { lead: "1h", ms: 60 * 60 * 1000, label: "in an hour" },
];
let reminderTimers = [];
let firedReminders = null; /* Set of keys, persisted in userData. */

function remindersEnabled() {
  return settings.reminders !== false;
}

function reminderStorePath() {
  return path.join(app.getPath("userData"), REMINDER_FILE);
}

function loadFiredReminders() {
  if (firedReminders) return firedReminders;
  try {
    const raw = fs.readFileSync(reminderStorePath(), "utf8");
    const arr = JSON.parse(raw);
    firedReminders = new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    firedReminders = new Set();
  }
  return firedReminders;
}

function saveFiredReminders() {
  try {
    fs.writeFileSync(reminderStorePath(), JSON.stringify([...loadFiredReminders()]), "utf8");
  } catch (e) { /* fired list not persisted */ }
}

/* Event start as a Date, or null when date/startTime is missing or
   unparsable. Events without both are skipped for reminders. */
function eventStartMs(ev) {
  if (!ev || !ev.date || !ev.startTime) return null;
  const dp = String(ev.date).split("-");
  const tp = String(ev.startTime).split(":");
  if (dp.length !== 3 || tp.length < 2) return null;
  const d = new Date(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1]);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function reminderKey(ev, lead, startMs) {
  const id = ev.id || [ev.title, ev.date, ev.startTime].filter(Boolean).join("|");
  return id + "|" + lead + "|" + startMs;
}

function clearReminderTimers() {
  reminderTimers.forEach((t) => { try { clearTimeout(t); } catch (e) { /* already fired */ } });
  reminderTimers = [];
}

/* Schedule (or reschedule) reminders for the given events. Only future
   reminder times are scheduled; past events and already-fired
   reminders are skipped. A restart never re-fires a reminder. */
function scheduleReminders(events) {
  clearReminderTimers();
  const now = Date.now();
  const fired = loadFiredReminders();
  if (!remindersEnabled() || !Array.isArray(events)) return;
  events.forEach((ev) => {
    const startMs = eventStartMs(ev);
    if (startMs == null || startMs <= now) return;
    REMINDER_LEADS.forEach(({ lead, ms }) => {
      const fireAt = startMs - ms;
      if (fireAt <= now) return;
      const key = reminderKey(ev, lead, startMs);
      if (fired.has(key)) return;
      const delay = fireAt - now;
      if (delay > 2147483647) return; /* setTimeout ceiling (~24.8d) */
      reminderTimers.push(setTimeout(() => fireReminder(ev, lead, startMs, key), delay));
    });
  });
}

function fireReminder(ev, lead, startMs, key) {
  const fired = loadFiredReminders();
  if (fired.has(key)) return;
  fired.add(key);
  saveFiredReminders();
  if (!remindersEnabled()) return;
  showReminderNotification(ev, lead, startMs);
}

function reminderTimeText(startMs) {
  const d = new Date(startMs);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  const m = d.getMinutes();
  return days[d.getDay()] + ", " + months[d.getMonth()] + " " + d.getDate() + ", " + h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
}

function showReminderNotification(ev, lead, startMs) {
  try {
    if (!Notification.isSupported()) return;
    const name = ev.title || "Event";
    const when = reminderTimeText(startMs);
    const note = new Notification({
      title: name,
      body: when,
      silent: settings.sound === false, /* sound off = visual only */
    });
    note.on("click", () => {
      showPanel();
      if (panel) panel.webContents.send("sideshow:open-event", ev.id || null);
    });
    note.show();
  } catch (e) { /* notification failed; panel still works */ }
}

/* Badge: number of upcoming events (today or later, with a date set).
   Shown on the tray icon (all platforms), the Mac dock badge, and the
   Windows taskbar badge where the platform supports it. Cleared at 0. */

let iconB64Cache = null;
function iconBase64() {
  if (iconB64Cache) return iconB64Cache;
  try {
    iconB64Cache = fs.readFileSync(path.join(__dirname, "assets", "icon.png")).toString("base64");
  } catch (e) {
    iconB64Cache = "";
  }
  return iconB64Cache;
}

function updateBadge(count) {
  const n = Math.max(0, count || 0);
  try { app.setBadgeCount(n); } catch (e) { /* dock/taskbar badge unsupported */ }
  if (!tray) return;
  try {
    if (n === 0) {
      tray.setImage(nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png")));
      return;
    }
    const label = n > 99 ? "99+" : String(n);
    const b64 = iconBase64();
    if (!b64) return;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
      + '<image href="data:image/png;base64,' + b64 + '" x="0" y="0" width="32" height="32"/>'
      + '<circle cx="24" cy="8" r="8" fill="#c0392b"/>'
      + '<text x="24" y="11.5" font-size="11" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">' + label + "</text></svg>";
    const img = nativeImage.createFromDataURL("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"));
    if (!img.isEmpty()) tray.setImage(img);
  } catch (e) { /* tray badge failed; dock/taskbar badge still applies */ }
}

function upcomingCount(events) {
  if (!Array.isArray(events)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let n = 0;
  events.forEach((ev) => {
    if (!ev || !ev.date) return;
    const dp = String(ev.date).split("-");
    if (dp.length !== 3) return;
    const d = new Date(+dp[0], +dp[1] - 1, +dp[2]);
    if (!isNaN(d.getTime()) && d.getTime() >= today.getTime()) n++;
  });
  return n;
}

/* ---------- Google OAuth (system browser + localhost redirect) ---------- */

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function startSignIn() {
  const st = configStatus();
  if (!st.hasConfig || !st.hasOAuth) {
    if (panel) panel.webContents.send("sideshow:config-missing", st);
    return;
  }
  if (oauthServer) return;
  oauthState = base64url(crypto.randomBytes(16));
  oauthVerifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(oauthVerifier).digest());
  const params = new URLSearchParams({
    client_id: config.googleOAuth.clientId,
    redirect_uri: "http://127.0.0.1:" + OAUTH_PORT + "/callback",
    response_type: "code",
    scope: "openid email profile",
    state: oauthState,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  oauthServer = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1:" + OAUTH_PORT);
      if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body style=\"font-family:sans-serif;padding:40px\"><h2>Signed in</h2><p>Return to Sideshow.</p></body></html>");
      stopOAuthServer();
      if (error || !code || state !== oauthState) {
        if (panel) panel.webContents.send("sideshow:auth-error");
        return;
      }
      exchangeCode(code);
    } catch (e) {
      stopOAuthServer();
      if (panel) panel.webContents.send("sideshow:auth-error");
    }
  });
  oauthServer.listen(OAUTH_PORT, "127.0.0.1", () => {
    shell.openExternal("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
  });
  oauthServer.on("error", () => {
    stopOAuthServer();
    if (panel) panel.webContents.send("sideshow:auth-error");
  });
}

function stopOAuthServer() {
  if (oauthServer) { try { oauthServer.close(); } catch (e) {} oauthServer = null; }
  oauthState = null;
  oauthVerifier = null;
}

async function postToken(body) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) return null;
  return res.json();
}

async function exchangeCode(code) {
  const data = await postToken({
    client_id: config.googleOAuth.clientId,
    client_secret: config.googleOAuth.clientSecret,
    code,
    code_verifier: oauthVerifier,
    redirect_uri: "http://127.0.0.1:" + OAUTH_PORT + "/callback",
    grant_type: "authorization_code",
  });
  if (!data || !data.id_token) {
    if (panel) panel.webContents.send("sideshow:auth-error");
    return;
  }
  if (data.refresh_token) storeRefreshToken(data.refresh_token);
  if (panel) panel.webContents.send("sideshow:auth-token", { idToken: data.id_token });
}

async function refreshIdToken() {
  const refreshToken = readRefreshToken();
  if (!refreshToken || !configStatus().hasOAuth) return null;
  const data = await postToken({
    client_id: config.googleOAuth.clientId,
    client_secret: config.googleOAuth.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (!data || !data.id_token) { clearRefreshToken(); return null; }
  if (data.refresh_token) storeRefreshToken(data.refresh_token);
  return data.id_token;
}

/* ---------- IPC ---------- */

ipcMain.handle("sideshow:copy", (_e, text) => {
  if (typeof text === "string" && text) clipboard.writeText(text);
  return true;
});

ipcMain.handle("sideshow:hide", () => { hidePanel(); return true; });

ipcMain.handle("sideshow:config-status", () => configStatus());

ipcMain.handle("sideshow:firebase-config", () => {
  const fb = config && config.firebase;
  if (!fb) return null;
  return {
    apiKey: fb.apiKey, authDomain: fb.authDomain, projectId: fb.projectId,
    storageBucket: fb.storageBucket || "", messagingSenderId: fb.messagingSenderId || "", appId: fb.appId,
  };
});

ipcMain.handle("sideshow:sign-in", () => { startSignIn(); return true; });

ipcMain.handle("sideshow:sign-out", () => { clearRefreshToken(); return true; });

ipcMain.handle("sideshow:refresh-token", async () => refreshIdToken());

ipcMain.handle("sideshow:open-config-folder", () => {
  shell.showItemInFolder(configPaths()[0]);
  return true;
});

ipcMain.handle("sideshow:get-hotkey", () => currentHotkey);

ipcMain.handle("sideshow:set-hotkey", (_e, acc) => {
  if (registerHotkey(acc)) {
    settings.hotkey = acc;
    saveSettings();
    return { ok: true, hotkey: currentHotkey };
  }
  return { ok: false, hotkey: currentHotkey };
});

ipcMain.handle("sideshow:reset-hotkey", () => {
  if (registerHotkey(DEFAULT_HOTKEY)) {
    settings.hotkey = DEFAULT_HOTKEY;
    saveSettings();
    return { ok: true, hotkey: currentHotkey };
  }
  return { ok: false, hotkey: currentHotkey };
});

ipcMain.handle("sideshow:get-gesture", () => {
  const g = settings.gesture || null;
  return { gesture: g, label: gesture ? gesture.describe(g) : "None", available: !!(gesture && gesture.available) };
});

ipcMain.handle("sideshow:record-gesture", async () => {
  if (!gesture || !gesture.available) return { ok: false, error: "Gesture unavailable on this system." };
  const result = await gesture.record();
  if (result.gesture) {
    settings.gesture = result.gesture;
    saveSettings();
    applyGesture();
    return { ok: true, gesture: result.gesture, label: gesture.describe(result.gesture) };
  }
  return { ok: false, error: result.error || "Could not record a gesture." };
});

ipcMain.handle("sideshow:clear-gesture", () => {
  settings.gesture = null;
  saveSettings();
  applyGesture();
  return true;
});

ipcMain.handle("sideshow:get-sound", () => settings.sound !== false);

ipcMain.handle("sideshow:set-sound", (_e, enabled) => {
  settings.sound = !!enabled;
  saveSettings();
  return settings.sound;
});

/* Motion: "full" | "reduced" | "off" | null (null = follow the OS).
   The renderer owns the OS preference and sends the effective value
   so the panel fade can follow it too. */
ipcMain.handle("sideshow:get-motion", () => settings.motion || null);

ipcMain.handle("sideshow:set-motion", (_e, value) => {
  const v = ["full", "reduced", "off"].indexOf(value) >= 0 ? value : null;
  settings.motion = v;
  saveSettings();
  return settings.motion;
});

ipcMain.handle("sideshow:motion-effective", (_e, value) => {
  if (["full", "reduced", "off"].indexOf(value) >= 0) effectiveMotion = value;
  return effectiveMotion;
});

/* Reminders on/off. Turning them off clears any pending timers. */
ipcMain.handle("sideshow:get-reminders", () => remindersEnabled());

ipcMain.handle("sideshow:set-reminders", (_e, enabled) => {
  settings.reminders = !!enabled;
  saveSettings();
  if (!settings.reminders) clearReminderTimers();
  return settings.reminders;
});

/* Accent color: a hex string (e.g. "#a44a24") or null for the
   platform default (blue on Mac, green on Windows). */
ipcMain.handle("sideshow:get-accent", () => settings.accent || null);

ipcMain.handle("sideshow:set-accent", (_e, value) => {
  const v = (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) ? value.toLowerCase() : null;
  settings.accent = v;
  saveSettings();
  return settings.accent;
});

/* The renderer sends the saved events whenever the list changes.
   Main updates the badge count and (re)schedules reminders. */
ipcMain.handle("sideshow:events-updated", (_e, list) => {
  try {
    updateBadge(upcomingCount(list));
    scheduleReminders(list);
  } catch (err) { /* badge/reminders never block the panel */ }
  return true;
});

/* ---------- app lifecycle ---------- */

app.whenReady().then(() => {
  config = loadConfig();
  settings = loadSettings();
  if (settings.hotkey && isValidAccelerator(settings.hotkey)) {
    currentHotkey = settings.hotkey;
  }
  createPanel();
  createTray();
  globalShortcut.register(currentHotkey, togglePanel);
  applyGesture();
  if (process.platform === "darwin") app.dock.hide();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (gesture) gesture.stop();
  stopOAuthServer();
});

app.on("window-all-closed", (e) => { e.preventDefault(); });
