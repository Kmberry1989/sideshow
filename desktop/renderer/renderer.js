"use strict";
/* Sideshow panel — the bubble. One floating outline bubble tree:
   Event Bank root -> event bubbles -> value bubbles (click to copy).
   Reads the saved Main Eventer events from Firestore (read-only).
   Settings live in a separate view, opened with the gear. */

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { eventTitle, eventWhen, eventMatches, fieldValueForKey } from "./fields.js";
import { calendarEventToRecord, mergeEvents } from "./calendar.js";
import {
  FIELD_KEYS, FIELD_LABELS, FONTS, FONT_LABELS, FONT_CYCLE,
  WEIGHTS, WEIGHT_LABELS, WEIGHT_CYCLE,
  CORNER_LABELS, CORNER_CYCLE, ALIGN_LABELS, ALIGN_CYCLE,
  normalizeBubbleOptions, rgba, readableInkFor,
} from "../bubble-options.js";

const ALLOWLIST = ["kylematthewberry@gmail.com", "rochelleberry731@gmail.com", "media@firedartsstudio.com"];
const COLLECTION = "mainEvent_events";
/* Single-key shortcuts (bubble view, expanded event): n name, d date,
   t time range, p price, a ages, h host, l location. */
const SINGLE_KEYS = ["n", "d", "t", "p", "a", "h", "l"];

const $ = (id) => document.getElementById(id);
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
let audioCtx = null;
let motionSetting = null; /* explicit user choice: "full"|"reduced"|"off"|null (follow OS) */
let remindersOn = true;
let accentSetting = null; /* null = platform default */
let appearanceSetting = "glass"; /* glass | shaded | clear */
let transparencySetting = 50; /* 0-100 */
let positionSetting = "cursor"; /* cursor | top-left | top-right | bottom-left | bottom-right | center | custom */
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
let currentView = "bubble"; /* bubble | settings */
let signedIn = false;

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
  root.classList.remove("corners-smooth", "corners-jagged", "corners-right");
  root.classList.add("corners-" + o.cornerStyle);
  root.style.setProperty("--corner-radius", o.cornerRadius + "px");
  /* Branch alignment. */
  root.classList.remove("align-left", "align-right", "align-middle", "align-center");
  root.classList.add("align-" + o.align);
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

const SETTINGS_TABS = ["position", "appearance", "text", "summon", "general"];
let settingsTab = "position";
function switchSettingsTab(name) {
  if (SETTINGS_TABS.indexOf(name) < 0) name = "position";
  settingsTab = name;
  document.querySelectorAll(".settings-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  SETTINGS_TABS.forEach((t) => {
    const panel = $("tab-" + t);
    if (panel) panel.hidden = t !== name;
  });
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
    b.title = s.label;
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
      b.title = title;
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
    color.title = "Text color for " + (FIELD_LABELS[key] || key);
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
    clear.title = "Use the global text color";
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
  setVal("borderColorInput", o.borderColor || "#a44a24");
  setVal("bgColorInput", o.bgColor || "#a44a24");
  setVal("textColorInput", o.textColor || "#2b2118");
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

function render() {
  const tree = $("bubbleTree");
  if (!tree) return;
  if (focusedEvent && !events.some((e) => e._id === focusedEvent._id)) focusedEvent = null;
  tree.innerHTML = "";

  /* Root bubble — the Event Bank. Drag it to move the panel; click
     it (no drag) to toggle the focused event open/closed. */
  const root = document.createElement("button");
  root.type = "button";
  root.className = "bubble root-bubble pulse-item";
  root.style.animationDelay = "0s";
  root.innerHTML = '<span class="root-text">Event Bank</span>';
  root.addEventListener("mousedown", onRootMouseDown);
  tree.appendChild(root);

  const connector = document.createElement("div");
  connector.className = "tree-connector";
  tree.appendChild(connector);

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
     description). Empty search shows all events. */
  const visible = searchQuery ? events.filter((ev) => eventMatches(ev, searchQuery)) : events;
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "bubble empty-bubble pulse-item";
    empty.style.animationDelay = "0.5s";
    empty.textContent = "No matching events.";
    tree.appendChild(empty);
    reportContentHeight();
    return;
  }
  visible.forEach((ev, evIndex) => {
    const isExpanded = focusedEvent && focusedEvent._id === ev._id;
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
      '<span class="expand-mark">' + (isExpanded ? "−" : "+") + "</span>";
    btn.addEventListener("click", () => {
      focusedEvent = isExpanded ? null : ev;
      if (isExpanded) playCloseSound(); else playTickSound();
      render();
    });
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
        vb.innerHTML = COPY_SVG + '<span class="key-badge">' + key.toUpperCase() + '</span><span class="value-text">' + escapeHtml(value) + "</span>" + CONFIRM_SVG;
        vb.addEventListener("click", () => copyValue(value, vb));
        values.appendChild(vb);
      });
      item.appendChild(values);
    }

    tree.appendChild(item);
  });
  reportContentHeight();
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
   tree is never cropped. The settings view is always full height.
   Reports to main, which resizes the window. */
const PANEL_MIN_H = 140;
const PANEL_MAX_H = 560; /* default height when nothing is measurable */
function measureContentHeight() {
  const view = currentView === "settings"
    ? document.querySelector(".settings-body")
    : $("bubbleTree");
  if (!view || !view.lastElementChild) return PANEL_MAX_H;
  const bottom = view.lastElementChild.getBoundingClientRect().bottom;
  if (!Number.isFinite(bottom) || bottom <= 0) return PANEL_MAX_H;
  return Math.max(PANEL_MIN_H, Math.ceil(bottom) + 16);
}
function reportContentHeight() {
  try { window.sideshow.reportContentHeight(measureContentHeight()); } catch (e) { /* main keeps its height */ }
}

/* ---------- root-bubble drag (the bubble is the drag handle) ---------- */

let dragState = null;
function onRootMouseDown(e) {
  if (e.button !== 0) return;
  dragState = { startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, raf: null };
  window.sideshow.dragStart();
  e.preventDefault();
}
document.addEventListener("mousemove", (e) => {
  if (!dragState) return;
  dragState.dx = e.clientX - dragState.startX;
  dragState.dy = e.clientY - dragState.startY;
  if (Math.abs(dragState.dx) + Math.abs(dragState.dy) > 4) dragState.moved = true;
  if (dragState.moved && !dragState.raf) {
    dragState.raf = requestAnimationFrame(() => {
      dragState.raf = null;
      if (dragState) window.sideshow.dragMove(dragState.dx, dragState.dy);
    });
  }
});
document.addEventListener("mouseup", () => {
  if (!dragState) return;
  const wasDrag = dragState.moved;
  if (dragState.raf) cancelAnimationFrame(dragState.raf);
  dragState = null;
  window.sideshow.dragEnd(wasDrag);
  /* Click without a drag toggles the focused event open/closed. */
  if (!wasDrag) {
    if (focusedEvent) { focusedEvent = null; render(); }
    else if (events.length) { focusedEvent = events[0]; playTickSound(); render(); }
  }
});

/* ---------- transparent window: click-through ---------- */

/* The window is transparent, so clicks on empty space must reach the
   desktop (ignore=true, forwarded). Clicks on a bubble, a button, or
   the settings card must reach the app (ignore=false). Only send IPC
   when the state changes. */
const CLICKABLE_SELECTOR = "button, input, select, .bubble, .value-bubble, .settings-view, a";
let ignoreMouseState = null;
function updateIgnoreMouse(x, y) {
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

/* ---------- views: bubble <-> settings ---------- */

function showSettingsView() {
  currentView = "settings";
  const bv = $("bubbleView"), sv = $("settingsView");
  if (bv) bv.hidden = true;
  if (sv) sv.hidden = false;
  refreshSettingsUI();
  refreshCalendarPicker();
  reportContentHeight();
  /* Settings is a solid card — clicks on it reach the app. */
  ignoreMouseState = null;
  if (lastMousePos) updateIgnoreMouse(lastMousePos.x, lastMousePos.y);
  else window.sideshow.setIgnoreMouseEvents(false);
}
function showBubbleView() {
  currentView = "bubble";
  const bv = $("bubbleView"), sv = $("settingsView");
  if (sv) sv.hidden = true;
  if (bv) bv.hidden = false;
  reportContentHeight();
  ignoreMouseState = null;
  if (lastMousePos) updateIgnoreMouse(lastMousePos.x, lastMousePos.y);
}

/* ---------- Google Calendar events (opt-in, never blocks the bubble) ---------- */

/* Rebuild the merged list: Main Eventer events first, then deduped
   calendar events. Re-renders and re-syncs the badge/reminders. */
function recomputeEvents() {
  events = mergeEvents(meEvents, calEvents);
  if (focusedEvent && !events.some((e) => e._id === focusedEvent._id)) focusedEvent = null;
  render();
  syncEventsToMain();
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
    const list = events.map((ev) => ({
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
  focusedEvent = ev;
  render();
  const card = document.querySelector("#bubbleTree .event-branch.expanded");
  if (card) card.scrollIntoView({ block: "nearest" });
}

/* ---------- single-key shortcuts ---------- */

/* While the panel is open, pressing a letter copies that field from
   the expanded event. Never fires while capturing a hotkey, a
   double-tap key, a gesture, or a long-click, and never in the
   settings view. */
function handleSingleKey(e) {
  if (currentView !== "bubble") return;
  if (capturingHotkey || capturingDoubleTap || recordingGesture || recordingLongClick) return;
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = (e.key || "").toLowerCase();
  if (SINGLE_KEYS.indexOf(key) < 0) return;
  if (!focusedEvent) return;
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
    motionSetting = await window.sideshow.getMotion();
    const btn = $("motionBtn");
    if (btn) btn.textContent = motionButtonLabel();
    applyMotion();
  } catch (e) { /* motion follows the OS */ }
  try {
    remindersOn = await window.sideshow.getReminders();
    const btn = $("remindersBtn");
    if (btn) btn.innerHTML = remindersOn ? BELL_ON_SVG : BELL_OFF_SVG;
  } catch (e) { /* reminders stay on */ }
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
    if (p && p.mode) positionSetting = p.mode;
    const btn = $("positionBtn");
    if (btn) btn.textContent = POSITION_LABELS[positionSetting] || "Follow cursor";
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
  applyAppearance();
  /* Bubble options: swatch rows + the per-field outline are built
     once from the defaults; refreshSettingsUI loads the saved
     values and re-applies them. */
  buildColorSwatches("borderSwatches", () => bubbleOptions.borderColor, async (v) => { bubbleOptions.borderColor = v; await saveBubbleOptions(); applyBubbleOptions(); });
  buildColorSwatches("bgSwatches", () => bubbleOptions.bgColor, async (v) => { bubbleOptions.bgColor = v; await saveBubbleOptions(); applyBubbleOptions(); });
  buildColorSwatches("textColorSwatches", () => bubbleOptions.textColor, async (v) => { bubbleOptions.textColor = v; await saveBubbleOptions(); applyBubbleOptions(); });
  buildFieldOutline();
  applyBubbleOptions();
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
  if (settingsBtn) settingsBtn.addEventListener("click", () => { playTickSound(); showSettingsView(); });
  /* Header search: typing filters the event bubbles live. The input
     lives in the header, outside the tree, so re-rendering the tree
     never steals its focus. */
  const searchInput = $("searchInput");
  if (searchInput) searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    render();
  });
  const settingsBackBtn = $("settingsBackBtn");
  if (settingsBackBtn) settingsBackBtn.addEventListener("click", () => showBubbleView());
  const settingsCloseBtn = $("settingsCloseBtn");
  if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", () => window.sideshow.hide());
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
    flashSaved(remindersBtn);
    if (remindersOn) syncEventsToMain();
  });

  /* Position — tap to cycle where the bubble opens. "Remember spot"
     opens where the bubble was last dragged to (drag it in the bubble
     view); with no spot saved yet it follows the cursor. */
  const positionBtn = $("positionBtn");
  if (positionBtn) positionBtn.addEventListener("click", async () => {
    const next = POSITION_MODES[(POSITION_MODES.indexOf(positionSetting) + 1) % POSITION_MODES.length];
    positionSetting = next;
    try { await window.sideshow.setPosition(next); } catch (e) { /* stays local */ }
    positionBtn.textContent = POSITION_LABELS[next] || "Follow cursor";
    flashSaved(positionBtn);
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

  /* Keyboard: hotkey capture first, then Esc / single-key shortcuts. */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (currentView === "settings") { showBubbleView(); return; }
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
  /* Panel lifecycle: sound + the initial click-through state, seeded
     from the cursor position main sends with the showing event. */
  window.sideshow.onPanelShowing((data) => {
    playOpenSound();
    maybeRefreshCalendarEvents();
    inflateBubble();
    ignoreMouseState = null;
    if (data && typeof data.x === "number" && typeof data.y === "number") {
      updateIgnoreMouse(data.x, data.y);
    }
  });
  window.sideshow.onPanelHiding(() => {
    playCloseSound();
    const bv = $("bubbleView");
    if (bv) bv.classList.remove("inflate");
  });
  refreshSettingsUI();
  init();
});
