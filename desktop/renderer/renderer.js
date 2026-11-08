"use strict";
/* Sideshow panel — reads the saved Main Eventer events from Firestore
   (read-only) and shows each field as a clickable chip. Click a chip to
   copy that exact value; paste it wherever you are working. */

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { eventChips, eventTitle, eventSubtitle, eventMatches, fieldValueForKey } from "./fields.js";

const ALLOWLIST = ["kylematthewberry@gmail.com", "rochelleberry731@gmail.com"];
const COLLECTION = "mainEvent_events";
const SINGLE_KEYS = ["n", "d", "t", "p", "a", "h", "l"];

const $ = (id) => document.getElementById(id);
let auth = null;
let db = null;
let events = [];
let unsubscribe = null;
let queryText = "";
let focusedEvent = null;
let capturingHotkey = false;
let recordingGesture = false;
let soundOn = true;
let audioCtx = null;
let motionSetting = null; /* explicit user choice: "full"|"reduced"|"off"|null */
let remindersOn = true;

/* ---------- sound: gentle bubble/pop, synthesized (Web Audio) ---------- */

function ensureAudio() {
  if (!audioCtx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/* Short blip with a quick pitch rise — reads as a bubble/pop. */
function blip(f0, f1, dur, gain, type) {
  if (!soundOn) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch (e) { /* audio unavailable */ }
}

function playCopySound() { blip(520, 920, 0.14, 0.12, "triangle"); }
function playOpenSound() { blip(320, 480, 0.12, 0.07, "sine"); }
function playCloseSound() { blip(280, 380, 0.12, 0.06, "sine"); }
function playTickSound() { blip(700, 900, 0.05, 0.04, "sine"); }

/* ---------- hotkey display ---------- */

function friendlyHotkey(acc) {
  if (!acc) return "";
  const isMac = navigator.platform.indexOf("Mac") >= 0;
  return acc
    .replace(/CommandOrControl|CmdOrCtrl/g, isMac ? "⌘" : "Ctrl")
    .replace(/Command|Cmd/g, "⌘")
    .replace(/Control|Ctrl/g, "Ctrl")
    .replace(/Option/g, "⌥")
    .replace(/Super|Meta/g, isMac ? "⌘" : "Win");
}

function acceleratorFromEvent(e) {
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  let key = e.key;
  if (!key || key === "Control" || key === "Meta" || key === "Alt" || key === "Shift") return null;
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();
  else key = key.charAt(0).toUpperCase() + key.slice(1);
  if (!mods.length) return null;
  return mods.join("+") + "+" + key;
}

function flashSaved(el) {
  if (!el) return;
  el.classList.remove("saved");
  void el.offsetWidth;
  el.classList.add("saved");
  setTimeout(() => el.classList.remove("saved"), 1000);
}

/* ---------- motion (accessibility) ---------- */

/* Effective motion: the user's explicit choice, or the OS
   reduced-motion preference when no choice is set. */
function effectiveMotion() {
  if (motionSetting) return motionSetting;
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "reduced";
  } catch (e) { /* media query unavailable */ }
  return "full";
}

function applyMotion() {
  const eff = effectiveMotion();
  const root = document.documentElement;
  root.classList.remove("motion-full", "motion-reduced", "motion-off");
  root.classList.add("motion-" + eff);
  try { window.sideshow.setMotionEffective(eff); } catch (e) { /* main keeps its default */ }
  return eff;
}

const MOTION_CYCLE = ["full", "reduced", "off"];
const MOTION_LABEL = { full: "Full", reduced: "Reduced", off: "Off" };

function motionButtonLabel() {
  return MOTION_LABEL[effectiveMotion()] || "Full";
}

/* ---------- accent color ---------- */

/* Swatch choices. null = platform default (blue on Mac, green on
   Windows). Terracotta is the studio brand color. */
const ACCENT_SWATCHES = [
  { value: null, label: "Default" },
  { value: "#a44a24", label: "Terracotta" },
  { value: "#e07a45", label: "Clay" },
  { value: "#c9962e", label: "Gold" },
  { value: "#2e6b34", label: "Green" },
  { value: "#2e7d6b", label: "Teal" },
  { value: "#4a6fa5", label: "Blue" },
  { value: "#7a4a6e", label: "Plum" },
];
let accentSetting = null;

/* Blend two hex colors. t = weight of `a` (0..1). */
function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.substr(i, 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.substr(i, 2), 16));
  const out = pa.map((v, i) => Math.round(v * t + pb[i] * (1 - t)));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function isDarkScheme() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (e) { return false; }
}

/* Apply the accent: one color for the copy confirmation and all UI
   accents (buttons, focus, selected states). A custom choice
   overrides the platform default; null removes the override so the
   CSS platform default applies. */
function applyAccent() {
  const root = document.documentElement;
  if (!accentSetting) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-ink");
    root.style.removeProperty("--good");
    root.style.removeProperty("--good-bg");
    return;
  }
  const hex = accentSetting;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--good", hex);
  /* Light tint for the copied-chip background. */
  const bg = isDarkScheme() ? mixHex(hex, "#1d1712", 0.3) : mixHex(hex, "#ffffff", 0.12);
  root.style.setProperty("--good-bg", bg);
  /* Readable ink on the accent (white on dark accents, dark on light). */
  const r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
  const bright = 0.299 * r + 0.587 * g + 0.114 * b;
  root.style.setProperty("--accent-ink", bright > 140 ? "#1d1712" : "#ffffff");
}

function buildAccentSwatches() {
  const wrap = $("accentSwatches");
  if (!wrap) return;
  wrap.innerHTML = "";
  ACCENT_SWATCHES.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (s.value === null ? " default" : "") + (accentSetting === s.value ? " selected" : "");
    b.setAttribute("aria-label", "Accent " + s.label);
    b.title = s.label;
    if (s.value) b.style.background = s.value;
    b.addEventListener("click", async () => {
      accentSetting = s.value;
      try { await window.sideshow.setAccent(accentSetting); } catch (e) { /* stays local */ }
      applyAccent();
      wrap.querySelectorAll(".swatch").forEach((el) => el.classList.remove("selected"));
      b.classList.add("selected");
    });
    wrap.appendChild(b);
  });
}

function setState(name) {
  ["loading", "config", "signin", "empty", "list", "error"].forEach((s) => {
    const el = $("state-" + s);
    if (el) el.classList.toggle("show", s === name);
  });
}

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

function copyValue(value, chipEl) {
  if (!value) return;
  window.sideshow.copy(value).then(() => {
    if (chipEl) {
      chipEl.classList.add("copied");
      chipEl.classList.remove("pop");
      void chipEl.offsetWidth;
      chipEl.classList.add("pop");
      setTimeout(() => chipEl.classList.remove("copied"), 1200);
      setTimeout(() => chipEl.classList.remove("pop"), 300);
    }
    playCopySound();
  });
}

/* Animated confirm mark for a chip: a copy icon draws, then a
   checkmark draws itself. Shown in place of the value while the
   chip is in its copied state. No text confirmation. */
const CONFIRM_SVG = '<svg class="chip-confirm" viewBox="0 0 24 24" aria-hidden="true">'
  + '<g class="copy-icon">'
  + '<rect class="draw" pathLength="1" x="9" y="9" width="11" height="11" rx="2"/>'
  + '<rect class="draw" pathLength="1" x="4" y="4" width="11" height="11" rx="2"/>'
  + '</g>'
  + '<path class="draw-check" pathLength="1" d="M5 12.5 L10 17.5 L19 7"/>'
  + '</svg>';

/* Focus one event card (the "expanded"/focused event the single-key
   shortcuts apply to). A light tick plays when the focus moves to a
   different event — the list equivalent of an expand/collapse. */
function focusEvent(ev, cardEl, tick) {
  const changed = focusedEvent !== ev;
  focusedEvent = ev;
  if (cardEl) {
    const list = $("eventList");
    if (list) list.querySelectorAll(".event").forEach((el) => el.classList.remove("focused"));
    cardEl.classList.add("focused");
  }
  if (changed && tick) playTickSound();
}

/* Send the saved events to main for the badge count and reminders.
   Only the fields main needs: id, name, date, startTime. */
function syncEventsToMain() {
  try {
    const list = events.map((ev) => ({
      id: ev._id || null,
      title: ev.title || "",
      date: ev.date || "",
      startTime: ev.startTime || "",
    }));
    window.sideshow.eventsUpdated(list);
  } catch (e) { /* badge/reminders skipped; panel still works */ }
}

/* Open one event by id (from a reminder notification click): focus
   it and scroll it into view. */
function openEventById(id) {
  if (!id) return;
  const ev = events.find((e) => e._id === id);
  if (!ev) return;
  focusedEvent = ev;
  render();
  const card = document.querySelector("#eventList .event.focused");
  if (card) card.scrollIntoView({ block: "nearest" });
}

function render() {
  const list = $("eventList");
  if (!list) return;
  const filtered = events.filter((ev) => eventMatches(ev, queryText));
  list.innerHTML = "";
  if (!filtered.length) {
    focusedEvent = null;
    setState(events.length ? "empty" : "empty");
    return;
  }
  setState("list");
  if (!focusedEvent || filtered.indexOf(focusedEvent) < 0) focusedEvent = filtered[0];
  filtered.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "event" + (ev === focusedEvent ? " focused" : "");
    card.addEventListener("click", () => {
      focusEvent(ev, card, true);
    });
    const head = document.createElement("div");
    head.className = "event-head";
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = eventTitle(ev);
    const sub = document.createElement("div");
    sub.className = "event-sub";
    sub.textContent = eventSubtitle(ev);
    head.appendChild(title);
    if (sub.textContent) head.appendChild(sub);
    card.appendChild(head);
    const chips = document.createElement("div");
    chips.className = "chips";
    eventChips(ev).forEach((chip) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.key = chip.key || "";
      if (chip.key) {
        const kb = document.createElement("span");
        kb.className = "chip-key";
        kb.textContent = chip.key.toUpperCase();
        b.appendChild(kb);
      }
      const k = document.createElement("span");
      k.className = "chip-k";
      k.textContent = chip.label;
      const v = document.createElement("span");
      v.className = "chip-v";
      v.textContent = chip.value;
      b.appendChild(k);
      b.appendChild(v);
      b.insertAdjacentHTML("beforeend", CONFIRM_SVG);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        focusEvent(ev, card, false);
        copyValue(chip.value, b);
      });
      chips.appendChild(b);
    });
    card.appendChild(chips);
    list.appendChild(card);
  });
}

/* Single-key shortcuts: while the panel is open, pressing a letter
   copies that field from the focused event (most recently clicked).
   Never fires while typing in the search box or while capturing a
   new hotkey. */
function handleSingleKey(e) {
  if (capturingHotkey || recordingGesture) return;
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = (e.key || "").toLowerCase();
  if (SINGLE_KEYS.indexOf(key) < 0) return;
  if (!focusedEvent) return;
  const value = fieldValueForKey(focusedEvent, key);
  if (!value) return;
  e.preventDefault();
  const chipEl = document.querySelector('.chip[data-key="' + key + '"]');
  copyValue(value, chipEl);
}

function subscribe() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!db) return;
  setState("loading");
  const q = query(collection(db, COLLECTION), orderBy("updatedAt", "desc"), limit(50));
  unsubscribe = onSnapshot(q, (snap) => {
    events = [];
    snap.forEach((doc) => events.push(Object.assign({ _id: doc.id }, doc.data())));
    render();
    syncEventsToMain();
  }, () => {
    setState("error");
    setStatus("Could not load events.");
  });
}

function updateAuthUI(user) {
  const label = $("authLabel");
  const signInBtn = $("signInBtn");
  const signOutBtn = $("signOutBtn");
  if (user) {
    if (label) label.textContent = user.email || "";
    if (signInBtn) signInBtn.style.display = "none";
    if (signOutBtn) signOutBtn.style.display = "";
  } else {
    if (label) label.textContent = "";
    if (signInBtn) signInBtn.style.display = "";
    if (signOutBtn) signOutBtn.style.display = "none";
  }
}

async function signInWithIdToken(idToken) {
  try {
    const cred = GoogleAuthProvider.credential(idToken);
    const result = await signInWithCredential(auth, cred);
    const email = (result.user.email || "").toLowerCase();
    if (ALLOWLIST.indexOf(email) < 0) {
      await signOut(auth);
      await window.sideshow.signOut();
      setStatus("That Google account is not on the studio list.");
    }
  } catch (e) {
    setStatus("Sign-in failed.");
  }
}

async function init() {
  setState("loading");
  const st = await window.sideshow.configStatus();
  if (!st.hasConfig) { setState("config"); return; }
  const fbConfig = await window.sideshow.firebaseConfig();
  if (!fbConfig) { setState("config"); return; }
  initializeApp(fbConfig);
  auth = getAuth();
  db = getFirestore();
  onAuthStateChanged(auth, (user) => {
    updateAuthUI(user);
    if (user) {
      const email = (user.email || "").toLowerCase();
      if (ALLOWLIST.indexOf(email) < 0) {
        signOut(auth);
        window.sideshow.signOut();
        setStatus("That Google account is not on the studio list.");
        setState("signin");
        return;
      }
      subscribe();
    } else {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      events = [];
      setState("signin");
    }
  });
  window.sideshow.onAuthToken((data) => {
    if (data && data.idToken) signInWithIdToken(data.idToken);
  });
  window.sideshow.onAuthError(() => setStatus("Sign-in failed."));
  window.sideshow.onConfigMissing(() => { setState("config"); });
  // Silent sign-in from a stored refresh token.
  try {
    const idToken = await window.sideshow.refreshToken();
    if (idToken) signInWithIdToken(idToken);
  } catch (e) { /* stays signed out */ }
}

async function refreshSettingsUI() {
  try {
    const hk = await window.sideshow.getHotkey();
    const btn = $("hotkeyBtn");
    if (btn && !capturingHotkey) btn.textContent = friendlyHotkey(hk);
  } catch (e) { /* hotkey display stays as-is */ }
  try {
    const g = await window.sideshow.getGesture();
    const btn = $("gestureBtn");
    const clearBtn = $("gestureClearBtn");
    if (btn) btn.textContent = g.available ? (g.label || "None") : "Unavailable";
    if (clearBtn) clearBtn.style.display = g.gesture ? "" : "none";
    if (btn) btn.disabled = !g.available;
  } catch (e) { /* gesture display stays as-is */ }
  try {
    const on = await window.sideshow.getSound();
    soundOn = !!on;
    const btn = $("soundBtn");
    if (btn) btn.textContent = soundOn ? "🔊" : "🔇";
  } catch (e) { /* sound stays on */ }
  try {
    motionSetting = await window.sideshow.getMotion();
    const btn = $("motionBtn");
    if (btn) btn.textContent = motionButtonLabel();
    applyMotion();
  } catch (e) { /* motion follows the OS */ }
  try {
    remindersOn = await window.sideshow.getReminders();
    const btn = $("remindersBtn");
    if (btn) btn.textContent = remindersOn ? "🔔" : "🔕";
  } catch (e) { /* reminders stay on */ }
  try {
    accentSetting = await window.sideshow.getAccent();
    applyAccent();
    buildAccentSwatches();
  } catch (e) { /* accent stays platform default */ }
}

document.addEventListener("DOMContentLoaded", () => {
  const platform = (window.sideshow && window.sideshow.platform) || "";
  if (platform) document.documentElement.classList.add("platform-" + platform);
  /* Apply the OS reduced-motion preference immediately (before the
     saved setting loads); refreshSettingsUI refines it after. */
  applyMotion();
  applyAccent();
  buildAccentSwatches();
  try {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (!motionSetting) applyMotion(); });
  } catch (e) { /* media query listener unavailable */ }
  try {
    const dm = window.matchMedia("(prefers-color-scheme: dark)");
    if (dm && dm.addEventListener) dm.addEventListener("change", () => applyAccent());
  } catch (e) { /* color-scheme listener unavailable */ }
  const search = $("search");
  if (search) search.addEventListener("input", () => { queryText = search.value.trim(); render(); });
  const signInBtn = $("signInBtn");
  if (signInBtn) signInBtn.addEventListener("click", () => window.sideshow.signIn());
  const signOutBtn = $("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", async () => {
    if (auth) await signOut(auth);
    await window.sideshow.signOut();
  });
  const closeBtn = $("closeBtn");
  if (closeBtn) closeBtn.addEventListener("click", () => window.sideshow.hide());
  const cfgBtn = $("openConfigBtn");
  if (cfgBtn) cfgBtn.addEventListener("click", () => window.sideshow.openConfigFolder());
  const hotkeyBtn = $("hotkeyBtn");
  if (hotkeyBtn) hotkeyBtn.addEventListener("click", () => {
    if (capturingHotkey) return;
    capturingHotkey = true;
    hotkeyBtn.textContent = "Press keys…";
    hotkeyBtn.classList.add("listening");
  });
  const gestureBtn = $("gestureBtn");
  if (gestureBtn) gestureBtn.addEventListener("click", async () => {
    if (recordingGesture) return;
    recordingGesture = true;
    gestureBtn.textContent = "Perform gesture…";
    gestureBtn.classList.add("listening");
    gestureBtn.disabled = true;
    try {
      const res = await window.sideshow.recordGesture();
      if (res && res.ok) {
        gestureBtn.textContent = res.label || "Saved";
        flashSaved(gestureBtn);
        const clearBtn = $("gestureClearBtn");
        if (clearBtn) clearBtn.style.display = "";
      } else {
        setStatus((res && res.error) || "Could not record a gesture.");
        await refreshSettingsUI();
      }
    } catch (e) {
      setStatus("Could not record a gesture.");
      await refreshSettingsUI();
    }
    recordingGesture = false;
    gestureBtn.classList.remove("listening");
    gestureBtn.disabled = false;
  });
  const gestureClearBtn = $("gestureClearBtn");
  if (gestureClearBtn) gestureClearBtn.addEventListener("click", async () => {
    await window.sideshow.clearGesture();
    await refreshSettingsUI();
  });
  const soundBtn = $("soundBtn");
  if (soundBtn) soundBtn.addEventListener("click", async () => {
    soundOn = !soundOn;
    try { await window.sideshow.setSound(soundOn); } catch (e) { /* stays local */ }
    soundBtn.textContent = soundOn ? "🔊" : "🔇";
    if (soundOn) playCopySound();
  });
  const motionBtn = $("motionBtn");
  if (motionBtn) motionBtn.addEventListener("click", async () => {
    const cur = effectiveMotion();
    const next = MOTION_CYCLE[(MOTION_CYCLE.indexOf(cur) + 1) % MOTION_CYCLE.length];
    motionSetting = next;
    try { await window.sideshow.setMotion(motionSetting); } catch (e) { /* stays local */ }
    applyMotion();
    motionBtn.textContent = motionButtonLabel();
    flashSaved(motionBtn);
  });
  const remindersBtn = $("remindersBtn");
  if (remindersBtn) remindersBtn.addEventListener("click", async () => {
    remindersOn = !remindersOn;
    try { await window.sideshow.setReminders(remindersOn); } catch (e) { /* stays local */ }
    remindersBtn.textContent = remindersOn ? "🔔" : "🔕";
    flashSaved(remindersBtn);
    if (remindersOn) syncEventsToMain();
  });
  window.sideshow.onOpenEvent((id) => openEventById(id));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { window.sideshow.hide(); return; }
    if (capturingHotkey) {
      const acc = acceleratorFromEvent(e);
      if (!acc) return;
      e.preventDefault();
      e.stopPropagation();
      capturingHotkey = false;
      if (hotkeyBtn) hotkeyBtn.classList.remove("listening");
      window.sideshow.setHotkey(acc).then((res) => {
        if (res && res.ok) {
          if (hotkeyBtn) {
            hotkeyBtn.textContent = friendlyHotkey(res.hotkey);
            flashSaved(hotkeyBtn);
          }
        } else {
          setStatus("That hotkey is taken or invalid.");
          if (hotkeyBtn && res) hotkeyBtn.textContent = friendlyHotkey(res.hotkey);
        }
      });
      return;
    }
    handleSingleKey(e);
  });
  window.sideshow.onPanelShowing(() => playOpenSound());
  window.sideshow.onPanelHiding(() => playCloseSound());
  refreshSettingsUI();
  init();
});
