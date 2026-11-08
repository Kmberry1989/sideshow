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
const PANEL_MAX_H = 560;
const CURSOR_GAP = 16;

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
   than the work area it has to fit in. */
function clampHeight(h, boundsHeight) {
  const cap = Math.min(PANEL_MAX_H, boundsHeight);
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

/* Follow-cursor: just below-right of the pointer by a small gap so it
   does not cover the pointer. Near the right or bottom edge, flip to
   the left / above instead; then clamp so the whole panel stays
   on-screen. `h` is the fitted window height, not the 560 max — that
   is what keeps a short bubble next to the cursor instead of ~576px
   above it when the cursor is low on the screen. */
function panelPositionNearCursor(cursor, bounds, h) {
  let x = cursor.x + CURSOR_GAP;
  let y = cursor.y + CURSOR_GAP;
  if (x + PANEL_W > bounds.x + bounds.width) x = cursor.x - CURSOR_GAP - PANEL_W;
  if (y + h > bounds.y + bounds.height) y = cursor.y - CURSOR_GAP - h;
  return clampPosition(x, y, bounds, PANEL_W, h);
}

/* Resolve the panel's top-left for a position mode. Fixed spots
   anchor to the cursor's display work area. "custom" with no saved
   spot yet falls back to follow-cursor. */
function resolvePanelPosition(mode, custom, cursor, bounds, h) {
  switch (mode) {
    case "top-left":
      return clampPosition(bounds.x, bounds.y, bounds, PANEL_W, h);
    case "top-right":
      return clampPosition(bounds.x + bounds.width - PANEL_W, bounds.y, bounds, PANEL_W, h);
    case "bottom-left":
      return clampPosition(bounds.x, bounds.y + bounds.height - h, bounds, PANEL_W, h);
    case "bottom-right":
      return clampPosition(bounds.x + bounds.width - PANEL_W, bounds.y + bounds.height - h, bounds, PANEL_W, h);
    case "center":
      return clampPosition(
        bounds.x + Math.round((bounds.width - PANEL_W) / 2),
        bounds.y + Math.round((bounds.height - h) / 2),
        bounds, PANEL_W, h);
    case "custom":
      if (custom && Number.isFinite(custom.x) && Number.isFinite(custom.y)) {
        return clampPosition(custom.x, custom.y, bounds, PANEL_W, h);
      }
      return panelPositionNearCursor(cursor, bounds, h);
    case "cursor":
    default:
      return panelPositionNearCursor(cursor, bounds, h);
  }
}

/* Validate a stored position setting. Unknown modes fall back to
   follow-cursor; a bad custom spot is dropped (not guessed at). */
function normalizePositionSetting(value) {
  const v = (value && typeof value === "object") ? value : {};
  const mode = POSITION_MODES.indexOf(v.mode) >= 0 ? v.mode : "cursor";
  let custom = null;
  if (v.custom && typeof v.custom === "object"
      && Number.isFinite(v.custom.x) && Number.isFinite(v.custom.y)) {
    custom = { x: Math.round(v.custom.x), y: Math.round(v.custom.y) };
  }
  return { mode, custom };
}

module.exports = {
  PANEL_W, PANEL_MIN_H, PANEL_MAX_H, CURSOR_GAP,
  POSITION_MODES, POSITION_LABELS,
  clampHeight, clampPosition, panelPositionNearCursor,
  resolvePanelPosition, normalizePositionSetting,
};
