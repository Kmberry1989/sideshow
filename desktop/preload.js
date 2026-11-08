"use strict";
/* Sideshow preload — exposes a minimal API to the panel. The OAuth
   client secret never reaches the renderer; it stays in the main process. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sideshow", {
  copy: (text) => ipcRenderer.invoke("sideshow:copy", text),
  hide: () => ipcRenderer.invoke("sideshow:hide"),
  configStatus: () => ipcRenderer.invoke("sideshow:config-status"),
  firebaseConfig: () => ipcRenderer.invoke("sideshow:firebase-config"),
  signIn: () => ipcRenderer.invoke("sideshow:sign-in"),
  signOut: () => ipcRenderer.invoke("sideshow:sign-out"),
  refreshToken: () => ipcRenderer.invoke("sideshow:refresh-token"),
  openConfigFolder: () => ipcRenderer.invoke("sideshow:open-config-folder"),
  onAuthToken: (fn) => ipcRenderer.on("sideshow:auth-token", (_e, data) => fn(data)),
  onAuthError: (fn) => ipcRenderer.on("sideshow:auth-error", () => fn()),
  onConfigMissing: (fn) => ipcRenderer.on("sideshow:config-missing", (_e, st) => fn(st)),
});
