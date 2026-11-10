"use strict";
/* Drag-from-anywhere: pure target classification + movement rule.
   The panel drags from any spot on it; only text inputs are
   excluded, and only the root bubble's click toggles the focused
   event. These tests run against the pure module, no Electron. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyDragTarget, isDragMovement, shouldEngageDrag, DRAG_EXCLUDE_SELECTOR, DRAG_THRESHOLD_PX } = require("../renderer/drag.js");

/* Minimal stand-in for a DOM element: closest() walks up through
   parents, answering by tag and class like the real one. */
function fakeEl(tag, classes, parent) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    classes: classes || [],
    parent: parent || null,
    closest(sel) {
      let cur = el;
      while (cur) {
        for (const part of sel.split(",")) {
          const p = part.trim();
          if ((p === "input" || p === "select" || p === "textarea") && cur.tagName.toLowerCase() === p) return cur;
          if (p.startsWith(".") && cur.classes.indexOf(p.slice(1)) >= 0) return cur;
        }
        cur = cur.parent;
      }
      return null;
    },
  };
  return el;
}

test("text inputs never start a drag", () => {
  assert.deepEqual(classifyDragTarget(fakeEl("input")), { start: false, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("select")), { start: false, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("textarea")), { start: false, fromRoot: false, inScrollArea: false });
  /* Even inside the root bubble, an input stays typeable. */
  const root = fakeEl("button", ["root-bubble"]);
  assert.deepEqual(classifyDragTarget(fakeEl("input", [], root)), { start: false, fromRoot: false, inScrollArea: false });
});

test("any other spot starts a drag, but only the root toggles on click", () => {
  assert.deepEqual(classifyDragTarget(fakeEl("div")), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["event-bubble"])), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["value-bubble"])), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["cal-event"])), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("div", ["cal-cell"])), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["root-bubble"])), { start: true, fromRoot: true, inScrollArea: false });
  /* Clicking the text inside the root bubble counts as the root. */
  const root = fakeEl("button", ["root-bubble"]);
  assert.deepEqual(classifyDragTarget(fakeEl("span", ["root-text"], root)), { start: true, fromRoot: true, inScrollArea: false });
});

test("targets inside the tree or calendar are marked as scroll areas", () => {
  const tree = fakeEl("div", ["bubble-tree"]);
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["event-bubble"], tree)), { start: true, fromRoot: false, inScrollArea: true });
  const cal = fakeEl("div", ["calendar-view"]);
  assert.deepEqual(classifyDragTarget(fakeEl("div", ["cal-cell"], cal)), { start: true, fromRoot: false, inScrollArea: true });
  /* The week journal shares the calendar-view class, so it is a
     scroll area too — a vertical swipe scrolls it, a sideways drag
     moves the window. */
  const week = fakeEl("div", ["calendar-view", "week-view"]);
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["week-event"], week)), { start: true, fromRoot: false, inScrollArea: true });
  const header = fakeEl("div", ["bubble-header"]);
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["icon-btn"], header)), { start: true, fromRoot: false, inScrollArea: false });
});

test("a target without closest() never starts a drag", () => {
  assert.deepEqual(classifyDragTarget(null), { start: false, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget({}), { start: false, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget({ nodeType: 3 }), { start: false, fromRoot: false, inScrollArea: false });
});

test("movement needs more than 4px manhattan, same as before", () => {
  assert.equal(DRAG_THRESHOLD_PX, 4);
  assert.equal(DRAG_EXCLUDE_SELECTOR, "input, select, textarea");
  assert.equal(isDragMovement(0, 0), false);
  assert.equal(isDragMovement(4, 0), false);
  assert.equal(isDragMovement(0, 4), false);
  assert.equal(isDragMovement(3, 1), false);
  assert.equal(isDragMovement(3, 2), true);
  assert.equal(isDragMovement(5, 0), true);
  assert.equal(isDragMovement(-3, -2), true);
});

test("touch drags from a scroll area only engage when horizontal", () => {
  /* A vertical swipe in the tree/calendar is a scroll: the window
     must not nudge before the browser's pointercancel arrives. */
  assert.equal(shouldEngageDrag("touch", true, 0, 40), false);
  assert.equal(shouldEngageDrag("touch", true, 5, 40), false);
  assert.equal(shouldEngageDrag("touch", true, 20, 20), false);
  /* Horizontal (or horizontal-dominant) touch drags move the window. */
  assert.equal(shouldEngageDrag("touch", true, 40, 0), true);
  assert.equal(shouldEngageDrag("touch", true, 40, 5), true);
  assert.equal(shouldEngageDrag("touch", true, 21, 20), true);
  /* Mouse and pen never get a scroll takeover: any direction moves. */
  assert.equal(shouldEngageDrag("mouse", true, 0, 40), true);
  assert.equal(shouldEngageDrag("pen", true, 0, 40), true);
  /* Touch drags from non-scrollable areas move in any direction. */
  assert.equal(shouldEngageDrag("touch", false, 0, 40), true);
  assert.equal(shouldEngageDrag("touch", false, 40, 0), true);
});
