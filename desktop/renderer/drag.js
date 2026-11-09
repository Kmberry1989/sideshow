"use strict";
/* Drag-from-anywhere: pure target classification + movement rule.
   The panel drags from any spot on it (root, event/value bubbles,
   header buttons, calendar cells) — only text inputs are excluded
   so the search box stays clickable and typeable. The root bubble
   is still the only origin whose click (no movement) toggles the
   focused event open/closed; every other element keeps its own
   click handler. Pure module (no Electron): tests import it
   directly, the renderer bundles it. */
const DRAG_EXCLUDE_SELECTOR = "input, select, textarea";
const DRAG_THRESHOLD_PX = 4; /* manhattan distance, same as before */
/* Scroll containers: a finger swipe there scrolls the list, so a
   touch drag starting inside one must not move the window unless
   it is horizontal (the browser takes vertical swipes over for
   scrolling and cancels the pointer stream anyway). */
const DRAG_SCROLL_SELECTOR = ".bubble-tree, .calendar-view";
function classifyDragTarget(target) {
  if (!target || typeof target.closest !== "function") return { start: false, fromRoot: false, inScrollArea: false };
  if (target.closest(DRAG_EXCLUDE_SELECTOR)) return { start: false, fromRoot: false, inScrollArea: false };
  return { start: true, fromRoot: !!target.closest(".root-bubble"), inScrollArea: !!target.closest(DRAG_SCROLL_SELECTOR) };
}
function isDragMovement(dx, dy) {
  return Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX;
}
/* Whether a drag that already passed the movement threshold may
   actually move the window. Only touch drags from a scroll area
   are gated: a vertical swipe there is a scroll, and without this
   the window nudges a few px before the browser's pointercancel
   arrives. Mouse and pen never get a scroll takeover, and drags
   from non-scrollable areas move the window in any direction. */
function shouldEngageDrag(pointerType, inScrollArea, dx, dy) {
  if (pointerType !== "touch" || !inScrollArea) return true;
  return Math.abs(dx) > Math.abs(dy);
}
module.exports = { DRAG_EXCLUDE_SELECTOR, DRAG_THRESHOLD_PX, DRAG_SCROLL_SELECTOR, classifyDragTarget, isDragMovement, shouldEngageDrag };
