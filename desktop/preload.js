"use strict";
/* Sideshow preload — exposes a minimal API to the panel. The OAuth
   client secret never reaches the renderer; it stays in the main process. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sideshow", {
  platform: process.platform,
  copy: (text) => ipcRenderer.invoke("sideshow:copy", text),
  hide: () => ipcRenderer.invoke("sideshow:hide"),
  configStatus: () => ipcRenderer.invoke("sideshow:config-status"),
  firebaseConfig: () => ipcRenderer.invoke("sideshow:firebase-config"),
  signIn: () => ipcRenderer.invoke("sideshow:sign-in"),
  signOut: () => ipcRenderer.invoke("sideshow:sign-out"),
  refreshToken: () => ipcRenderer.invoke("sideshow:refresh-token"),
  openConfigFolder: () => ipcRenderer.invoke("sideshow:open-config-folder"),
  getHotkey: () => ipcRenderer.invoke("sideshow:get-hotkey"),
  setHotkey: (acc) => ipcRenderer.invoke("sideshow:set-hotkey", acc),
  resetHotkey: () => ipcRenderer.invoke("sideshow:reset-hotkey"),
  getGesture: () => ipcRenderer.invoke("sideshow:get-gesture"),
  recordGesture: () => ipcRenderer.invoke("sideshow:record-gesture"),
  clearGesture: () => ipcRenderer.invoke("sideshow:clear-gesture"),
  getSound: () => ipcRenderer.invoke("sideshow:get-sound"),
  setSound: (enabled) => ipcRenderer.invoke("sideshow:set-sound", enabled),
  getMotion: () => ipcRenderer.invoke("sideshow:get-motion"),
  setMotion: (value) => ipcRenderer.invoke("sideshow:set-motion", value),
  setMotionEffective: (value) => ipcRenderer.invoke("sideshow:motion-effective", value),
  getReminders: () => ipcRenderer.invoke("sideshow:get-reminders"),
  setReminders: (enabled) => ipcRenderer.invoke("sideshow:set-reminders", enabled),
  getAccent: () => ipcRenderer.invoke("sideshow:get-accent"),
  setAccent: (value) => ipcRenderer.invoke("sideshow:set-accent", value),
  eventsUpdated: (list) => ipcRenderer.invoke("sideshow:events-updated", list),
  onOpenEvent: (fn) => ipcRenderer.on("sideshow:open-event", (_e, id) => fn(id)),
  onPanelShowing: (fn) => ipcRenderer.on("sideshow:panel-showing", () => fn()),
  onPanelHiding: (fn) => ipcRenderer.on("sideshow:panel-hiding", () => fn()),
  onAuthToken: (fn) => ipcRenderer.on("sideshow:auth-token", (_e, data) => fn(data)),
  onAuthError: (fn) => ipcRenderer.on("sideshow:auth-error", () => fn()),
  onConfigMissing: (fn) => ipcRenderer.on("sideshow:config-missing", (_e, st) => fn(st)),
});
