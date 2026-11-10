"use strict";
/* Next up — the soonest upcoming event. Pure functions, unit-tested.
   An event counts as upcoming when its start (date + startTime) is
   still ahead; a date-only event counts for the rest of its day, so
   today's all-day event stays "next up" until the day ends. Events
   with no date never count. The soonest start wins; ties break by
   title so the pick is stable. */

function pad(n) { return (n < 10 ? "0" : "") + n; }

function dateStrOf(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/* An event's start as ms since epoch, or null when it has no usable
   date. A date-only event starts at midnight of its date. */
function eventStartMs(ev) {
  if (!ev || !ev.date || typeof ev.date !== "string") return null;
  const p = ev.date.split("-");
  if (p.length !== 3) return null;
  let h = 0, m = 0;
  if (ev.startTime) {
    const t = String(ev.startTime).split(":");
    if (t.length < 2) return null;
    h = +t[0];
    m = +t[1];
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  }
  const d = new Date(+p[0], +p[1] - 1, +p[2], h, m);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function isAllDay(ev) {
  return !!ev && !ev.startTime;
}

/* The soonest upcoming event: { event, startMs } or null when none
   is upcoming. `nowMs` is injectable for tests; it defaults to now.
   Timed events sort by their start; a date-only event sorts at the
   end of its day, so a timed event later today ranks ahead of an
   all-day event that already started at midnight — "next up" is
   the next thing starting, and the all-day event is already on. */
function nextUpcomingEvent(events, nowMs) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const todayStr = dateStrOf(new Date(now));
  let best = null;
  let bestMs = Infinity;
  (Array.isArray(events) ? events : []).forEach((ev) => {
    if (!ev) return;
    const start = eventStartMs(ev);
    if (start == null) return;
    const upcoming = start >= now || (isAllDay(ev) && ev.date >= todayStr);
    if (!upcoming) return;
    /* Date-only events sort at 23:59 of their day. */
    const sortMs = isAllDay(ev) ? start + (23 * 60 + 59) * 60000 : start;
    if (sortMs < bestMs || (sortMs === bestMs && best && (ev.title || "") < (best.title || ""))) {
      best = ev;
      bestMs = sortMs;
    }
  });
  return best ? { event: best, startMs: bestMs } : null;
}

/* Countdown text for a start time: "Starting now", "in 12m",
   "in 2h 15m", "in 3d 2h". A date-only event shows "Today",
   "Tomorrow", or its short date instead of a ticking countdown. */
function formatCountdown(startMs, nowMs, allDay) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  if (allDay) {
    const d = new Date(startMs);
    const t = new Date(now);
    const dayStr = dateStrOf(d);
    const todayStr = dateStrOf(t);
    const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    if (dayStr === todayStr) return "Today";
    if (dayStr === dateStrOf(tomorrow)) return "Tomorrow";
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return days[d.getDay()] + ", " + months[d.getMonth()] + " " + d.getDate();
  }
  const diff = startMs - now;
  if (diff < 60000) return "Starting now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return "in " + mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rm = mins % 60;
    return "in " + hours + "h" + (rm ? " " + rm + "m" : "");
  }
  const days = Math.floor(hours / 24);
  const rh = hours % 24;
  return "in " + days + "d" + (rh ? " " + rh + "h" : "");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { eventStartMs, isAllDay, nextUpcomingEvent, formatCountdown, dateStrOf };
}
