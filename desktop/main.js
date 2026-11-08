"use strict";
/* Sideshow — desktop main process.
   Tray / menu-bar app. No window on launch. A global hotkey toggles a
   small always-on-top panel that shows the saved Main Eventer events.
   Sign-in is Google OAuth in the system browser with a localhost
   redirect (the desktop-app flow). No secrets are printed or logged. */

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, clipboard, safeStorage, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

const HOTKEY = "CommandOrControl+Shift+E";
const OAUTH_PORT = 53682;
const TOKEN_FILE = "sideshow-token.json";

let tray = null;
let panel = null;
let config = null;
let oauthServer = null;
let oauthState = null;
let oauthVerifier = null;

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
  panel.on("blur", () => { if (panel && panel.isVisible()) panel.hide(); });
  panel.on("closed", () => { panel = null; });
}

function togglePanel() {
  if (!panel) return;
  if (panel.isVisible()) { panel.hide(); return; }
  const cursor = require("electron").screen.getCursorScreenPoint();
  const display = require("electron").screen.getDisplayNearestPoint(cursor);
  const bounds = display.workArea;
  const x = Math.round(bounds.x + (bounds.width - 400) / 2);
  const y = Math.round(bounds.y + Math.max(0, (bounds.height - 560) / 2 - 40));
  panel.setPosition(x, y);
  panel.show();
  panel.focus();
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

ipcMain.handle("sideshow:hide", () => { if (panel) panel.hide(); return true; });

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

/* ---------- app lifecycle ---------- */

app.whenReady().then(() => {
  config = loadConfig();
  createPanel();
  createTray();
  globalShortcut.register(HOTKEY, togglePanel);
  if (process.platform === "darwin") app.dock.hide();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopOAuthServer();
});

app.on("window-all-closed", (e) => { e.preventDefault(); });
