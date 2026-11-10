"use strict";
/* Sideshow panel — the bubble. One floating outline bubble tree:
   Event Bank root -> event bubbles -> value bubbles (click to copy).
   Reads the saved Main Eventer events from Firestore (read-only).
   Settings live in a separate window (settings.html), opened with
   the gear; the bubble stays open beside it as a live preview.
   This same bundle runs in both windows: IS_SETTINGS_WINDOW tells
   it which one it is. */

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, query, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { eventTitle, eventWhen, eventMatches, fieldValueForKey, MONTHS, fmtDateShort, fmtDateLong, timeRange, COPY_ALL_FORMAT_LABELS, copyAllText } from "./fields.js";
import { calendarEventToRecord, mergeEvents, monthGrid, groupEventsByDate, weekDates, shiftDateStr } from "./calendar.js";
import { nextUpcomingEvent, formatCountdown, isAllDay } from "./nextup.js";
import { classifyDragTarget, isDragMovement, shouldEngageDrag } from "./drag.js";
import {
  FIELD_KEYS, FIELD_LABELS, FONTS, FONT_LABELS, FONT_CYCLE,
  WEIGHTS, WEIGHT_LABELS, WEIGHT_CYCLE,
  CORNER_LABELS, CORNER_CYCLE, ALIGN_LABELS, ALIGN_CYCLE,
  SCROLLBAR_LABELS, SCROLLBAR_CYCLE, SCROLLBAR_SHAPE_LABELS, SCROLLBAR_SHAPE_CYCLE, SCROLLBAR_SHAPE_RADIUS,
  SEPARATION_LABELS, SEPARATION_CYCLE,
  normalizeBubbleOptions, rgba, readableInkFor,
} from "../bubble-options.js";

const ALLOWLIST = ["kylematthewberry@gmail.com", "rochelleberry731@gmail.com", "media@firedartsstudio.com"];
const COLLECTION = "mainEvent_events";
/* Single-key shortcuts (bubble view, expanded event): n name, d date,
   t time range, p price, a ages, h host, l location, c copy all. */
const SINGLE_KEYS = ["n", "d", "t", "p", "a", "h", "l"];
const COPY_ALL_KEY = "c";

const $ = (id) => document.getElementById(id);
/* Which window this bundle runs in: the bubble (index.html) or the
   settings window (settings.html). The settings window never
   renders the bubble tree, never reports a content height, and
   never touches the panel's click-through state. */
const IS_SETTINGS_WINDOW = /settings\.html$/.test(window.location.pathname);
let auth = null;
let db = null;
let events = []; /* merged view: Main Eventer + Google Calendar */
let meEvents = []; /* Firestore Main Eventer events, in snapshot order */
let calEvents = []; /* converted Google Calendar events */
let calSetting = { enabled: false, selectedIds: [] };
let calLastFetchAt = 0; /* ms; calendar refetch at most every 5 min */
let calScopeMissing = false; /* the stored token predates the calendar scope */
let calPickerLoading = false;
const CAL_FETCH_STALE_MS = 5 * 60 * 1000;
let unsubscribe = null;
let focusedEvent = null; /* the expanded event (accordion) */
let searchQuery = ""; /* live search text from the header search bar */
let capturingHotkey = false;
let recordingGesture = false;
let capturingDoubleTap = false;
let recordingLongClick = false;
let soundOn = true;
let soundStyle = "bubbly"; /* bubbly (current) | chime | click | pop */
let copyAllFormat = "labeled"; /* labeled | plain — what Copy all puts on the clipboard */
let tooltipsOn = true; /* hover tooltips on every interactive element */
let audioCtx = null;
let motionSetting = null; /* explicit user choice: "full"|"reduced"|"off"|null (follow OS) */
let remindersOn = false; /* off by default — the core works with everything off */
let accentSetting = null; /* null = platform default */
let appearanceSetting = "glass"; /* glass | shaded | clear */
let transparencySetting = 50; /* 0-100 */
/* The full Position setting object (mode, width, display, gap,
   dismiss, custom) as normalized by main; the mode cycle reads
   .mode. Defaults match position.js. */
let positionSetting = { mode: "cursor", custom: null, width: 400, display: "cursor", gap: 16, dismiss: 0 };
let bubbleOptions = normalizeBubbleOptions(null); /* scale, font, weight, border, shadow, bg, corners, align, pulse, text color, per-field styles */
const POSITION_MODES = ["cursor", "top-left", "top-right", "bottom-left", "bottom-right", "center", "custom"];
const POSITION_LABELS = {
  cursor: "Follow cursor",
  "top-left": "Top-left",
  "top-right": "Top-right",
  "bottom-left": "Bottom-left",
  "bottom-right": "Bottom-right",
  center: "Center",
  custom: "Remember spot",
};
const PANEL_DISPLAY_LABELS = { cursor: "Display with cursor", primary: "Primary display" };
const DISMISS_LABELS = { 0: "Stay until closed", 5: "5 seconds", 10: "10 seconds", 30: "30 seconds", 60: "1 minute" };
const DISMISS_OPTIONS = [0, 5, 10, 30, 60];
let currentView = IS_SETTINGS_WINDOW ? "settings" : "bubble"; /* bubble | settings */
let signedIn = false;
let hiddenIds = new Set(); /* event _ids hidden with the eye; stay in the bank, out of the bubble */
let pinnedIds = new Set(); /* event _ids pinned; they render in the Pinned section at the top, not their normal place */
let cachedMode = false; /* true while the tree shows the last fetched events because the live fetch failed */
let reminderLead = 15; /* minutes before an event starts that its reminder fires (lead list: 5/15/30/60) */
const REMINDER_LEAD_OPTIONS = [5, 15, 30, 60];
let nextUpTimer = null; /* 30s tick that refreshes the Next up countdown in place */
let nextUpShown = null; /* { event, startMs } currently shown in the Next up row */
/* Bubble view mode: "tree" (the branch list), "calendar" (month
   grid), or "week" (journal list). The calendar and week views are
   navigation aids — clicking an entry jumps back to the tree with
   that event's branch open. The header button cycles
   tree -> month -> week -> tree. */
let bubbleViewMode = "tree";
const VIEW_CYCLE = ["tree", "calendar", "week"];
const now0 = new Date();
let calViewYear = now0.getFullYear();
let calViewMonth = now0.getMonth(); /* 0-based */
let weekViewDate = new Date(now0.getFullYear(), now0.getMonth(), now0.getDate()); /* any day in the shown week */
/* Idle auto-dismiss: the clock counts from the last panel activity
   (pointer, click, tap, typing, scrolling, keyboard). A still mouse
   counts as idle. When the panel has been idle for the set time it
   fades out and hides through the normal hide path. Never fires
   while the settings window is open (the bubble is the live preview
   then) or during a drag. 0 = stay until closed (default). */
let panelVisible = false;
let settingsWindowOpen = false;
let idleTimer = null;
function idleDismissMs() { return (positionSetting.dismiss || 0) * 1000; }
let eventsListOpen = new Set(); /* event _ids with their edit form open in Settings */

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

/* Sound styles: each set is distinct across the three moments
   (panel opens, panel closes, value copied) plus the tick.
   Bubbly is the current set (default). Chime is higher and longer,
   bell-like. Click is short and dry. Pop drops in pitch. All
   synthesized with Web Audio — no audio files. The Sound on/off
   toggle stays the master switch; the style only matters while
   sound is on. Each entry is [fromHz, toHz, seconds, gain, wave]. */
const SOUND_STYLES = {
  bubbly: {
    open: [320, 480, 0.12, 0.07, "sine"],
    close: [280, 380, 0.12, 0.06, "sine"],
    copy: [520, 920, 0.14, 0.12, "triangle"],
    tick: [700, 900, 0.05, 0.04, "sine"],
  },
  chime: {
    open: [660, 990, 0.25, 0.07, "sine"],
    close: [520, 780, 0.25, 0.06, "sine"],
    copy: [880, 1320, 0.30, 0.10, "sine"],
    tick: [990, 1320, 0.10, 0.04, "sine"],
  },
  click: {
    open: [1200, 1200, 0.04, 0.05, "square"],
    close: [900, 900, 0.04, 0.05, "square"],
    copy: [1400, 1400, 0.05, 0.06, "square"],
    tick: [1600, 1600, 0.03, 0.04, "square"],
  },
  pop: {
    open: [600, 180, 0.10, 0.09, "triangle"],
    close: [500, 150, 0.10, 0.08, "triangle"],
    copy: [900, 250, 0.12, 0.12, "triangle"],
    tick: [800, 300, 0.05, 0.05, "triangle"],
  },
};
const SOUND_STYLE_LABELS = { bubbly: "Bubbly", chime: "Chime", click: "Click", pop: "Pop" };
const SOUND_STYLE_CYCLE = ["bubbly", "chime", "click", "pop"];

function playStyled(moment) {
  const style = SOUND_STYLES[soundStyle] || SOUND_STYLES.bubbly;
  const s = style[moment] || style.tick;
  blip(s[0], s[1], s[2], s[3], s[4]);
}
function playCopySound() { playStyled("copy"); }
function playOpenSound() { playStyled("open"); }
function playCloseSound() { playStyled("close"); }
function playTickSound() { playStyled("tick"); }

/* ---------- tooltips ---------- */

/* Hover tooltips are the browser's native title tooltip: a few
   words naming what the element does ("Settings", "Copy name",
   "Hide event"). Native titles are hover-only (never on touch),
   never show while the pointer button is held (never during a
   drag), and have no element of their own — nothing to interfere
   with the panel's click-through logic or elementFromPoint.
   Static elements carry their text in data-tip (see index.html /
   settings.html); dynamic elements use setTitle at creation.
   The Tooltips setting (General, default on) suppresses all of
   them: applyTooltips copies data-tip to title when on, and clears
   every title when off. */
function setTitle(el, text) {
  if (!el) return;
  /* The text is kept in data-tip-text so applyTooltips can restore
     it when the setting is turned back on (dynamic elements are
     not rebuilt by a settings toggle). */
  if (text) el.dataset.tipText = text;
  if (tooltipsOn && text) el.title = text;
  else el.removeAttribute("title");
}
function applyTooltips() {
  document.querySelectorAll("[data-tip]").forEach((el) => {
    if (tooltipsOn) el.title = el.getAttribute("data-tip") || "";
    else el.removeAttribute("title");
  });
  document.querySelectorAll("[data-tip-text]").forEach((el) => {
    if (tooltipsOn) el.title = el.getAttribute("data-tip-text") || "";
    else el.removeAttribute("title");
  });
}

/* ---------- idle auto-dismiss ---------- */

/* The clock counts from the last interaction with the panel. Any
   activity resets it: pointer movement over the panel, clicks,
   taps, typing in the search box, scrolling, keyboard use. A mouse
   sitting still over the panel counts as idle. When the panel has
   been idle for the set time it fades out gradually through the
   normal hide path (hidePanel's fade), never an instant hide.
   Never fires while the settings window is open or during a drag. */
function clearIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}
function resetIdleTimer() {
  clearIdleTimer();
  if (IS_SETTINGS_WINDOW) return;
  if (!panelVisible || settingsWindowOpen) return;
  if (dragState) return; /* a drag restarts the clock when it ends */
  const ms = idleDismissMs();
  if (!ms) return; /* 0 = stay until closed */
  idleTimer = setTimeout(() => {
    idleTimer = null;
    try { window.sideshow.hide(); } catch (e) { /* stays open */ }
  }, ms);
}
function notePanelActivity() {
  if (IS_SETTINGS_WINDOW) return;
  resetIdleTimer();
}

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
let accentSettingValue = null;

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
  if (!accentSettingValue) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-ink");
    root.style.removeProperty("--good");
    root.style.removeProperty("--good-bg");
    return;
  }
  const hex = accentSettingValue;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--good", hex);
  /* Light tint for the copied-bubble background. */
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
    b.className = "swatch" + (s.value === null ? " default" : "") + (accentSettingValue === s.value ? " selected" : "");
    b.setAttribute("aria-label", "Accent " + s.label);
    b.title = s.label;
    if (s.value) b.style.background = s.value;
    b.addEventListener("click", async () => {
      accentSettingValue = s.value;
      try { await window.sideshow.setAccent(accentSettingValue); } catch (e) { /* stays local */ }
      applyAccent();
      wrap.querySelectorAll(".swatch").forEach((el) => el.classList.remove("selected"));
      b.classList.add("selected");
    });
    wrap.appendChild(b);
  });
}

/* ---------- one-tap preset themes ---------- */

/* Shortcuts, not a new store: applying one sets the existing
   settings (look, background, accent, text ink) so the live preview
   and the existing persistence work exactly as for manual picks.
   Colors come only from the existing swatch palette. Text ink is
   left to auto (null) so it is computed from the preset background
   and always reads — even if an explicit text color was picked
   before, the preset clears it. */
const THEME_PRESETS = [
  { id: "studio", label: "Studio", appearance: "glass", bgColor: "#a44a24", accent: "#a44a24" },
  { id: "dark", label: "Dark", appearance: "shaded", bgColor: "#2b2118", accent: "#a44a24" },
  { id: "light", label: "Light", appearance: "glass", bgColor: "#ffffff", accent: "#a44a24" },
];
function buildPresetButtons() {
  const wrap = $("presetBtns");
  if (!wrap || wrap.childElementCount) return; /* built once */
  THEME_PRESETS.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn plain setting-btn";
    b.textContent = p.label;
    b.setAttribute("aria-label", "Theme " + p.label);
    b.addEventListener("click", async () => { await applyPreset(p); flashSaved(b); });
    wrap.appendChild(b);
  });
}
async function applyPreset(p) {
  appearanceSetting = p.appearance;
  try { await window.sideshow.setAppearance(p.appearance); } catch (e) { /* stays local */ }
  accentSettingValue = p.accent;
  try { await window.sideshow.setAccent(p.accent); } catch (e) { /* stays local */ }
  bubbleOptions.bgColor = p.bgColor;
  bubbleOptions.textColor = null; /* auto ink from the preset background */
  await saveBubbleOptions();
  applyAccent();
  buildAccentSwatches();
  applyBubbleOptions();
}

/* ---------- bubble appearance ---------- */

/* Liquid Glass (frosted), Shaded (soft tint), Transparent (nearly
   clear). Transparency 0–100 maps to the bubble fill alpha
   0.05–1.0. Default: Liquid Glass at middle transparency. */
function applyAppearance() {
  const root = document.documentElement;
  root.classList.remove("appearance-glass", "appearance-shaded", "appearance-clear");
  root.classList.add("appearance-" + (appearanceSetting || "glass"));
  const alpha = 0.05 + (Math.max(0, Math.min(100, transparencySetting)) / 100) * 0.95;
  root.style.setProperty("--bubble-alpha", alpha.toFixed(2));
  const g = $("appearanceGlassBtn"), s = $("appearanceShadedBtn"), c = $("appearanceClearBtn");
  if (g) g.classList.toggle("active", appearanceSetting === "glass");
  if (s) s.classList.toggle("active", appearanceSetting === "shaded");
  if (c) c.classList.toggle("active", appearanceSetting === "clear");
  const slider = $("transparencySlider");
  if (slider) slider.value = String(transparencySetting);
  /* Background color: tints the fill for the current look — the
     glass tint for Liquid Glass, the shaded fill for Shaded, a
     faint tint for Transparent. The text ink is auto-computed from
     it so a dark background stays readable; an explicit text color
     (set in applyBubbleOptions) wins over this auto ink. */
  const bg = bubbleOptions.bgColor;
  if (bg) {
    const fill = appearanceSetting === "clear"
      ? rgba(bg, +(alpha * 0.12).toFixed(2))
      : rgba(bg, alpha);
    if (fill) root.style.setProperty("--bubble-fill", fill);
    const ink = readableInkFor(bg);
    if (ink) {
      root.style.setProperty("--bubble-ink-auto", ink.ink);
      root.style.setProperty("--bubble-ink-soft-auto", ink.soft);
    }
  } else {
    root.style.removeProperty("--bubble-fill");
    root.style.removeProperty("--bubble-ink-auto");
    root.style.removeProperty("--bubble-ink-soft-auto");
  }
}

/* ---------- bubble options: scale, font, border, shadow, bg,
   corners, alignment, pulse, text color, per-field styling ---------- */

/* Swatch choices for the border / background / text color pickers.
   null = Default (the current look). */
const COLOR_SWATCHES = [
  { value: null, label: "Default" },
  { value: "#a44a24", label: "Terracotta" },
  { value: "#e07a45", label: "Clay" },
  { value: "#c9962e", label: "Gold" },
  { value: "#2e6b34", label: "Green" },
  { value: "#2e7d6b", label: "Teal" },
  { value: "#4a6fa5", label: "Blue" },
  { value: "#7a4a6e", label: "Plum" },
  { value: "#2b2118", label: "Dark" },
  { value: "#ffffff", label: "White" },
];

async function saveBubbleOptions() {
  try {
    const res = await window.sideshow.setBubbleOptions(bubbleOptions);
    if (res) bubbleOptions = normalizeBubbleOptions(res);
  } catch (e) { /* stays local */ }
}

/* Apply every bubble option to the DOM: CSS vars + classes for the
   tree, and the settings controls' values. Per-field styling is
   applied when the bubbles render (render reads bubbleOptions). */
function applyBubbleOptions() {
  const root = document.documentElement;
  const tree = $("bubbleTree");
  const o = bubbleOptions;
  /* Scale: zoom on the tree (bubbles + text); the header stays put. */
  if (tree) tree.style.zoom = String(o.scale / 100);
  /* Font + base weight. */
  root.style.setProperty("--bubble-font", FONTS[o.font] || FONTS.mono);
  root.style.setProperty("--bubble-weight", String(WEIGHTS[o.weight] || 400));
  /* Border color override (null = the current per-look outline). */
  if (o.borderColor) root.style.setProperty("--bubble-border-user", o.borderColor);
  else root.style.removeProperty("--bubble-border-user");
  /* Shadow: a drop-shadow so it follows any corner shape. */
  root.classList.toggle("shadow-on", !!o.shadowOn);
  root.style.setProperty("--shadow-blur", Math.round(o.shadowStrength * 0.24) + "px");
  root.style.setProperty("--shadow-alpha", (o.shadowStrength * 0.0035).toFixed(2));
  /* Corners: style class + pixel roundness (Smooth only). */
  root.classList.remove("corners-smooth", "corners-right");
  root.classList.add("corners-" + o.cornerStyle);
  root.style.setProperty("--corner-radius", o.cornerRadius + "px");
  /* Branch alignment. */
  root.classList.remove("align-left", "align-right", "align-middle", "align-center");
  root.classList.add("align-" + o.align);
  /* Scrollbar width: slim (6px) or standard (12px). */
  root.classList.remove("scrollbar-slim", "scrollbar-standard");
  root.classList.add("scrollbar-" + o.scrollbar);
  /* Scrollbar thumb color: an explicit choice wins over the accent
     (changing the accent no longer recolors it once picked); unset
     keeps the current accent look. Thumb shape: pill (fully round,
     the current look), rounded, or square. Both apply to the tree,
     the calendar/week views, and the settings scroll areas —
     wherever the themed scrollbar appears. The track stays
     transparent either way. */
  if (o.scrollbarColor) root.style.setProperty("--scrollbar-thumb", o.scrollbarColor);
  else root.style.removeProperty("--scrollbar-thumb");
  root.style.setProperty("--scrollbar-radius", SCROLLBAR_SHAPE_RADIUS[o.scrollbarShape] || "999px");
  /* Entry separation: bullets / divider lines / extra spacing. */
  root.classList.remove("sep-bullets", "sep-lines", "sep-spacing");
  root.classList.add("sep-" + o.separation);
  /* Header icon color: an explicit choice wins over the theme ink
     (the value-bubble copy/confirm icons keep their own color). */
  if (o.iconColor) root.style.setProperty("--icon-color-user", o.iconColor);
  else root.style.removeProperty("--icon-color-user");
  /* Text color: an explicit choice wins over the background's auto ink. */
  if (o.textColor) {
    root.style.setProperty("--bubble-ink-user", o.textColor);
    root.style.setProperty("--bubble-ink-soft-user", o.textColor);
  } else {
    root.style.removeProperty("--bubble-ink-user");
    root.style.removeProperty("--bubble-ink-soft-user");
  }
  /* Gentle pulse: the class is the toggle; the motion classes gate
     whether it actually animates (Full runs, Reduced subtler, Off none). */
  if (tree) tree.classList.toggle("pulse", !!o.pulse);
  /* Background color + auto ink live in applyAppearance (they need
     the look + the transparency alpha). */
  applyAppearance();
  refreshBubbleOptionControls();
}

/* Per-field styling classes for one field, from the Text tab
   outline. Bold wins over the global weight for that field; italic
   and underline are independent. */
function fieldStyleClasses(key) {
  const f = (bubbleOptions.fieldStyles && bubbleOptions.fieldStyles[key]) || {};
  const cls = [];
  if (f.italic) cls.push("field-italic");
  if (f.underline) cls.push("field-underline");
  if (f.bold) cls.push("field-bold");
  return cls.join(" ");
}
function fieldStyleColor(key) {
  const f = (bubbleOptions.fieldStyles && bubbleOptions.fieldStyles[key]) || {};
  return f.color || null;
}

/* ---------- settings tabs ---------- */

const SETTINGS_TABS = ["position", "appearance", "text", "summon", "general", "events"];
let settingsTab = "position";
function switchSettingsTab(name) {
  if (SETTINGS_TABS.indexOf(name) < 0) name = "position";
  settingsTab = name;
  document.querySelectorAll(".settings-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  SETTINGS_TABS.forEach((t) => {
    const panel = $("tab-" + t);
    if (panel) panel.hidden = t !== name;
  });
  if (name === "events") renderEventsList();
  reportContentHeight();
}

/* ---------- inflate-open ---------- */

/* When the panel is summoned, the view grows from small to full
   size once, like a balloon inflating (the Motion classes gate it:
   Full runs it, Reduced runs a subtler puff, Off shows it
   instantly). The class is removed when the animation ends, so the
   gentle pulse takes over from full size. */
function inflateBubble() {
  const bv = $("bubbleView");
  if (!bv) return;
  bv.classList.remove("inflate");
  void bv.offsetWidth; /* restart it if it was mid-run */
  bv.classList.add("inflate");
}

/* ---------- color swatch rows (border / background / text) ---------- */

function buildColorSwatches(containerId, getValue, onPick) {
  const wrap = $(containerId);
  if (!wrap || wrap.childElementCount) return; /* built once */
  COLOR_SWATCHES.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (s.value === null ? " default" : "");
    b.setAttribute("aria-label", s.label);
    setTitle(b, s.label);
    b.dataset.value = s.value === null ? "" : s.value;
    if (s.value) b.style.background = s.value;
    b.addEventListener("click", () => {
      onPick(s.value);
      refreshColorSwatches(containerId, getValue());
    });
    wrap.appendChild(b);
  });
  refreshColorSwatches(containerId, getValue());
}
function refreshColorSwatches(containerId, current) {
  const wrap = $(containerId);
  if (!wrap) return;
  wrap.querySelectorAll(".swatch").forEach((el) => {
    const v = el.dataset.value || null;
    el.classList.toggle("selected", (v || null) === (current || null));
  });
}

/* ---------- per-field styling outline (Text tab) ---------- */

/* One outline line per field: the field name, with its Italic /
   Underline / Bold toggles + color indented under it. Built once;
   refreshFieldOutline syncs the control states. */
function buildFieldOutline() {
  const wrap = $("fieldOutline");
  if (!wrap || wrap.childElementCount) return;
  FIELD_KEYS.forEach((key) => {
    const row = document.createElement("div");
    row.className = "field-row";
    row.dataset.field = key;
    const name = document.createElement("div");
    name.className = "field-name";
    name.textContent = FIELD_LABELS[key] || key;
    row.appendChild(name);
    const toggles = document.createElement("div");
    toggles.className = "field-toggles";
    [["italic", "I", "Italic", "field-italic-toggle"],
     ["underline", "U", "Underline", "field-underline-toggle"],
     ["bold", "B", "Bold", "field-bold-toggle"]].forEach(([prop, label, title, cls]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "field-toggle " + cls;
      b.textContent = label;
      setTitle(b, title);
      b.dataset.prop = prop;
      b.addEventListener("click", async () => {
        const f = bubbleOptions.fieldStyles[key];
        f[prop] = !f[prop];
        await saveBubbleOptions();
        refreshFieldOutline();
        render(); /* the bubbles carry the styling */
        flashSaved(b);
      });
      toggles.appendChild(b);
    });
    const color = document.createElement("input");
    color.type = "color";
    color.className = "color-input";
    setTitle(color, "Text color for " + (FIELD_LABELS[key] || key));
    color.setAttribute("aria-label", "Text color for " + (FIELD_LABELS[key] || key));
    color.addEventListener("input", () => {
      bubbleOptions.fieldStyles[key].color = color.value;
      render();
    });
    color.addEventListener("change", async () => {
      await saveBubbleOptions();
      refreshFieldOutline();
    });
    toggles.appendChild(color);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "field-clear";
    clear.innerHTML = X_SVG;
    setTitle(clear, "Use the global text color");
    clear.setAttribute("aria-label", "Use the global text color");
    clear.addEventListener("click", async () => {
      bubbleOptions.fieldStyles[key].color = null;
      await saveBubbleOptions();
      refreshFieldOutline();
      render();
    });
    toggles.appendChild(clear);
    row.appendChild(toggles);
    wrap.appendChild(row);
  });
  refreshFieldOutline();
}
function refreshFieldOutline() {
  const wrap = $("fieldOutline");
  if (!wrap) return;
  FIELD_KEYS.forEach((key) => {
    const row = wrap.querySelector('.field-row[data-field="' + key + '"]');
    if (!row) return;
    const f = (bubbleOptions.fieldStyles && bubbleOptions.fieldStyles[key]) || {};
    row.querySelectorAll(".field-toggle").forEach((b) => {
      b.classList.toggle("active", !!f[b.dataset.prop]);
    });
    const color = row.querySelector('input[type="color"]');
    if (color) color.value = f.color || bubbleOptions.textColor || "#2b2118";
    const clear = row.querySelector(".field-clear");
    if (clear) clear.style.display = f.color ? "" : "none";
  });
}

/* Sync the Appearance + Text tab controls to the current options
   (button labels, slider values, swatch selection, outline state).
   Does not rebuild DOM, so it is safe to call while a slider or
   color picker is being dragged. */
function refreshBubbleOptionControls() {
  const o = bubbleOptions;
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const setVal = (id, v) => { const el = $(id); if (el) el.value = String(v); };
  setText("fontBtn", FONT_LABELS[o.font] || "Mono");
  setText("weightBtn", WEIGHT_LABELS[o.weight] || "Regular");
  setText("cornerStyleBtn", CORNER_LABELS[o.cornerStyle] || "Smooth");
  setText("alignBtn", ALIGN_LABELS[o.align] || "Left");
  setText("scrollbarBtn", SCROLLBAR_LABELS[o.scrollbar] || "Slim");
  setText("scrollbarShapeBtn", SCROLLBAR_SHAPE_LABELS[o.scrollbarShape] || "Pill");
  setText("separationBtn", SEPARATION_LABELS[o.separation] || "Bullets");
  setText("pulseBtn", o.pulse ? "On" : "Off");
  setText("shadowBtn", o.shadowOn ? "On" : "Off");
  setVal("scaleSlider", o.scale);
  setText("scaleValue", o.scale + "%");
  setVal("shadowStrengthSlider", o.shadowStrength);
  setText("shadowStrengthValue", String(o.shadowStrength));
  setVal("cornerRadiusSlider", o.cornerRadius);
  setText("cornerRadiusValue", o.cornerRadius + "px");
  refreshColorSwatches("borderSwatches", o.borderColor);
  refreshColorSwatches("bgSwatches", o.bgColor);
  refreshColorSwatches("textColorSwatches", o.textColor);
  refreshColorSwatches("iconSwatches", o.iconColor);
  refreshColorSwatches("scrollbarSwatches", o.scrollbarColor);
  setVal("borderColorInput", o.borderColor || "#a44a24");
  setVal("bgColorInput", o.bgColor || "#a44a24");
  setVal("textColorInput", o.textColor || "#2b2118");
  setVal("iconColorInput", o.iconColor || "#2b2118");
  setVal("scrollbarColorInput", o.scrollbarColor || "#a44a24");
  refreshFieldOutline();
}

/* ---------- state / status ---------- */

function setState(name) {
  ["loading", "config", "signin", "empty", "list", "error"].forEach((s) => {
    const el = $("state-" + s);
    if (el) el.classList.toggle("show", s === name);
  });
  /* The tree shows the sign-in / empty bubbles itself, so it stays
     visible for signin/empty/list; it hides for loading/config/error. */
  const tree = $("bubbleTree");
  if (tree) {
    const hideTree = ["loading", "config", "error"].indexOf(name) >= 0;
    tree.style.display = hideTree ? "none" : "";
  }
}

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
  const sel = $("settingsStatus");
  if (sel) sel.textContent = msg || "";
}

/* ---------- copy feedback (pop + drawing checkmark, no text) ---------- */

const CONFIRM_SVG = '<svg class="bubble-confirm" viewBox="0 0 24 24" aria-hidden="true">'
  + '<g class="copy-icon">'
  + '<rect class="draw" pathLength="1" x="9" y="9" width="11" height="11" rx="2"/>'
  + '<rect class="draw" pathLength="1" x="4" y="4" width="11" height="11" rx="2"/>'
  + '</g>'
  + '<path class="draw-check" pathLength="1" d="M5 12.5 L10 17.5 L19 7"/>'
  + '</svg>';

const COPY_SVG = '<svg class="copy-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

/* Settings icons are SVG, never emoji. The sound / reminders buttons
   swap between the on and off SVGs. */
const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const SOUND_ON_SVG = '<svg ' + ICON_ATTRS + '><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
const SOUND_OFF_SVG = '<svg ' + ICON_ATTRS + '><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
const BELL_ON_SVG = '<svg ' + ICON_ATTRS + '><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
const BELL_OFF_SVG = '<svg ' + ICON_ATTRS + '><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
/* Eye icons (SVG, never emoji): hide an event from the bubble, or
   show it again from the Settings Events list. */
const EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
/* Pin icon (SVG, never emoji): pin an event to the Pinned section at
   the top of the tree. Pinned, the pin fills in. */
const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 3h6l1 7 3 3H5l3-3 1-7z"/></svg>';
/* Calendar icon for the tree/calendar toggle in the bubble header. */
const CALENDAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

function copyValue(value, bubbleEl) {
  if (!value) return;
  window.sideshow.copy(value).then(() => {
    if (bubbleEl) {
      bubbleEl.classList.add("copied");
      bubbleEl.classList.remove("pop");
      void bubbleEl.offsetWidth;
      bubbleEl.classList.add("pop");
      setTimeout(() => bubbleEl.classList.remove("copied"), 1200);
      setTimeout(() => bubbleEl.classList.remove("pop"), 300);
    }
    playCopySound();
  });
}

/* ---------- bubble tree ---------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/* The value bubbles for one event, in single-key order. The Time
   bubble is a single range (start–end) with key T, matching the
   single-key mapping — not separate Start/End bubbles. */
function valueBubblesFor(ev) {
  return SINGLE_KEYS
    .map((key) => ({ key, value: fieldValueForKey(ev, key) }))
    .filter((v) => v.value);
}

/* ---------- hide / show + calendar view + Events list ---------- */

/* Events the bubble shows right now: hidden ones removed, then the
   live search filter. */
function visibleEvents() {
  const shown = events.filter((ev) => !hiddenIds.has(ev._id));
  return searchQuery ? shown.filter((ev) => eventMatches(ev, searchQuery)) : shown;
}

/* Hide or show one event. The id stays in the bank (and in
   Settings, where the eye shows it again); it just stops rendering
   in the bubble, the calendar, and the badge / reminders. */
async function setEventHidden(ev, hidden) {
  if (!ev || !ev._id) return;
  if (hidden) hiddenIds.add(ev._id);
  else hiddenIds.delete(ev._id);
  if (hidden && focusedEvent && focusedEvent._id === ev._id) focusedEvent = null;
  try { await window.sideshow.setHiddenEvents([...hiddenIds]); } catch (e) { /* stays local */ }
  render();
  if (IS_SETTINGS_WINDOW) renderEventsList();
}

/* Pin or unpin one event. Pinned events render in the Pinned
   section at the top of the tree instead of their normal place —
   they do not appear twice. The pin persists in settings, so it
   survives a reload. */
async function setEventPinned(ev, pinned) {
  if (!ev || !ev._id) return;
  if (pinned) pinnedIds.add(ev._id);
  else pinnedIds.delete(ev._id);
  try { await window.sideshow.setPinnedEvents([...pinnedIds]); } catch (e) { /* stays local */ }
  render();
  if (IS_SETTINGS_WINDOW) renderEventsList();
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

/* View icons for the header toggle: the icon names the view the
   button switches TO (the next view in the cycle), so the current
   view is always clear from what the button offers. */
const TREE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1.3" fill="currentColor" stroke="none"/></svg>';
const WEEK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
const VIEW_BUTTON = {
  tree: { icon: CALENDAR_SVG, label: "Show calendar view", tip: "Calendar view" },
  calendar: { icon: WEEK_SVG, label: "Show week view", tip: "Week view" },
  week: { icon: TREE_SVG, label: "Show tree view", tip: "Tree view" },
};
function updateViewButton() {
  const btn = $("calendarViewBtn");
  if (!btn) return;
  const next = VIEW_BUTTON[bubbleViewMode] || VIEW_BUTTON.tree;
  btn.innerHTML = next.icon;
  btn.setAttribute("aria-label", next.label);
  btn.classList.toggle("active", bubbleViewMode !== "tree");
  setTitle(btn, next.tip);
}

/* Which view the bubble shows: the branch tree, the month grid, or
   the week journal. The toggle button's active state follows the
   mode (active whenever the tree is not showing). */
function applyViewMode() {
  const tree = $("bubbleTree");
  const cal = $("calendarView");
  const week = $("weekView");
  if (tree) tree.hidden = bubbleViewMode !== "tree";
  if (cal) cal.hidden = bubbleViewMode !== "calendar";
  if (week) week.hidden = bubbleViewMode !== "week";
  updateViewButton();
}

function setBubbleViewMode(mode) {
  bubbleViewMode = VIEW_CYCLE.indexOf(mode) >= 0 ? mode : "tree";
  render();
  reportContentHeight();
}

/* Cycle the header button: tree -> month -> week -> tree. */
function cycleViewMode() {
  const next = VIEW_CYCLE[(VIEW_CYCLE.indexOf(bubbleViewMode) + 1) % VIEW_CYCLE.length];
  setBubbleViewMode(next);
}

function shiftCalMonth(delta) {
  let m = calViewMonth + delta;
  let y = calViewYear;
  while (m < 0) { m += 12; y -= 1; }
  while (m > 11) { m -= 12; y += 1; }
  calViewMonth = m;
  calViewYear = y;
  renderCalendar();
  reportContentHeight();
}

function shiftWeek(deltaDays) {
  weekViewDate = new Date(weekViewDate.getFullYear(), weekViewDate.getMonth(), weekViewDate.getDate() + deltaDays);
  renderWeek();
  reportContentHeight();
}

/* The week journal: a vertical list of the week's 7 days (Sunday
   start, matching the month grid), each day a section with its date
   heading and that day's events listed under it with time and name,
   plus price / location where the event has them. Days with no
   events show just the date heading, no filler. Multi-day events
   sit on their start date; dateless events stay in the tree.
   Clicking an entry jumps back to the tree with that event's branch
   open, same as the month chips. */
function renderWeek() {
  const view = $("weekView");
  if (!view) return;
  view.innerHTML = "";
  const byDate = groupEventsByDate(visibleEvents());
  const days = weekDates(weekViewDate);
  const head = document.createElement("div");
  head.className = "cal-head";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "cal-nav";
  prev.setAttribute("aria-label", "Previous week");
  prev.textContent = "‹";
  setTitle(prev, "Previous week");
  prev.addEventListener("click", () => shiftWeek(-7));
  const label = document.createElement("button");
  label.type = "button";
  label.className = "cal-label";
  const sunday = days[0];
  label.textContent = "Week of " + fmtDateShort(new Date(sunday.year, sunday.month, sunday.day));
  setTitle(label, "Back to this week");
  label.addEventListener("click", () => {
    const n = new Date();
    weekViewDate = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    renderWeek();
    reportContentHeight();
  });
  const next = document.createElement("button");
  next.type = "button";
  next.className = "cal-nav";
  next.setAttribute("aria-label", "Next week");
  next.textContent = "›";
  setTitle(next, "Next week");
  next.addEventListener("click", () => shiftWeek(7));
  head.appendChild(prev);
  head.appendChild(label);
  head.appendChild(next);
  view.appendChild(head);
  const today = new Date();
  const todayStr = today.getFullYear() + "-" + pad2(today.getMonth() + 1) + "-" + pad2(today.getDate());
  days.forEach((day) => {
    const section = document.createElement("div");
    section.className = "week-day" + (day.date === todayStr ? " week-today" : "");
    const heading = document.createElement("div");
    heading.className = "week-day-head";
    heading.textContent = fmtDateLong(new Date(day.year, day.month, day.day));
    section.appendChild(heading);
    (byDate[day.date] || []).forEach((ev) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "week-event";
      const time = timeRange(ev);
      const meta = [ev.price, ev.location].filter(Boolean).join(" · ");
      row.innerHTML =
        (time ? '<span class="week-time">' + escapeHtml(time) + "</span>" : "") +
        '<span class="week-name">' + escapeHtml(eventTitle(ev)) + "</span>" +
        (meta ? '<span class="week-meta">' + escapeHtml(meta) + "</span>" : "");
      setTitle(row, eventTitle(ev));
      row.addEventListener("click", () => {
        focusedEvent = ev;
        setBubbleViewMode("tree");
        const card = document.querySelector("#bubbleTree .event-branch.expanded");
        if (card) card.scrollIntoView({ block: "nearest" });
      });
      section.appendChild(row);
    });
    view.appendChild(section);
  });
}

/* The month grid: weekday row, then 6 weeks of cells. Each cell
   carries its day number and the visible events on that date as
   clickable chips; clicking one jumps back to the tree with that
   event's branch open. Multi-day events sit on their start date;
   dateless events stay in the tree. The grid is 7 equal columns so
   it fits the 400px frame exactly; cells grow vertically, never
   sideways. */
function renderCalendar() {
  const view = $("calendarView");
  if (!view) return;
  view.innerHTML = "";
  const byDate = groupEventsByDate(visibleEvents());
  const head = document.createElement("div");
  head.className = "cal-head";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "cal-nav";
  prev.setAttribute("aria-label", "Previous month");
  prev.textContent = "‹";
  setTitle(prev, "Previous month");
  prev.addEventListener("click", () => shiftCalMonth(-1));
  const label = document.createElement("button");
  label.type = "button";
  label.className = "cal-label";
  label.textContent = MONTHS[calViewMonth] + " " + calViewYear;
  setTitle(label, "Back to this month");
  label.addEventListener("click", () => {
    const n = new Date();
    calViewYear = n.getFullYear();
    calViewMonth = n.getMonth();
    renderCalendar();
    reportContentHeight();
  });
  const next = document.createElement("button");
  next.type = "button";
  next.className = "cal-nav";
  next.setAttribute("aria-label", "Next month");
  next.textContent = "›";
  setTitle(next, "Next month");
  next.addEventListener("click", () => shiftCalMonth(1));
  head.appendChild(prev);
  head.appendChild(label);
  head.appendChild(next);
  view.appendChild(head);
  const dow = document.createElement("div");
  dow.className = "cal-dow";
  ["S", "M", "T", "W", "T", "F", "S"].forEach((d) => {
    const s = document.createElement("span");
    s.textContent = d;
    dow.appendChild(s);
  });
  view.appendChild(dow);
  const grid = document.createElement("div");
  grid.className = "cal-grid";
  const today = new Date();
  const todayStr = today.getFullYear() + "-" + pad2(today.getMonth() + 1) + "-" + pad2(today.getDate());
  monthGrid(calViewYear, calViewMonth).forEach((week) => {
    week.forEach((cell) => {
      const el = document.createElement("div");
      el.className = "cal-cell" + (cell.inMonth ? "" : " cal-out") + (cell.date === todayStr ? " cal-today" : "");
      const num = document.createElement("span");
      num.className = "cal-day";
      num.textContent = String(cell.day);
      el.appendChild(num);
      (byDate[cell.date] || []).forEach((ev) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "cal-event";
        chip.textContent = eventTitle(ev);
        setTitle(chip, eventTitle(ev));
        chip.addEventListener("click", () => {
          focusedEvent = ev;
          setBubbleViewMode("tree");
          const card = document.querySelector("#bubbleTree .event-branch.expanded");
          if (card) card.scrollIntoView({ block: "nearest" });
        });
        el.appendChild(chip);
      });
      grid.appendChild(el);
    });
  });
  view.appendChild(grid);
}

/* Events list (Settings > Events tab): every saved event with its
   eye, and an edit form for Main Eventer events. Google Calendar
   events are read-only here — they live in Google Calendar, not
   the bank — so they get the eye only, no form. */
const EVENT_EDIT_FIELDS = [
  { key: "title", label: "Name", type: "text" },
  { key: "date", label: "Date", type: "date" },
  { key: "startTime", label: "Start", type: "time" },
  { key: "endTime", label: "End", type: "time" },
  { key: "price", label: "Price", type: "text" },
  { key: "ages", label: "Ages", type: "text" },
  { key: "host", label: "Host", type: "text" },
  { key: "location", label: "Location", type: "text" },
];

function renderEventsList() {
  const list = $("eventsList");
  if (!list) return;
  list.innerHTML = "";
  if (!signedIn) {
    const empty = document.createElement("div");
    empty.className = "events-empty";
    empty.textContent = "Sign in to edit events.";
    list.appendChild(empty);
    return;
  }
  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "events-empty";
    empty.textContent = "No saved events yet.";
    list.appendChild(empty);
    return;
  }
  events.forEach((ev) => {
    const hidden = hiddenIds.has(ev._id);
    const isCal = ev.source === "gcal";
    const row = document.createElement("div");
    row.className = "event-row" + (hidden ? " is-hidden" : "");
    const head = document.createElement("div");
    head.className = "event-row-head";
    const title = document.createElement(isCal ? "span" : "button");
    title.className = "event-row-title";
    title.textContent = eventTitle(ev);
    if (!isCal) {
      title.type = "button";
      title.addEventListener("click", () => {
        if (eventsListOpen.has(ev._id)) eventsListOpen.delete(ev._id);
        else eventsListOpen.add(ev._id);
        renderEventsList();
      });
    }
    head.appendChild(title);
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "eye-btn";
    eye.setAttribute("aria-label", hidden ? "Show event" : "Hide event");
    eye.title = hidden ? "Show event" : "Hide event";
    eye.innerHTML = hidden ? EYE_OFF_SVG : EYE_SVG;
    eye.addEventListener("click", () => setEventHidden(ev, !hidden));
    head.appendChild(eye);
    /* Pin: same row as the eye — pinned events render in the Pinned
       section at the top of the tree instead of their normal place. */
    const pinned = pinnedIds.has(ev._id);
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "eye-btn pin-btn" + (pinned ? " pinned" : "");
    pin.setAttribute("aria-label", pinned ? "Unpin event" : "Pin event");
    pin.title = pinned ? "Unpin event" : "Pin event";
    pin.innerHTML = PIN_SVG;
    pin.addEventListener("click", () => setEventPinned(ev, !pinnedIds.has(ev._id)));
    head.appendChild(pin);
    row.appendChild(head);
    if (!isCal && eventsListOpen.has(ev._id)) {
      const form = document.createElement("div");
      form.className = "event-edit";
      EVENT_EDIT_FIELDS.forEach((f) => {
        const wrap = document.createElement("label");
        wrap.className = "event-edit-field";
        const lab = document.createElement("span");
        lab.textContent = f.label;
        const input = document.createElement("input");
        input.type = f.type;
        input.dataset.field = f.key;
        input.value = ev[f.key] || "";
        wrap.appendChild(lab);
        wrap.appendChild(input);
        form.appendChild(wrap);
      });
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn";
      save.textContent = "Save";
      save.addEventListener("click", () => saveEventEdit(ev, form, save));
      form.appendChild(save);
      row.appendChild(form);
    }
    list.appendChild(row);
  });
}

/* Save an edited event back to Firestore — the same bank the
   bubble reads, so the change shows up everywhere at once. The
   updatedAt stamp keeps the newest-first order. */
async function saveEventEdit(ev, form, saveBtn) {
  if (!db || !ev || !ev._id) return;
  const patch = { updatedAt: serverTimestamp() };
  form.querySelectorAll("input[data-field]").forEach((input) => {
    patch[input.dataset.field] = input.value || "";
  });
  try {
    await updateDoc(doc(db, COLLECTION, ev._id), patch);
    eventsListOpen.delete(ev._id);
    flashSaved(saveBtn);
    renderEventsList();
  } catch (e) {
    setStatus("Could not save.");
  }
}

function render() {
  const tree = $("bubbleTree");
  if (!tree) return;
  if (focusedEvent && !visibleEvents().some((e) => e._id === focusedEvent._id)) focusedEvent = null;
  tree.innerHTML = "";

  /* Root bubble — the Event Bank. Click it (no drag) to toggle the
     focused event open/closed; drag from anywhere on the panel
     (including this bubble) to move it. */
  const root = document.createElement("button");
  root.type = "button";
  root.className = "bubble root-bubble pulse-item";
  root.style.animationDelay = "0s";
  root.innerHTML = '<span class="root-text">Event Bank</span>';
  tree.appendChild(root);

  const connector = document.createElement("div");
  connector.className = "tree-connector";
  tree.appendChild(connector);

  /* Calendar view: the month grid replaces the tree, even with no
     events yet (an empty month) — the toggle must always work, not
     silently do nothing while signed out or with an empty bank. */
  if (bubbleViewMode === "calendar") {
    applyViewMode();
    setState("list");
    renderCalendar();
    reportContentHeight();
    return;
  }
  /* Week view: the journal list replaces the tree, same rule — it
     always works, even with no events that week. */
  if (bubbleViewMode === "week") {
    applyViewMode();
    setState("list");
    renderWeek();
    reportContentHeight();
    return;
  }
  applyViewMode();

  if (!signedIn) {
    const signin = document.createElement("button");
    signin.type = "button";
    signin.className = "bubble signin-bubble pulse-item";
    signin.style.animationDelay = "0.5s";
    signin.innerHTML = '<span class="value-text">Sign in</span>';
    signin.addEventListener("click", () => window.sideshow.signIn());
    tree.appendChild(signin);
    setState("signin");
    reportContentHeight();
    return;
  }

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "bubble empty-bubble pulse-item";
    empty.style.animationDelay = "0.5s";
    empty.textContent = "No saved events yet.";
    tree.appendChild(empty);
    setState("empty");
    reportContentHeight();
    return;
  }

  setState("list");
  /* Live search: the header search bar filters the event bubbles by
     keyword (name, date, time, price, ages, host, location,
     description). Hidden events never show. Empty search shows all
     visible events. */
  const visible = visibleEvents();
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "bubble empty-bubble pulse-item";
    empty.style.animationDelay = "0.5s";
    empty.textContent = searchQuery ? "No matching events." : "All events hidden.";
    tree.appendChild(empty);
    reportContentHeight();
    return;
  }
  /* Next up: the soonest upcoming visible event, with a live
     countdown. Clicking it jumps to that event's branch. */
  renderNextUp(visible);
  /* Pinned: pinned events render here, at the top, instead of their
     normal place — they do not appear twice. */
  const pinned = visible.filter((ev) => pinnedIds.has(ev._id));
  const rest = visible.filter((ev) => !pinnedIds.has(ev._id));
  if (pinned.length) {
    const label = document.createElement("div");
    label.className = "pinned-label";
    label.textContent = "Pinned";
    tree.appendChild(label);
    pinned.forEach((ev, i) => tree.appendChild(renderEventBranch(ev, i)));
  }
  rest.forEach((ev, evIndex) => tree.appendChild(renderEventBranch(ev, evIndex)));
  reportContentHeight();
}

/* The Next up row: the soonest upcoming visible event (today
   first), with a countdown that ticks every 30 seconds. Clicking it
   opens that event's branch. The row is rebuilt on every render;
   the countdown text is refreshed in place by the timer so a tick
   never steals the search box focus. */
function renderNextUp(visible) {
  const tree = $("bubbleTree");
  if (!tree) return;
  nextUpShown = nextUpcomingEvent(visible);
  if (!nextUpShown) return;
  const ev = nextUpShown.event;
  const row = document.createElement("button");
  row.type = "button";
  row.className = "bubble next-up";
  const when = eventWhen(ev);
  row.innerHTML =
    '<span class="next-up-label">Next up</span>' +
    '<span class="next-up-main">' +
    '<span class="next-up-title">' + escapeHtml(eventTitle(ev)) + "</span>" +
    (when ? '<span class="next-up-when">' + escapeHtml(when) + "</span>" : "") +
    "</span>" +
    '<span class="next-up-countdown">' + escapeHtml(formatCountdown(nextUpShown.startMs, Date.now(), isAllDay(ev))) + "</span>";
  setTitle(row, eventTitle(ev));
  row.addEventListener("click", () => {
    focusedEvent = ev;
    render();
    const card = document.querySelector("#bubbleTree .event-branch.expanded");
    if (card) card.scrollIntoView({ block: "nearest" });
  });
  tree.appendChild(row);
}

/* Refresh the Next up countdown in place (no re-render, so the
   search box keeps its focus). Runs every 30 seconds. */
function refreshNextUpCountdown() {
  if (IS_SETTINGS_WINDOW) return;
  if (bubbleViewMode !== "tree") return;
  const row = document.querySelector("#bubbleTree .next-up");
  if (!row) return;
  const next = nextUpcomingEvent(visibleEvents());
  if (!next) { row.remove(); nextUpShown = null; return; }
  nextUpShown = next;
  const count = row.querySelector(".next-up-countdown");
  if (count) count.textContent = formatCountdown(next.startMs, Date.now(), isAllDay(next.event));
  const title = row.querySelector(".next-up-title");
  if (title) title.textContent = eventTitle(next.event);
  const when = row.querySelector(".next-up-when");
  if (when) when.textContent = eventWhen(next.event);
  setTitle(row, eventTitle(next.event));
}

/* One event's branch: the event bubble (name, when, meta, expand
   mark, pin, eye) plus its value bubbles when expanded. */
function renderEventBranch(ev, evIndex) {
    const isExpanded = focusedEvent && focusedEvent._id === ev._id;
    const isPinned = pinnedIds.has(ev._id);
    const item = document.createElement("div");
    item.className = "event-branch pulse-item" + (isExpanded ? " expanded" : "");
    /* Stagger: each event breathes a beat after the one before it
       (root 0s, then 0.5s, 1.0s, …), a gentle wave down the tree. */
    item.style.animationDelay = ((evIndex + 1) * 0.5) + "s";

    const btn = document.createElement("button");
    btn.type = "button";
    /* Name styling: the title carries the Name field's italic /
       underline / bold (bold defaults on — the title is already
       bold). Bold off drops the title to the global weight. */
    const nameStyle = (bubbleOptions.fieldStyles && bubbleOptions.fieldStyles.n) || { bold: true };
    btn.className = "bubble event-bubble" + (nameStyle.bold === false ? " name-weight-base" : "");
    btn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    setTitle(btn, isExpanded ? "Collapse event" : "Expand event");
    const when = eventWhen(ev);
    const meta = [ev.price, ev.ages, ev.host, ev.location].filter(Boolean);
    const nameCls = fieldStyleClasses("n");
    const nameColor = fieldStyleColor("n");
    /* Hierarchy: Name (largest, bold) → Date + Time → Price / Ages /
       Host / Location in a smaller secondary block. */
    btn.innerHTML =
      '<span class="event-main">' +
      '<span class="event-title' + (nameCls ? " " + nameCls : "") + '"' +
      (nameColor ? ' style="color:' + nameColor + '"' : "") + ">" + escapeHtml(eventTitle(ev)) + "</span>" +
      (when ? '<span class="event-when">' + escapeHtml(when) + "</span>" : "") +
      (meta.length ? '<span class="event-meta">' + meta.map((m, i) =>
        (i ? '<span class="event-meta-sep">·</span>' : "") +
        '<span class="event-meta-item">' + escapeHtml(m) + "</span>").join("") + "</span>" : "") +
      "</span>" +
      '<span class="expand-mark">' + (isExpanded ? "−" : "+") + "</span>" +
      '<span class="pin-btn' + (isPinned ? " pinned" : "") + '" role="button" aria-label="' + (isPinned ? "Unpin event" : "Pin event") + '" title="' + (isPinned ? "Unpin event" : "Pin event") + '">' + PIN_SVG + "</span>" +
      '<span class="eye-btn" role="button" aria-label="Hide event" title="Hide event">' + EYE_SVG + "</span>";
    btn.addEventListener("click", () => {
      focusedEvent = isExpanded ? null : ev;
      if (isExpanded) playCloseSound(); else playTickSound();
      render();
    });
    /* The eye hides the event without expanding it — stop the click
       from reaching the bubble's own toggle. */
    const eye = btn.querySelector(".eye-btn");
    if (eye) {
      setTitle(eye, "Hide event");
      eye.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        setEventHidden(ev, true);
      });
    }
    /* The pin moves the event to (or from) the Pinned section at the
       top of the tree — same stop, so pinning never also expands. */
    const pin = btn.querySelector(".pin-btn");
    if (pin) {
      setTitle(pin, isPinned ? "Unpin event" : "Pin event");
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        setEventPinned(ev, !isPinned);
      });
    }
    item.appendChild(btn);

    if (isExpanded) {
      const values = document.createElement("div");
      values.className = "value-branch";
      valueBubblesFor(ev).forEach(({ key, value }) => {
        const vb = document.createElement("button");
        vb.type = "button";
        const fcls = fieldStyleClasses(key);
        vb.className = "bubble value-bubble" + (fcls ? " " + fcls : "");
        const fcolor = fieldStyleColor(key);
        if (fcolor) vb.style.color = fcolor;
        vb.dataset.key = key;
        /* The shortcut key sits after the value, as an afterthought —
           not before it as a lead-in. The confirm checkmark only
           shows on copy, after the badge. */
        vb.innerHTML = COPY_SVG + '<span class="value-text">' + escapeHtml(value) + '</span><span class="key-badge">' + key.toUpperCase() + "</span>" + CONFIRM_SVG;
        setTitle(vb, "Copy " + (FIELD_LABELS[key] || key).toLowerCase());
        vb.addEventListener("click", () => copyValue(value, vb));
        values.appendChild(vb);
      });
      /* Copy all: one row at the end of the expanded event's value
         bubbles, copying every field the event has (same order as
         the value bubbles, description last) in the format picked
         in Settings > General. Same checkmark + sound as a value
         copy. Key C copies it too. */
      const all = document.createElement("button");
      all.type = "button";
      all.className = "bubble value-bubble copy-all-bubble";
      all.dataset.key = COPY_ALL_KEY;
      all.innerHTML = COPY_SVG + '<span class="value-text">Copy all</span><span class="key-badge">C</span>' + CONFIRM_SVG;
      setTitle(all, "Copy all details");
      all.addEventListener("click", () => copyValue(copyAllText(ev, copyAllFormat), all));
      values.appendChild(all);
      item.appendChild(values);
    }

    return item;
}

/* ---------- content height: fit the window to the bubble ---------- */

/* The window height follows the bubble content, so the bubble stays
   next to the cursor instead of the window's empty lower half pushing
   it far away when it flips above a low cursor. Measures the bottom
   of the last child of the active scroll container (its rect is in
   window coordinates, so it is the content height whether the content
   is shorter or taller than the window), plus the container's bottom
   padding. There is no fixed cap here: the window takes all the room
   its content needs, and main clamps it to the work area, so a tall
   tree is never cropped.
   Reports to main, which resizes the window. */
const PANEL_MIN_H = 140;
const PANEL_MAX_H = 560; /* default height when nothing is measurable */
function measureContentHeight() {
  /* Measure whichever view is showing — the tree, the calendar
     grid, or the week journal. The hidden views' rects are all
     zero, so it must be the visible one. */
  const view = bubbleViewMode === "calendar" ? $("calendarView")
    : bubbleViewMode === "week" ? $("weekView") : $("bubbleTree");
  if (!view || !view.lastElementChild) return PANEL_MAX_H;
  const bottom = view.lastElementChild.getBoundingClientRect().bottom;
  if (!Number.isFinite(bottom) || bottom <= 0) return PANEL_MAX_H;
  return Math.max(PANEL_MIN_H, Math.ceil(bottom) + 16);
}
function reportContentHeight() {
  /* The settings window is a normal resizable window; it never
     reports a height — only the bubble's height fits the panel. */
  if (IS_SETTINGS_WINDOW) return;
  try { window.sideshow.reportContentHeight(measureContentHeight()); } catch (e) { /* main keeps its height */ }
}

/* ---------- drag from anywhere on the panel ---------- */

/* A pointerdown anywhere on the panel starts a potential drag — root,
   event/value bubbles, header buttons, calendar cells — using the
   same 4px threshold and the same dragStart/dragMove/dragEnd IPC
   path, so "Remember spot" keeps working. One path for mouse, touch,
   and pen (Pointer Events); no separate touch handlers. Text inputs
   are excluded so the header search box stays clickable and typeable;
   the settings window is a normal window and never drags this way.
   A drag must not also fire the click under it (copy, expand,
   hide, open), so the click that follows a drag is swallowed; the
   flag clears on the next pointerdown, which can only come after
   that click would already have fired. A tap (pointerup without
   movement) is a click: element handlers fire as normal.
   pointercancel (the browser takes over for a scroll) aborts the
   drag without the root toggle — a swipe that scrolls must not also
   open or close an event. Only the pointer that started the drag
   can move or end it, so a second finger never interferes. */
let dragState = null;
let suppressClickAfterDrag = false;
document.addEventListener("pointerdown", (e) => {
  suppressClickAfterDrag = false;
  if (IS_SETTINGS_WINDOW) return;
  if (e.button !== 0) return;
  const info = classifyDragTarget(e.target);
  if (!info.start) return;
  dragState = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, raf: null, fromRoot: info.fromRoot, inScrollArea: info.inScrollArea };
  window.sideshow.dragStart();
  /* While a drag is active, hover magnification is off (the
     is-dragging class): the view must move, never grow, while the
     pointer crosses bubbles. */
  const bv = $("bubbleView");
  if (bv) bv.classList.add("is-dragging");
  /* The root bubble keeps its old behavior (no focus steal); other
     elements keep theirs (a value still focuses on click). */
  if (info.fromRoot) e.preventDefault();
});
document.addEventListener("click", (e) => {
  if (!suppressClickAfterDrag) return;
  suppressClickAfterDrag = false;
  e.stopPropagation();
  e.preventDefault();
}, true);
function endPanelDrag(allowToggle) {
  if (!dragState) return;
  const wasDrag = dragState.moved;
  const fromRoot = dragState.fromRoot;
  if (dragState.raf) cancelAnimationFrame(dragState.raf);
  dragState = null;
  const bv = $("bubbleView");
  if (bv) bv.classList.remove("is-dragging");
  window.sideshow.dragEnd(wasDrag);
  if (wasDrag) suppressClickAfterDrag = true;
  /* Click without a drag on the root bubble toggles the focused
     event open/closed. Only the root does this — clicks elsewhere
     already have their own handlers. A cancelled gesture (scroll
     takeover) never toggles. */
  else if (allowToggle && fromRoot) {
    if (focusedEvent) { focusedEvent = null; render(); }
    else if (events.length) { focusedEvent = events[0]; playTickSound(); render(); }
  }
  resetIdleTimer(); /* the drag's last movement restarts the idle clock */
}
document.addEventListener("pointermove", (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  /* Button released outside the window: no pointerup arrives, so end
     the drag here instead of moving the panel on plain hover. */
  if (!(e.buttons & 1)) { endPanelDrag(true); return; }
  dragState.dx = e.clientX - dragState.startX;
  dragState.dy = e.clientY - dragState.startY;
  /* A touch swipe that starts in the tree or calendar and runs
     vertical is a scroll, not a window drag — the browser cancels
     the pointer stream for it, but the window must not nudge in
     the meantime. Horizontal touch drags there still move it. */
  if (isDragMovement(dragState.dx, dragState.dy) && shouldEngageDrag(e.pointerType, dragState.inScrollArea, dragState.dx, dragState.dy)) dragState.moved = true;
  if (dragState.moved && !dragState.raf) {
    dragState.raf = requestAnimationFrame(() => {
      dragState.raf = null;
      if (dragState) window.sideshow.dragMove(dragState.dx, dragState.dy);
    });
  }
});
document.addEventListener("pointerup", (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  endPanelDrag(true);
});
document.addEventListener("pointercancel", (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  endPanelDrag(false);
});

/* ---------- transparent window: click-through ---------- */

/* The window is transparent, so clicks on empty space must reach the
   desktop (ignore=true, forwarded). Clicks on a bubble, a button, or
   the settings card must reach the app (ignore=false). Only send IPC
   when the state changes. */
const CLICKABLE_SELECTOR = "button, input, select, .bubble, .value-bubble, .settings-view, a, .bubble-header, .bubble-tree, .calendar-view";
let ignoreMouseState = null;
function updateIgnoreMouse(x, y) {
  /* The settings window is a normal window; the panel's
     click-through state is the bubble's business only. */
  if (IS_SETTINGS_WINDOW) return;
  const el = document.elementFromPoint(x, y);
  const overInteractive = !!(el && el.closest && el.closest(CLICKABLE_SELECTOR));
  const ignore = !overInteractive;
  if (ignore !== ignoreMouseState) {
    ignoreMouseState = ignore;
    window.sideshow.setIgnoreMouseEvents(ignore);
  }
}
let mouseMoveRaf = null;
let lastMousePos = null;
document.addEventListener("mousemove", (e) => {
  lastMousePos = { x: e.clientX, y: e.clientY };
  if (mouseMoveRaf) return;
  mouseMoveRaf = requestAnimationFrame(() => {
    mouseMoveRaf = null;
    if (lastMousePos) updateIgnoreMouse(lastMousePos.x, lastMousePos.y);
  });
});
document.addEventListener("mouseleave", () => { lastMousePos = null; });

/* ---------- Google Calendar events (opt-in, never blocks the bubble) ---------- */

/* Save the merged list as the offline cache, whenever live data
   arrives. The cache is only written from live data — never from
   the cache itself — so a stale cache can never overwrite a fresh
   one. */
async function saveEventCache() {
  if (!signedIn || !events.length) return;
  try { await window.sideshow.setCachedEvents({ savedAt: Date.now(), events }); } catch (e) { /* cache not saved */ }
}

/* Rebuild the merged list: Main Eventer events first, then deduped
   calendar events. Re-renders and re-syncs the badge/reminders. */
function recomputeEvents() {
  events = mergeEvents(meEvents, calEvents);
  if (focusedEvent && !events.some((e) => e._id === focusedEvent._id)) focusedEvent = null;
  /* Live data arrived: the tree is live again, not cached. */
  if (cachedMode) { cachedMode = false; setStatus(""); }
  render();
  if (IS_SETTINGS_WINDOW) renderEventsList();
  syncEventsToMain();
  saveEventCache();
}

/* Fetch the selected calendars' events (forced when the toggle or
   selection changes, otherwise only if the last fetch is over 5
   minutes old). Main Eventer events render immediately; calendar
   events join when they arrive. A failure leaves only the Main
   Eventer events — the bubble never waits on the calendar. */
async function loadCalendarEvents(force) {
  if (!calSetting.enabled || !calSetting.selectedIds.length) {
    if (calEvents.length) { calEvents = []; recomputeEvents(); }
    return;
  }
  if (!force && calLastFetchAt && Date.now() - calLastFetchAt < CAL_FETCH_STALE_MS) return;
  let res;
  try {
    res = await window.sideshow.getCalendarEvents(calSetting.selectedIds);
  } catch (e) {
    return; /* calendar unavailable; Main Eventer events stand alone */
  }
  if (!res || !res.ok) {
    if (res && res.error === "scope-missing") calScopeMissing = true;
    return;
  }
  calScopeMissing = false;
  calLastFetchAt = Date.now();
  calEvents = (res.events || []).map((ev) => calendarEventToRecord(ev, ev.calendarId));
  recomputeEvents();
}

function maybeRefreshCalendarEvents() {
  if (calSetting.enabled && calSetting.selectedIds.length) loadCalendarEvents(false);
}

/* ---------- send the saved events to main (badge + reminders) ---------- */

function syncEventsToMain() {
  try {
    /* Hidden events stay out of the badge + reminders too — hidden
       means out of sight, not just out of the tree. */
    const list = events.filter((ev) => !hiddenIds.has(ev._id)).map((ev) => ({
      id: ev._id || null,
      title: ev.title || "",
      date: ev.date || "",
      startTime: ev.startTime || "",
    }));
    window.sideshow.eventsUpdated(list);
  } catch (e) { /* badge/reminders skipped; panel still works */ }
}

/* Open one event by id (from a reminder notification click): expand
   it and scroll it into view. */
function openEventById(id) {
  if (!id) return;
  const ev = events.find((e) => e._id === id);
  if (!ev) return;
  /* A reminder opens the branch in the tree, even from the calendar. */
  if (bubbleViewMode !== "tree") { bubbleViewMode = "tree"; applyViewMode(); }
  focusedEvent = ev;
  render();
  const card = document.querySelector("#bubbleTree .event-branch.expanded");
  if (card) card.scrollIntoView({ block: "nearest" });
}

/* ---------- single-key shortcuts ---------- */

/* While the panel is open, pressing a letter copies that field from
   the expanded event. C copies all of the event's details. Never
   fires while capturing a hotkey, a double-tap key, a gesture, or a
   long-click, and never in the settings view. */
function handleSingleKey(e) {
  if (currentView !== "bubble") return;
  if (bubbleViewMode !== "tree") return; /* no value bubbles in the calendar or week view */
  if (capturingHotkey || capturingDoubleTap || recordingGesture || recordingLongClick) return;
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = (e.key || "").toLowerCase();
  if (!focusedEvent) return;
  if (key === COPY_ALL_KEY) {
    e.preventDefault();
    const all = document.querySelector('.copy-all-bubble[data-key="c"]');
    copyValue(copyAllText(focusedEvent, copyAllFormat), all);
    return;
  }
  if (SINGLE_KEYS.indexOf(key) < 0) return;
  const value = fieldValueForKey(focusedEvent, key);
  if (!value) return;
  e.preventDefault();
  const vb = document.querySelector('.value-bubble[data-key="' + key + '"]');
  copyValue(value, vb);
}

/* ---------- firebase + events ---------- */

function subscribe() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!db) return;
  setState("loading");
  const q = query(collection(db, COLLECTION), orderBy("updatedAt", "desc"), limit(50));
  unsubscribe = onSnapshot(q, (snap) => {
    meEvents = [];
    snap.forEach((doc) => meEvents.push(Object.assign({ _id: doc.id }, doc.data())));
    recomputeEvents();
    maybeRefreshCalendarEvents();
  }, () => {
    /* No network (or another fetch failure): keep showing the last
       fetched events and say so — the tree stays useful offline.
       With nothing fetched yet, the error state stands. */
    if (events.length) {
      cachedMode = true;
      setStatus("Showing cached events");
      setState("list");
      render();
      return;
    }
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

/* Sign in with the ID token main obtained via the desktop OAuth flow.
   The OAuth client secret never reaches the renderer. */
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
  /* Hidden + pinned ids first, before the snapshot subscribes —
     otherwise the first render can flash events the user hid. */
  try {
    const h = await window.sideshow.getHiddenEvents();
    if (Array.isArray(h)) hiddenIds = new Set(h);
  } catch (e) { /* hidden list stays empty */ }
  try {
    const p = await window.sideshow.getPinnedEvents();
    if (Array.isArray(p)) pinnedIds = new Set(p);
  } catch (e) { /* pinned list stays empty */ }
  /* Cached events render immediately, before the live fetch lands —
     the tree is useful the moment the panel opens, even offline.
     The status line says they are cached until live data arrives
     and replaces them. */
  try {
    const c = await window.sideshow.getCachedEvents();
    if (c && Array.isArray(c.events) && c.events.length) {
      events = c.events;
      cachedMode = true;
      setStatus("Showing cached events");
      render();
    }
  } catch (e) { /* no cache; the live fetch fills the tree */ }
  const st = await window.sideshow.configStatus();
  if (!st.hasConfig) { setState("config"); return; }
  const fbConfig = await window.sideshow.firebaseConfig();
  if (!fbConfig) { setState("config"); return; }
  initializeApp(fbConfig);
  auth = getAuth();
  db = getFirestore();
  onAuthStateChanged(auth, (user) => {
    signedIn = !!user && ALLOWLIST.indexOf((user.email || "").toLowerCase()) >= 0;
    updateAuthUI(user);
    if (user) {
      const email = (user.email || "").toLowerCase();
      if (ALLOWLIST.indexOf(email) < 0) {
        signOut(auth);
        window.sideshow.signOut();
        setStatus("That Google account is not on the studio list.");
        setState("signin");
        render();
        return;
      }
      subscribe();
    } else {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      meEvents = [];
      calEvents = [];
      calLastFetchAt = 0;
      focusedEvent = null;
      setState("signin");
      render();
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
  /* Calendar setting (off by default) — loaded once so the bubble
     can refresh calendar events when the panel is shown. */
  try {
    const c = await window.sideshow.getCalendar();
    if (c) calSetting = { enabled: !!c.enabled, selectedIds: Array.isArray(c.selectedIds) ? c.selectedIds : [] };
  } catch (e) { /* calendar stays off */ }
}

/* ---------- settings view ---------- */

async function refreshSettingsUI() {
  try {
    const hk = await window.sideshow.getHotkey();
    const btn = $("hotkeyBtn");
    if (btn && !capturingHotkey) btn.textContent = friendlyHotkey(hk);
  } catch (e) { /* hotkey display stays as-is */ }
  try {
    const key = await window.sideshow.getDoubleTapKey();
    const btn = $("doubletapBtn");
    if (btn && !capturingDoubleTap) btn.textContent = key || "Shift";
  } catch (e) { /* double-tap display stays as-is */ }
  try {
    const g = await window.sideshow.getGesture();
    const btn = $("gestureBtn");
    const clearBtn = $("gestureClearBtn");
    if (btn) btn.textContent = g.available ? (g.label || "None") : "Unavailable";
    if (clearBtn) clearBtn.style.display = g.gesture ? "" : "none";
    if (btn) btn.disabled = !g.available;
  } catch (e) { /* gesture display stays as-is */ }
  try {
    const res = await window.sideshow.getLongClick();
    const btn = $("longclickBtn");
    const clearBtn = $("longclickClearBtn");
    if (btn) btn.textContent = res && res.available ? (res.label || "None") : "Unavailable";
    if (clearBtn) clearBtn.style.display = res && res.config ? "" : "none";
    if (btn) btn.disabled = !(res && res.available);
  } catch (e) { /* long-click display stays as-is */ }
  try {
    const on = await window.sideshow.getSound();
    soundOn = !!on;
    const btn = $("soundBtn");
    if (btn) btn.innerHTML = soundOn ? SOUND_ON_SVG : SOUND_OFF_SVG;
  } catch (e) { /* sound stays on */ }
  try {
    const style = await window.sideshow.getSoundStyle();
    if (style) soundStyle = style;
    const btn = $("soundStyleBtn");
    if (btn) btn.textContent = SOUND_STYLE_LABELS[soundStyle] || "Bubbly";
  } catch (e) { /* sound style stays Bubbly */ }
  try {
    const fmt = await window.sideshow.getCopyAllFormat();
    if (fmt) copyAllFormat = fmt;
    const btn = $("copyAllFormatBtn");
    if (btn) btn.textContent = COPY_ALL_FORMAT_LABELS[copyAllFormat] || "Labeled";
  } catch (e) { /* copy-all format stays Labeled */ }
  try {
    const on = await window.sideshow.getTooltips();
    tooltipsOn = on !== false;
    const btn = $("tooltipsBtn");
    if (btn) btn.textContent = tooltipsOn ? "On" : "Off";
    applyTooltips();
  } catch (e) { /* tooltips stay on */ }
  try {
    motionSetting = await window.sideshow.getMotion();
    const btn = $("motionBtn");
    if (btn) btn.textContent = motionButtonLabel();
    applyMotion();
  } catch (e) { /* motion follows the OS */ }
  try {
    remindersOn = await window.sideshow.getReminders();
    const btn = $("remindersBtn");
    if (btn) btn.innerHTML = remindersOn ? BELL_ON_SVG : BELL_OFF_SVG;
  } catch (e) { /* reminders stay off */ }
  try {
    const lead = await window.sideshow.getReminderLead();
    if (typeof lead === "number") reminderLead = lead;
    const btn = $("reminderLeadBtn");
    if (btn) btn.textContent = reminderLead + " min before";
    /* The lead-time row only shows while reminders are on — it has
       nothing to set while they are off. */
    const row = $("reminderLeadRow");
    if (row) row.hidden = !remindersOn;
  } catch (e) { /* reminder lead stays 15 min */ }
  try {
    accentSettingValue = await window.sideshow.getAccent();
    applyAccent();
    buildAccentSwatches();
  } catch (e) { /* accent stays platform default */ }
  try {
    const a = await window.sideshow.getAppearance();
    if (a) appearanceSetting = a;
    const t = await window.sideshow.getTransparency();
    if (typeof t === "number") transparencySetting = t;
    applyAppearance();
  } catch (e) { /* appearance stays Liquid Glass, middle */ }
  try {
    const p = await window.sideshow.getPosition();
    if (p && p.mode) positionSetting = Object.assign({}, positionSetting, p);
    const btn = $("positionBtn");
    if (btn) btn.textContent = POSITION_LABELS[positionSetting.mode] || "Follow cursor";
    const widthSlider = $("panelWidthSlider");
    if (widthSlider) widthSlider.value = String(positionSetting.width);
    const widthValue = $("panelWidthValue");
    if (widthValue) widthValue.textContent = positionSetting.width + "px";
    const displayBtn = $("panelDisplayBtn");
    if (displayBtn) displayBtn.textContent = PANEL_DISPLAY_LABELS[positionSetting.display] || "Display with cursor";
    const gapSlider = $("cursorGapSlider");
    if (gapSlider) gapSlider.value = String(positionSetting.gap);
    const gapValue = $("cursorGapValue");
    if (gapValue) gapValue.textContent = positionSetting.gap + "px";
    const resetBtn = $("resetSpotBtn");
    if (resetBtn) resetBtn.disabled = !positionSetting.custom;
    const dismissBtn = $("dismissBtn");
    if (dismissBtn) dismissBtn.textContent = DISMISS_LABELS[positionSetting.dismiss] || "Stay until closed";
    resetIdleTimer();
  } catch (e) { /* position stays Follow cursor */ }
  try {
    const b = await window.sideshow.getBubbleOptions();
    if (b) bubbleOptions = normalizeBubbleOptions(b);
    applyBubbleOptions();
    render(); /* per-field styling applies when the bubbles render */
  } catch (e) { /* bubble options stay at defaults */ }
  try {
    const c = await window.sideshow.getCalendar();
    if (c) calSetting = { enabled: !!c.enabled, selectedIds: Array.isArray(c.selectedIds) ? c.selectedIds : [] };
    const btn = $("calendarToggleBtn");
    if (btn) btn.textContent = calSetting.enabled ? "On" : "Off";
    const picker = $("calendarPicker");
    if (picker) picker.hidden = !calSetting.enabled;
  } catch (e) { /* calendar toggle stays as-is */ }
  try {
    const h = await window.sideshow.getHiddenEvents();
    if (Array.isArray(h)) hiddenIds = new Set(h);
    const p = await window.sideshow.getPinnedEvents();
    if (Array.isArray(p)) pinnedIds = new Set(p);
    render();
    if (IS_SETTINGS_WINDOW) renderEventsList();
  } catch (e) { /* hidden list stays as-is */ }
}

/* Google Calendar picker: the user's calendars with a checkbox each.
   Populated only while the settings view is open. The loading state
   lives here in the settings row — the bubble never waits on it. If
   the stored sign-in predates the calendar scope, the row says to
   sign in again instead of listing calendars. */
async function refreshCalendarPicker() {
  const list = $("calendarList");
  const status = $("calendarPickerStatus");
  const picker = $("calendarPicker");
  if (!list || !status || !picker) return;
  if (!calSetting.enabled) { picker.hidden = true; return; }
  picker.hidden = false;
  if (calScopeMissing) {
    list.innerHTML = "";
    status.textContent = "Sign in again to allow Calendar access.";
    return;
  }
  calPickerLoading = true;
  status.textContent = "Loading calendars…";
  list.innerHTML = "";
  let res;
  try {
    res = await window.sideshow.listCalendars();
  } catch (e) {
    res = null;
  }
  calPickerLoading = false;
  if (!res || !res.ok) {
    if (res && res.error === "scope-missing") {
      calScopeMissing = true;
      status.textContent = "Sign in again to allow Calendar access.";
    } else if (res && res.error === "not-signed-in") {
      status.textContent = "Sign in to see your calendars.";
    } else {
      status.textContent = "Could not load calendars.";
    }
    return;
  }
  calScopeMissing = false;
  const calendars = res.calendars || [];
  if (!calendars.length) {
    status.textContent = "No calendars found.";
    return;
  }
  status.textContent = "";
  calendars.forEach((cal) => {
    const label = document.createElement("label");
    label.className = "calendar-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = calSetting.selectedIds.indexOf(cal.id) >= 0;
    box.addEventListener("change", async () => {
      if (box.checked) {
        if (calSetting.selectedIds.indexOf(cal.id) < 0) calSetting.selectedIds.push(cal.id);
      } else {
        calSetting.selectedIds = calSetting.selectedIds.filter((id) => id !== cal.id);
      }
      try { await window.sideshow.setCalendar(calSetting); } catch (e) { /* stays local */ }
      calLastFetchAt = 0;
      loadCalendarEvents(true);
    });
    const dot = document.createElement("span");
    dot.className = "calendar-dot";
    if (cal.backgroundColor) dot.style.background = cal.backgroundColor;
    const name = document.createElement("span");
    name.className = "calendar-name";
    name.textContent = cal.summary + (cal.primary ? " (primary)" : "");
    label.appendChild(box);
    label.appendChild(dot);
    label.appendChild(name);
    list.appendChild(label);
  });
}

/* ---------- wiring ---------- */

document.addEventListener("DOMContentLoaded", () => {
  const platform = (window.sideshow && window.sideshow.platform) || "";
  if (platform) document.documentElement.classList.add("platform-" + platform);
  /* Apply the OS reduced-motion preference immediately (before the
     saved setting loads); refreshSettingsUI refines it after. */
  applyMotion();
  applyAccent();
  buildAccentSwatches();
  buildPresetButtons();
  applyAppearance();
  /* Bubble options: swatch rows + the per-field outline are built
     once from the defaults; refreshSettingsUI loads the saved
     values and re-applies them. */
  buildColorSwatches("borderSwatches", () => bubbleOptions.borderColor, async (v) => { bubbleOptions.borderColor = v; await saveBubbleOptions(); applyBubbleOptions(); });
  buildColorSwatches("bgSwatches", () => bubbleOptions.bgColor, async (v) => { bubbleOptions.bgColor = v; await saveBubbleOptions(); applyBubbleOptions(); });
  buildColorSwatches("textColorSwatches", () => bubbleOptions.textColor, async (v) => { bubbleOptions.textColor = v; await saveBubbleOptions(); applyBubbleOptions(); });
  buildColorSwatches("iconSwatches", () => bubbleOptions.iconColor, async (v) => { bubbleOptions.iconColor = v; await saveBubbleOptions(); applyBubbleOptions(); });
  buildColorSwatches("scrollbarSwatches", () => bubbleOptions.scrollbarColor, async (v) => { bubbleOptions.scrollbarColor = v; await saveBubbleOptions(); applyBubbleOptions(); });
  buildFieldOutline();
  applyBubbleOptions();
  /* Settings controls: the row's label names what the control does,
     so it is the tooltip for every button/slider/input in the row
     that has no more specific tooltip. Tabs get their own name. */
  document.querySelectorAll(".settings-tab").forEach((b) => {
    if (!b.hasAttribute("data-tip")) b.dataset.tip = (b.textContent || "").trim();
  });
  document.querySelectorAll(".settings-tab-panel .setting").forEach((row) => {
    const label = row.querySelector(".setting-label");
    if (!label) return;
    const tip = (label.textContent || "").trim();
    row.querySelectorAll("button, input, select").forEach((el) => {
      if (!el.hasAttribute("data-tip") && !el.dataset.tipText) el.dataset.tip = tip;
    });
  });
  applyTooltips(); /* static hover tooltips (data-tip) — the saved
    Tooltips setting refines them in refreshSettingsUI */
  const bubbleViewEl = $("bubbleView");
  if (bubbleViewEl) bubbleViewEl.addEventListener("animationend", (e) => {
    if (e.animationName === "inflate" || e.animationName === "inflate-subtle") bubbleViewEl.classList.remove("inflate");
  });
  try {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (!motionSetting) applyMotion(); });
  } catch (e) { /* media query listener unavailable */ }
  try {
    const dm = window.matchMedia("(prefers-color-scheme: dark)");
    if (dm && dm.addEventListener) dm.addEventListener("change", () => applyAccent());
  } catch (e) { /* color-scheme listener unavailable */ }

  const signInBtn = $("signInBtn");
  if (signInBtn) signInBtn.addEventListener("click", () => window.sideshow.signIn());
  const signOutBtn = $("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", async () => {
    if (auth) await signOut(auth);
    await window.sideshow.signOut();
  });
  const closeBtn = $("closeBtn");
  if (closeBtn) closeBtn.addEventListener("click", () => window.sideshow.hide());
  const settingsBtn = $("settingsBtn");
  if (settingsBtn) settingsBtn.addEventListener("click", () => { playTickSound(); window.sideshow.openSettings(); });
  /* Header search: typing filters the event bubbles live. The input
     lives in the header, outside the tree, so re-rendering the tree
     never steals its focus. */
  const searchInput = $("searchInput");
  if (searchInput) searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    render();
  });
  /* The settings window's X closes the settings window, not the
     bubble; Esc does the same (see the keydown handler). */
  const settingsCloseBtn = $("settingsCloseBtn");
  if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", () => window.sideshow.closeSettings());
  const cfgBtn = $("openConfigBtn");
  if (cfgBtn) cfgBtn.addEventListener("click", () => window.sideshow.openConfigFolder());

  /* Hotkey — click, then press a new combination. */
  const hotkeyBtn = $("hotkeyBtn");
  if (hotkeyBtn) hotkeyBtn.addEventListener("click", () => {
    if (capturingHotkey) return;
    capturingHotkey = true;
    hotkeyBtn.textContent = "Press keys…";
    hotkeyBtn.classList.add("listening");
  });

  /* Double-tap — tap a modifier key (Shift / Control / Alt / Meta). */
  const doubletapBtn = $("doubletapBtn");
  if (doubletapBtn) doubletapBtn.addEventListener("click", async () => {
    if (capturingDoubleTap) return;
    capturingDoubleTap = true;
    doubletapBtn.textContent = "Tap a key…";
    doubletapBtn.classList.add("listening");
    try {
      const res = await window.sideshow.captureDoubleTapKey();
      if (res && res.ok) {
        doubletapBtn.textContent = res.key;
        flashSaved(doubletapBtn);
      } else {
        setStatus((res && res.error) || "Could not capture a key.");
        await refreshSettingsUI();
      }
    } catch (e) {
      setStatus("Could not capture a key.");
      await refreshSettingsUI();
    }
    capturingDoubleTap = false;
    doubletapBtn.classList.remove("listening");
  });

  /* Gesture — record, or clear. */
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

  /* Long-click — record a hold (button + length), or clear. */
  const longclickBtn = $("longclickBtn");
  if (longclickBtn) longclickBtn.addEventListener("click", async () => {
    if (recordingLongClick) return;
    recordingLongClick = true;
    longclickBtn.textContent = "Hold a mouse button…";
    longclickBtn.classList.add("listening");
    longclickBtn.disabled = true;
    try {
      const res = await window.sideshow.recordLongClick();
      if (res && res.ok) {
        longclickBtn.textContent = res.label || "Saved";
        flashSaved(longclickBtn);
        const clearBtn = $("longclickClearBtn");
        if (clearBtn) clearBtn.style.display = "";
      } else {
        setStatus((res && res.error) || "Could not record a hold.");
        await refreshSettingsUI();
      }
    } catch (e) {
      setStatus("Could not record a hold.");
      await refreshSettingsUI();
    }
    recordingLongClick = false;
    longclickBtn.classList.remove("listening");
    longclickBtn.disabled = false;
  });
  const longclickClearBtn = $("longclickClearBtn");
  if (longclickClearBtn) longclickClearBtn.addEventListener("click", async () => {
    await window.sideshow.clearLongClick();
    await refreshSettingsUI();
  });

  /* Sound / motion / reminders. */
  const soundBtn = $("soundBtn");
  if (soundBtn) soundBtn.addEventListener("click", async () => {
    soundOn = !soundOn;
    try { await window.sideshow.setSound(soundOn); } catch (e) { /* stays local */ }
    soundBtn.innerHTML = soundOn ? SOUND_ON_SVG : SOUND_OFF_SVG;
    if (soundOn) playCopySound();
  });
  /* Sound style — tap to cycle the sound set. Changing it plays one
     short sample of the set's copy sound, so it can be heard. */
  const soundStyleBtn = $("soundStyleBtn");
  if (soundStyleBtn) soundStyleBtn.addEventListener("click", async () => {
    soundStyle = SOUND_STYLE_CYCLE[(SOUND_STYLE_CYCLE.indexOf(soundStyle) + 1) % SOUND_STYLE_CYCLE.length];
    try { await window.sideshow.setSoundStyle(soundStyle); } catch (e) { /* stays local */ }
    soundStyleBtn.textContent = SOUND_STYLE_LABELS[soundStyle] || "Bubbly";
    if (soundOn) playCopySound();
    flashSaved(soundStyleBtn);
  });
  /* Copy all format — tap to cycle Labeled / Plain. */
  const copyAllFormatBtn = $("copyAllFormatBtn");
  if (copyAllFormatBtn) copyAllFormatBtn.addEventListener("click", async () => {
    copyAllFormat = copyAllFormat === "labeled" ? "plain" : "labeled";
    try { await window.sideshow.setCopyAllFormat(copyAllFormat); } catch (e) { /* stays local */ }
    copyAllFormatBtn.textContent = COPY_ALL_FORMAT_LABELS[copyAllFormat] || "Labeled";
    flashSaved(copyAllFormatBtn);
  });
  /* Tooltips — tap to turn the hover tooltips on or off. */
  const tooltipsBtn = $("tooltipsBtn");
  if (tooltipsBtn) tooltipsBtn.addEventListener("click", async () => {
    tooltipsOn = !tooltipsOn;
    try { await window.sideshow.setTooltips(tooltipsOn); } catch (e) { /* stays local */ }
    tooltipsBtn.textContent = tooltipsOn ? "On" : "Off";
    applyTooltips();
    render();
    flashSaved(tooltipsBtn);
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
    remindersBtn.innerHTML = remindersOn ? BELL_ON_SVG : BELL_OFF_SVG;
    const row = $("reminderLeadRow");
    if (row) row.hidden = !remindersOn;
    flashSaved(remindersBtn);
    if (remindersOn) syncEventsToMain();
  });
  /* Reminder lead time — tap to cycle 5 / 15 / 30 / 60 minutes
     before an event starts. Changing it
     reschedules the reminders from the current event list. */
  const reminderLeadBtn = $("reminderLeadBtn");
  if (reminderLeadBtn) reminderLeadBtn.addEventListener("click", async () => {
    reminderLead = REMINDER_LEAD_OPTIONS[(REMINDER_LEAD_OPTIONS.indexOf(reminderLead) + 1) % REMINDER_LEAD_OPTIONS.length];
    try { await window.sideshow.setReminderLead(reminderLead); } catch (e) { /* stays local */ }
    reminderLeadBtn.textContent = reminderLead + " min before";
    flashSaved(reminderLeadBtn);
    if (remindersOn) syncEventsToMain();
  });
  const helpBtn = $("helpBtn");
  if (helpBtn) helpBtn.addEventListener("click", () => window.sideshow.openHelp());

  /* Position — tap to cycle where the bubble opens. "Remember spot"
     opens where the bubble was last dragged to (drag it in the bubble
     view); with no spot saved yet it follows the cursor. */
  const positionBtn = $("positionBtn");
  if (positionBtn) positionBtn.addEventListener("click", async () => {
    const next = POSITION_MODES[(POSITION_MODES.indexOf(positionSetting.mode) + 1) % POSITION_MODES.length];
    positionSetting = Object.assign({}, positionSetting, { mode: next });
    try { await window.sideshow.setPosition(positionSetting); } catch (e) { /* stays local */ }
    positionBtn.textContent = POSITION_LABELS[next] || "Follow cursor";
    flashSaved(positionBtn);
  });

  /* Panel width — slider, live preview (main resizes the window
     in place, no reload). */
  const panelWidthSlider = $("panelWidthSlider");
  if (panelWidthSlider) {
    panelWidthSlider.addEventListener("input", async () => {
      positionSetting = Object.assign({}, positionSetting, { width: Number(panelWidthSlider.value) });
      const v = $("panelWidthValue");
      if (v) v.textContent = positionSetting.width + "px";
      try { await window.sideshow.setPosition(positionSetting); } catch (e) { /* stays local */ }
    });
    panelWidthSlider.addEventListener("change", async () => { await refreshSettingsUI(); });
  }
  /* Which display — tap to cycle between the cursor's display and
     the primary display. */
  const panelDisplayBtn = $("panelDisplayBtn");
  if (panelDisplayBtn) panelDisplayBtn.addEventListener("click", async () => {
    const next = positionSetting.display === "primary" ? "cursor" : "primary";
    positionSetting = Object.assign({}, positionSetting, { display: next });
    try { await window.sideshow.setPosition(positionSetting); } catch (e) { /* stays local */ }
    panelDisplayBtn.textContent = PANEL_DISPLAY_LABELS[next];
    flashSaved(panelDisplayBtn);
  });
  /* Gap from cursor — slider, live preview. */
  const cursorGapSlider = $("cursorGapSlider");
  if (cursorGapSlider) {
    cursorGapSlider.addEventListener("input", async () => {
      positionSetting = Object.assign({}, positionSetting, { gap: Number(cursorGapSlider.value) });
      const v = $("cursorGapValue");
      if (v) v.textContent = positionSetting.gap + "px";
      try { await window.sideshow.setPosition(positionSetting); } catch (e) { /* stays local */ }
    });
    cursorGapSlider.addEventListener("change", async () => { await refreshSettingsUI(); });
  }
  /* Reset remembered spot — clears the saved drag spot, so the next
     open reverts to the default placement. */
  const resetSpotBtn = $("resetSpotBtn");
  if (resetSpotBtn) resetSpotBtn.addEventListener("click", async () => {
    positionSetting = Object.assign({}, positionSetting, { custom: null });
    try { await window.sideshow.setPosition(positionSetting); } catch (e) { /* stays local */ }
    await refreshSettingsUI();
    flashSaved(resetSpotBtn);
  });
  /* Dismiss when idle — tap to cycle: stay until closed (default),
     or fade out after 5 / 10 / 30 seconds or 1 minute idle. */
  const dismissBtn = $("dismissBtn");
  if (dismissBtn) dismissBtn.addEventListener("click", async () => {
    const next = DISMISS_OPTIONS[(DISMISS_OPTIONS.indexOf(positionSetting.dismiss) + 1) % DISMISS_OPTIONS.length];
    positionSetting = Object.assign({}, positionSetting, { dismiss: next });
    try { await window.sideshow.setPosition(positionSetting); } catch (e) { /* stays local */ }
    dismissBtn.textContent = DISMISS_LABELS[next];
    resetIdleTimer();
    flashSaved(dismissBtn);
  });

  /* Google Calendar — toggle the "Show Google Calendar events"
     setting; when on, the picker below lists the user's calendars. */
  const calendarToggleBtn = $("calendarToggleBtn");
  if (calendarToggleBtn) calendarToggleBtn.addEventListener("click", async () => {
    calSetting.enabled = !calSetting.enabled;
    calendarToggleBtn.textContent = calSetting.enabled ? "On" : "Off";
    try { await window.sideshow.setCalendar(calSetting); } catch (e) { /* stays local */ }
    const picker = $("calendarPicker");
    if (picker) picker.hidden = !calSetting.enabled;
    if (calSetting.enabled) {
      refreshCalendarPicker();
      calLastFetchAt = 0;
      loadCalendarEvents(true);
    } else {
      calEvents = [];
      recomputeEvents();
    }
    flashSaved(calendarToggleBtn);
  });

  /* Appearance: Liquid Glass / Shaded / Transparent. */
  const appearanceGlassBtn = $("appearanceGlassBtn");
  if (appearanceGlassBtn) appearanceGlassBtn.addEventListener("click", async () => {
    appearanceSetting = "glass";
    try { await window.sideshow.setAppearance("glass"); } catch (e) { /* stays local */ }
    applyAppearance();
  });
  const appearanceShadedBtn = $("appearanceShadedBtn");
  if (appearanceShadedBtn) appearanceShadedBtn.addEventListener("click", async () => {
    appearanceSetting = "shaded";
    try { await window.sideshow.setAppearance("shaded"); } catch (e) { /* stays local */ }
    applyAppearance();
  });
  const appearanceClearBtn = $("appearanceClearBtn");
  if (appearanceClearBtn) appearanceClearBtn.addEventListener("click", async () => {
    appearanceSetting = "clear";
    try { await window.sideshow.setAppearance("clear"); } catch (e) { /* stays local */ }
    applyAppearance();
  });
  const transparencySlider = $("transparencySlider");
  if (transparencySlider) {
    transparencySlider.addEventListener("input", () => {
      transparencySetting = Number(transparencySlider.value);
      applyAppearance();
    });
    transparencySlider.addEventListener("change", async () => {
      try { await window.sideshow.setTransparency(transparencySetting); } catch (e) { /* stays local */ }
    });
  }

  /* Settings tabs — just the tab names; the panel switches. */
  document.querySelectorAll(".settings-tab").forEach((b) => {
    b.addEventListener("click", () => switchSettingsTab(b.dataset.tab));
  });

  /* Bubble scale — a slider, 80–150%, live preview while dragging. */
  const scaleSlider = $("scaleSlider");
  if (scaleSlider) {
    scaleSlider.addEventListener("input", () => {
      bubbleOptions.scale = Number(scaleSlider.value);
      applyBubbleOptions();
    });
    scaleSlider.addEventListener("change", async () => { await saveBubbleOptions(); });
  }

  /* Font + weight — tap to cycle. */
  const fontBtn = $("fontBtn");
  if (fontBtn) fontBtn.addEventListener("click", async () => {
    bubbleOptions.font = FONT_CYCLE[(FONT_CYCLE.indexOf(bubbleOptions.font) + 1) % FONT_CYCLE.length];
    await saveBubbleOptions();
    applyBubbleOptions();
    flashSaved(fontBtn);
  });
  const weightBtn = $("weightBtn");
  if (weightBtn) weightBtn.addEventListener("click", async () => {
    bubbleOptions.weight = WEIGHT_CYCLE[(WEIGHT_CYCLE.indexOf(bubbleOptions.weight) + 1) % WEIGHT_CYCLE.length];
    await saveBubbleOptions();
    applyBubbleOptions();
    flashSaved(weightBtn);
  });

  /* Border / background / text color — custom color inputs (live
     preview while picking, saved on change). The swatch rows are
     built above. */
  const borderColorInput = $("borderColorInput");
  if (borderColorInput) {
    borderColorInput.addEventListener("input", () => {
      bubbleOptions.borderColor = borderColorInput.value;
      applyBubbleOptions();
    });
    borderColorInput.addEventListener("change", async () => { await saveBubbleOptions(); });
  }
  const bgColorInput = $("bgColorInput");
  if (bgColorInput) {
    bgColorInput.addEventListener("input", () => {
      bubbleOptions.bgColor = bgColorInput.value;
      applyBubbleOptions();
    });
    bgColorInput.addEventListener("change", async () => { await saveBubbleOptions(); });
  }
  const textColorInput = $("textColorInput");
  if (textColorInput) {
    textColorInput.addEventListener("input", () => {
      bubbleOptions.textColor = textColorInput.value;
      applyBubbleOptions();
    });
    textColorInput.addEventListener("change", async () => { await saveBubbleOptions(); });
  }
  const iconColorInput = $("iconColorInput");
  if (iconColorInput) {
    iconColorInput.addEventListener("input", () => {
      bubbleOptions.iconColor = iconColorInput.value;
      applyBubbleOptions();
    });
    iconColorInput.addEventListener("change", async () => { await saveBubbleOptions(); });
  }
  const scrollbarColorInput = $("scrollbarColorInput");
  if (scrollbarColorInput) {
    scrollbarColorInput.addEventListener("input", () => {
      bubbleOptions.scrollbarColor = scrollbarColorInput.value;
      applyBubbleOptions();
    });
    scrollbarColorInput.addEventListener("change", async () => { await saveBubbleOptions(); });
  }

  /* Shadow — toggle + strength slider (live preview). */
  const shadowBtn = $("shadowBtn");
  if (shadowBtn) shadowBtn.addEventListener("click", async () => {
    bubbleOptions.shadowOn = !bubbleOptions.shadowOn;
    await saveBubbleOptions();
    applyBubbleOptions();
    flashSaved(shadowBtn);
  });
  const shadowStrengthSlider = $("shadowStrengthSlider");
  if (shadowStrengthSlider) {
    shadowStrengthSlider.addEventListener("input", () => {
      bubbleOptions.shadowStrength = Number(shadowStrengthSlider.value);
      applyBubbleOptions();
    });
    shadowStrengthSlider.addEventListener("change", async () => { await saveBubbleOptions(); });
  }

  /* Corners — style cycle + pixel roundness slider (Smooth only). */
  const cornerStyleBtn = $("cornerStyleBtn");
  if (cornerStyleBtn) cornerStyleBtn.addEventListener("click", async () => {
    bubbleOptions.cornerStyle = CORNER_CYCLE[(CORNER_CYCLE.indexOf(bubbleOptions.cornerStyle) + 1) % CORNER_CYCLE.length];
    await saveBubbleOptions();
    applyBubbleOptions();
    flashSaved(cornerStyleBtn);
  });
  const cornerRadiusSlider = $("cornerRadiusSlider");
  if (cornerRadiusSlider) {
    cornerRadiusSlider.addEventListener("input", () => {
      bubbleOptions.cornerRadius = Number(cornerRadiusSlider.value);
      applyBubbleOptions();
    });
    cornerRadiusSlider.addEventListener("change", async () => { await saveBubbleOptions(); });
  }

  /* Branch alignment + gentle pulse — tap to cycle / toggle. */
  const alignBtn = $("alignBtn");
  if (alignBtn) alignBtn.addEventListener("click", async () => {
    bubbleOptions.align = ALIGN_CYCLE[(ALIGN_CYCLE.indexOf(bubbleOptions.align) + 1) % ALIGN_CYCLE.length];
    await saveBubbleOptions();
    applyBubbleOptions();
    flashSaved(alignBtn);
  });
  const pulseBtn = $("pulseBtn");
  if (pulseBtn) pulseBtn.addEventListener("click", async () => {
    bubbleOptions.pulse = !bubbleOptions.pulse;
    await saveBubbleOptions();
    applyBubbleOptions();
    flashSaved(pulseBtn);
  });

  /* Scrollbar width + thumb shape + entry separation — tap to cycle. */
  const scrollbarBtn = $("scrollbarBtn");
  if (scrollbarBtn) scrollbarBtn.addEventListener("click", async () => {
    bubbleOptions.scrollbar = SCROLLBAR_CYCLE[(SCROLLBAR_CYCLE.indexOf(bubbleOptions.scrollbar) + 1) % SCROLLBAR_CYCLE.length];
    await saveBubbleOptions();
    applyBubbleOptions();
    flashSaved(scrollbarBtn);
  });
  const scrollbarShapeBtn = $("scrollbarShapeBtn");
  if (scrollbarShapeBtn) scrollbarShapeBtn.addEventListener("click", async () => {
    bubbleOptions.scrollbarShape = SCROLLBAR_SHAPE_CYCLE[(SCROLLBAR_SHAPE_CYCLE.indexOf(bubbleOptions.scrollbarShape) + 1) % SCROLLBAR_SHAPE_CYCLE.length];
    await saveBubbleOptions();
    applyBubbleOptions();
    flashSaved(scrollbarShapeBtn);
  });
  const separationBtn = $("separationBtn");
  if (separationBtn) separationBtn.addEventListener("click", async () => {
    bubbleOptions.separation = SEPARATION_CYCLE[(SEPARATION_CYCLE.indexOf(bubbleOptions.separation) + 1) % SEPARATION_CYCLE.length];
    await saveBubbleOptions();
    applyBubbleOptions();
    render();
    flashSaved(separationBtn);
  });

  /* Tree / calendar / week toggle in the bubble header — cycles
     tree -> month -> week -> tree. */
  const calendarViewBtn = $("calendarViewBtn");
  if (calendarViewBtn) {
    updateViewButton();
    calendarViewBtn.addEventListener("click", () => {
      playTickSound();
      cycleViewMode();
    });
  }

  /* Keyboard: hotkey capture first, then Esc / single-key shortcuts. */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (IS_SETTINGS_WINDOW) { window.sideshow.closeSettings(); return; }
      /* Escape clears the search first (the panel stays open); a
         second Escape, with the search empty, hides it. */
      const searchInput = $("searchInput");
      if (searchInput && searchInput.value) {
        searchInput.value = "";
        searchQuery = "";
        render();
        searchInput.focus();
        return;
      }
      window.sideshow.hide();
      return;
    }
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

  window.sideshow.onOpenEvent((id) => openEventById(id));
  /* A fired reminder plays the current sound style's copy sound
     (main asks for it — main has no Web Audio). Sound off means the
     notification stays visual-only. */
  if (window.sideshow.onPlaySound) window.sideshow.onPlaySound(() => { if (soundOn) playCopySound(); });
  /* Panel lifecycle: sound + the initial click-through state, seeded
     from the cursor position main sends with the showing event. */
  window.sideshow.onPanelShowing((data) => {
    panelVisible = true;
    playOpenSound();
    maybeRefreshCalendarEvents();
    inflateBubble();
    /* Start interactive: the showing position may only ever turn
       input ON, never off. A stale cursor (tray-tap summon on a
       touchscreen) must not leave the panel click-through with no
       mouse to flip it back — the mousemove handler enables
       click-through once the pointer really moves over empty space. */
    ignoreMouseState = false;
    if (data && typeof data.x === "number" && typeof data.y === "number") {
      const el = document.elementFromPoint(data.x, data.y);
      if (el && el.closest && el.closest(CLICKABLE_SELECTOR)) updateIgnoreMouse(data.x, data.y);
    }
    resetIdleTimer(); /* the idle clock starts when the panel shows */
  });
  window.sideshow.onPanelHiding(() => {
    panelVisible = false;
    clearIdleTimer();
    playCloseSound();
    const bv = $("bubbleView");
    if (bv) bv.classList.remove("inflate");
  });
  /* The settings window opening or closing: while it is open the
     bubble is the live preview, so the idle auto-dismiss must not
     fire. When it closes, the clock restarts. */
  if (window.sideshow.onSettingsWindow) window.sideshow.onSettingsWindow((open) => {
    settingsWindowOpen = !!open;
    if (open) clearIdleTimer();
    else resetIdleTimer();
  });
  /* Idle clock activity: any interaction with the panel restarts
     it — pointer movement, clicks, taps, typing, scrolling,
     keyboard use. A still mouse counts as idle. */
  ["pointermove", "pointerdown", "click", "keydown", "input", "wheel"].forEach((type) => {
    document.addEventListener(type, notePanelActivity, { passive: true });
  });
  document.addEventListener("scroll", notePanelActivity, true);
  /* Live preview: a change made in the settings window reaches the
     bubble through main ("sideshow:settings-changed"). The bubble
     reloads that setting and re-applies it — no reload, no restart.
     The settings window never receives this (main sends it to the
     panel only); it applies its own changes locally. */
  if (!IS_SETTINGS_WINDOW) window.sideshow.onSettingsChanged(async (key) => {
    try {
      if (key === "appearance") {
        const a = await window.sideshow.getAppearance();
        if (a) appearanceSetting = a;
        const t = await window.sideshow.getTransparency();
        if (typeof t === "number") transparencySetting = t;
        applyAppearance();
      } else if (key === "bubble-options") {
        const b = await window.sideshow.getBubbleOptions();
        if (b) bubbleOptions = normalizeBubbleOptions(b);
        applyBubbleOptions();
        render();
      } else if (key === "position") {
        const p = await window.sideshow.getPosition();
        if (p && p.mode) positionSetting = Object.assign({}, positionSetting, p);
        refreshSettingsUI();
        resetIdleTimer();
      } else if (key === "motion") {
        motionSetting = await window.sideshow.getMotion();
        applyMotion();
      } else if (key === "accent") {
        accentSettingValue = await window.sideshow.getAccent();
        applyAccent();
      } else if (key === "sound-style") {
        const style = await window.sideshow.getSoundStyle();
        if (style) soundStyle = style;
        refreshSettingsUI();
      } else if (key === "copy-all-format") {
        const fmt = await window.sideshow.getCopyAllFormat();
        if (fmt) copyAllFormat = fmt;
        refreshSettingsUI();
      } else if (key === "tooltips") {
        const on = await window.sideshow.getTooltips();
        tooltipsOn = on !== false;
        applyTooltips();
        render();
        refreshSettingsUI();
      } else if (key === "calendar") {
        const c = await window.sideshow.getCalendar();
        if (c) calSetting = { enabled: !!c.enabled, selectedIds: Array.isArray(c.selectedIds) ? c.selectedIds : [] };
        calLastFetchAt = 0;
        if (calSetting.enabled) loadCalendarEvents(true);
        else { calEvents = []; recomputeEvents(); }
      } else if (key === "hidden-events") {
        const h = await window.sideshow.getHiddenEvents();
        if (Array.isArray(h)) hiddenIds = new Set(h);
        render();
      } else if (key === "pinned-events") {
        const p = await window.sideshow.getPinnedEvents();
        if (Array.isArray(p)) pinnedIds = new Set(p);
        render();
      }
    } catch (e) { /* preview update skipped; the bubble still works */ }
  });
  refreshSettingsUI();
  /* The settings window populates its calendar picker at startup;
     the bubble has no picker (its elements are absent, so this is
     a no-op there). */
  refreshCalendarPicker();
  /* Next up countdown: refresh in place every 30 seconds, so the
     countdown ticks without a re-render (which would steal the
     search box focus). */
  nextUpTimer = setInterval(refreshNextUpCountdown, 30000);
  init();
});
