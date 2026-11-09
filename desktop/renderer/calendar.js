/* Sideshow Google Calendar mapping — pure functions, unit-tested.
   Maps a Google Calendar event onto the Main Eventer record shape
   (title, date YYYY-MM-DD, startTime/endTime HH:MM, price, ages,
   host, location, description, link), then merges calendar events
   with the Firestore Main Eventer events for the bubble.
   No fake data — price/ages/host only exist when the description
   carries the exact Main Eventer lines ("Host: X", "Price: $Y",
   "Ages: Z"); otherwise those fields stay empty and their bubbles
   are absent. */

function pad(n) { return (n < 10 ? "0" : "") + n; }

/* The Main Eventer description format: free-text description first,
   then "Host: X", "Price: $Y", "Ages: Z" lines, then the location as
   a bare line, then "Details & registration: <link>".
   Returns { description, host, price, ages, link } — description is
   the free text with the structured lines removed. */
function parseCalendarDescription(desc) {
  const out = { description: "", host: "", price: "", ages: "", link: "" };
  if (!desc) return out;
  const kept = [];
  String(desc).split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.indexOf("Host: ") === 0) { out.host = trimmed.slice("Host: ".length).trim(); return; }
    if (trimmed.indexOf("Price: ") === 0) { out.price = trimmed.slice("Price: ".length).trim(); return; }
    if (trimmed.indexOf("Ages: ") === 0) { out.ages = trimmed.slice("Ages: ".length).trim(); return; }
    if (trimmed.indexOf("Details & registration: ") === 0) {
      out.link = trimmed.slice("Details & registration: ".length).trim();
      return;
    }
    kept.push(line);
  });
  /* Drop trailing blank lines left behind by the removed lines. */
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  out.description = kept.join("\n").trim();
  return out;
}

/* One ISO date-time (with offset) -> local { date, time }.
   "2026-11-21T10:00:00-05:00" in America/Indiana/Indianapolis is
   10:00 on 2026-11-21; the same instant in UTC is 15:00 — the
   local getters, not the UTC ones, are what the bubble shows. */
function localDateTime(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()),
    time: pad(d.getHours()) + ":" + pad(d.getMinutes()),
  };
}

/* A Google Calendar event -> a Main Eventer record. Timed events
   take date/startTime/endTime from start/end.dateTime in the user's
   local timezone; all-day events (start.date) take the date with no
   times. The id is stable ("gcal:" + calendarId + ":" + eventId) so
   badge/reminder keys are stable; _id is the same value, matching
   how the renderer keys Firestore records. */
function calendarEventToRecord(gcalEvent, calendarId) {
  const ev = gcalEvent || {};
  const calId = calendarId || ev.calendarId || "";
  const eventId = ev.id || "";
  const id = "gcal:" + calId + ":" + eventId;
  const parsed = parseCalendarDescription(ev.description || "");
  const record = {
    id,
    _id: id,
    title: ev.summary || "",
    date: "",
    startTime: "",
    endTime: "",
    price: parsed.price,
    ages: parsed.ages,
    host: parsed.host,
    location: ev.location || "",
    description: parsed.description,
    link: parsed.link,
    source: "gcal",
    gcalId: eventId,
    calendarId: calId,
  };
  const start = ev.start || {};
  const end = ev.end || {};
  if (start.dateTime) {
    const s = localDateTime(start.dateTime);
    record.date = s.date;
    record.startTime = s.time;
  } else if (start.date) {
    record.date = start.date;
  }
  if (end.dateTime) {
    const e = localDateTime(end.dateTime);
    record.endTime = e.time;
  }
  /* All-day end.date is exclusive (the day after the last day), so
     it is not an end time and is left out. */
  return record;
}

/* Dedup key: same title (case-insensitive, trimmed), same date,
   same start time. A calendar event with no date/time can never
   match a Main Eventer event (those always carry a date). */
function dedupKey(ev) {
  return ((ev.title || "").trim().toLowerCase()) + "|" + (ev.date || "") + "|" + (ev.startTime || "");
}

/* ---------- month grid view (pure, unit-tested) ---------- */

/* Days in a month (month 0-based). */
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/* A month as 6 weeks × 7 cells, weeks starting Sunday. Each cell is
   { date: "YYYY-MM-DD", day: number, inMonth: boolean } — days from
   the adjacent months fill the first/last week (dimmed, not blank),
   so the grid is always full and fits the frame exactly. */
function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay(); /* 0 = Sunday */
  const start = new Date(year, month, 1 - startDay);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const y = cur.getFullYear(), m = cur.getMonth(), day = cur.getDate();
      week.push({
        date: y + "-" + pad(m + 1) + "-" + pad(day),
        day,
        inMonth: m === month,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

/* Events grouped by their start date ("YYYY-MM-DD" -> [ev, ...]).
   Multi-day events sit on their start date only; dateless events
   are left out (they stay in the tree). */
function groupEventsByDate(events) {
  const byDate = {};
  (Array.isArray(events) ? events : []).forEach((ev) => {
    if (!ev || !ev.date || typeof ev.date !== "string") return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) return;
    if (!byDate[ev.date]) byDate[ev.date] = [];
    byDate[ev.date].push(ev);
  });
  return byDate;
}

function compareCal(a, b) {
  if (a.date !== b.date) return (a.date || "") < (b.date || "") ? -1 : 1;
  if (a.startTime !== b.startTime) return (a.startTime || "") < (b.startTime || "") ? -1 : 1;
  return 0;
}

/* Main Eventer events first, in their Firestore order, then the
   deduped calendar events sorted by date then start time. A
   calendar event matching a Main Eventer event is dropped — the
   Main Eventer record wins (it carries price/ages/host). */
function mergeEvents(meEvents, calEvents) {
  const me = Array.isArray(meEvents) ? meEvents : [];
  const cal = Array.isArray(calEvents) ? calEvents : [];
  const seen = new Set();
  me.forEach((ev) => { if (ev) seen.add(dedupKey(ev)); });
  const extra = cal.filter((ev) => {
    if (!ev) return false;
    const key = dedupKey(ev);
    if (seen.has(key)) return false;
    seen.add(key); /* the same event on two selected calendars, once */
    return true;
  });
  extra.sort(compareCal);
  return me.concat(extra);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseCalendarDescription, calendarEventToRecord, mergeEvents, localDateTime, dedupKey, daysInMonth, monthGrid, groupEventsByDate };
}
