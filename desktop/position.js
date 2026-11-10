"use strict";
/* Pure panel-positioning logic for Sideshow — no Electron dependency,
   so it is unit-testable with node --test.

   Why this exists: the panel window used to be a fixed 400x560, but
   the bubble content is anchored at the top and is usually much
   shorter (a handful of events is ~150-250px). The old follow-cursor
   code flipped the whole 560px window above the cursor whenever the
   cursor was in the lower ~560px of the screen, so the visible bubble
   (at the window's top) landed up to ~576px above the cursor — on a
   MacBook Air screen that is most of the screen height away, "way up
   into weird land". The clamp had the same effect when the work area
   was shorter than 560px (it pinned the window top to the work-area
   top). The fix is to fit the window height to the actual content
   and to position using that fitted height, so the bubble stays next
   to the cursor. */

const PANEL_W = 400;
const PANEL_MIN_H = 140;
/* PANEL_MAX_H is the window's starting height (the window is fitted
   to its content after launch). It is NOT a cap: the window takes
   all the room its content needs, up to the work area, so a tall
   tree is never cropped. */
const PANEL_MAX_H = 560;
const CURSOR_GAP = 16;
/* Panel width setting: 320–560px, default 400 (the current width).
   The window, the positioning/clamping, and the drag clamp all use
   the chosen width; the tree and the calendar grid are fluid, so
   they fit any width in the range with no horizontal overflow. */
const PANEL_W_MIN = 320;
const PANEL_W_MAX = 560;
/* Gap from cursor setting: 0–64px, default 16 (the current offset). */
const CURSOR_GAP_MIN = 0;
const CURSOR_GAP_MAX = 64;
/* Which display the bubble opens on: "cursor" (the display with
   the pointer, current behavior, default) or "primary". */
const PANEL_DISPLAYS = ["cursor", "primary"];
const PANEL_DISPLAY_LABELS = { cursor: "Display with cursor", primary: "Primary display" };
/* Idle auto-dismiss: seconds of no panel activity before the bubble
   fades out and hides. 0 = stay until closed (the current behavior,
   default). The clock counts from the last interaction, not from
   the pointer leaving the panel — a still mouse counts as idle. */
const DISMISS_OPTIONS = [0, 5, 10, 30, 60];
const DISMISS_LABELS = { 0: "Stay until closed", 5: "5 seconds", 10: "10 seconds", 30: "30 seconds", 60: "1 minute" };

/* Position modes. "cursor" follows the pointer; the four corners and
   "center" are fixed spots; "custom" is a spot the user dragged the
   bubble to ("Remember spot"). Fixed spots anchor to the cursor's
   display work area, so the panel appears on the monitor being used. */
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

/* Clamp a content height into the window-height range, never taller
   than the work area it has to fit in. No fixed cap: a tall tree
   grows the window to the work area instead of being cropped. */
function clampHeight(h, boundsHeight) {
  const cap = boundsHeight;
  const floor = Math.min(PANEL_MIN_H, cap);
  if (!Number.isFinite(h)) return floor;
  return Math.max(floor, Math.min(h, cap));
}

/* Keep a window of size (w, h) fully inside bounds. If the window is
   bigger than the work area, pin it to the work-area origin. */
function clampPosition(x, y, bounds, w, h) {
  const maxX = bounds.x + bounds.width - w;
  const maxY = bounds.y + bounds.height - h;
  return {
    x: Math.round(maxX < bounds.x ? bounds.x : Math.max(bounds.x, Math.min(x, maxX))),
    y: Math.round(maxY < bounds.y ? bounds.y : Math.max(bounds.y, Math.min(y, maxY))),
  };
}

/* Clamp a drag target the same way: a drag must never push the panel
   partly off-screen. An unclamped drag-move lets the window slide
   past the work-area edge, so the visible panel shrinks instead of
   moving — it looks like the view is scaling. The drag-end save
   already clamped, but it never moved the window to the clamped
   spot, so the saved spot and the real position drifted apart. */
function clampDragPosition(x, y, bounds, h, w) {
  return clampPosition(x, y, bounds, w || PANEL_W, h);
}

/* Follow-cursor: just below-right of the pointer by a small gap so it
   does not cover the pointer. Near the right or bottom edge, flip to
   the left / above instead; then clamp so the whole panel stays
   on-screen. `h` is the fitted window height, not the 560 max — that
   is what keeps a short bubble next to the cursor instead of ~576px
   above it when the cursor is low on the screen. `w` is the panel
   width setting (default 400); `gap` is the cursor-gap setting
   (default 16). */
function panelPositionNearCursor(cursor, bounds, h, w, gap) {
  const width = Number.isFinite(w) ? w : PANEL_W;
  const g = Number.isFinite(gap) ? gap : CURSOR_GAP;
  let x = cursor.x + g;
  let y = cursor.y + g;
  if (x + width > bounds.x + bounds.width) x = cursor.x - g - width;
  if (y + h > bounds.y + bounds.height) y = cursor.y - g - h;
  return clampPosition(x, y, bounds, width, h);
}

/* Resolve the panel's top-left for a position mode. Fixed spots
   anchor to the cursor's display work area. "custom" with no saved
   spot yet falls back to follow-cursor. `w` is the panel width
   setting (default 400); `gap` is the cursor-gap setting (default
   16). */
function resolvePanelPosition(mode, custom, cursor, bounds, h, w, gap) {
  const width = Number.isFinite(w) ? w : PANEL_W;
  switch (mode) {
    case "top-left":
      return clampPosition(bounds.x, bounds.y, bounds, width, h);
    case "top-right":
      return clampPosition(bounds.x + bounds.width - width, bounds.y, bounds, width, h);
    case "bottom-left":
      return clampPosition(bounds.x, bounds.y + bounds.height - h, bounds, width, h);
    case "bottom-right":
      return clampPosition(bounds.x + bounds.width - width, bounds.y + bounds.height - h, bounds, width, h);
    case "center":
      return clampPosition(
        bounds.x + Math.round((bounds.width - width) / 2),
        bounds.y + Math.round((bounds.height - h) / 2),
        bounds, width, h);
    case "custom":
      if (custom && Number.isFinite(custom.x) && Number.isFinite(custom.y)) {
        return clampPosition(custom.x, custom.y, bounds, width, h);
      }
      return panelPositionNearCursor(cursor, bounds, h, width, gap);
    case "cursor":
    default:
      return panelPositionNearCursor(cursor, bounds, h, width, gap);
  }
}

/* Validate a stored position setting. Unknown modes fall back to
   follow-cursor; a bad custom spot is dropped (not guessed at).
   Width, display, gap, and idle-dismiss each fall back to their
   defaults when missing or out of range, so an old saved setting
   still loads cleanly. */
function normalizePositionSetting(value) {
  const v = (value && typeof value === "object") ? value : {};
  const mode = POSITION_MODES.indexOf(v.mode) >= 0 ? v.mode : "cursor";
  let custom = null;
  if (v.custom && typeof v.custom === "object"
      && Number.isFinite(v.custom.x) && Number.isFinite(v.custom.y)) {
    custom = { x: Math.round(v.custom.x), y: Math.round(v.custom.y) };
  }
  const width = clampInt(v.width, PANEL_W_MIN, PANEL_W_MAX, PANEL_W);
  const display = PANEL_DISPLAYS.indexOf(v.display) >= 0 ? v.display : "cursor";
  const gap = clampInt(v.gap, CURSOR_GAP_MIN, CURSOR_GAP_MAX, CURSOR_GAP);
  const dismiss = DISMISS_OPTIONS.indexOf(v.dismiss) >= 0 ? v.dismiss : 0;
  return { mode, custom, width, display, gap, dismiss };
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(+v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  PANEL_W, PANEL_MIN_H, PANEL_MAX_H, CURSOR_GAP,
  PANEL_W_MIN, PANEL_W_MAX, CURSOR_GAP_MIN, CURSOR_GAP_MAX,
  PANEL_DISPLAYS, PANEL_DISPLAY_LABELS, DISMISS_OPTIONS, DISMISS_LABELS,
  POSITION_MODES, POSITION_LABELS,
  clampHeight, clampPosition, clampDragPosition, panelPositionNearCursor,
  resolvePanelPosition, normalizePositionSetting,
};
