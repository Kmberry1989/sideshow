/* Sideshow shared field formatting. Same record shape as Main Eventer:
   title, date (YYYY-MM-DD), startTime/endTime (HH:MM), price, ages,
   host, location, description, link. No fake data — empty fields are
   omitted, never invented. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_S = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_S = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n) { return (n < 10 ? "0" : "") + n; }

function parseDateVal(v) {
  if (!v) return null;
  const p = String(v).split("-");
  if (p.length !== 3) return null;
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  return isNaN(d.getTime()) ? null : d;
}

function parseTimeVal(v) {
  if (!v) return null;
  const p = String(v).split(":");
  if (p.length < 2) return null;
  const n = (+p[0]) * 60 + (+p[1]);
  return isNaN(n) ? null : n;
}

function fmtTime(mins) {
  if (mins == null) return "";
  const h = Math.floor(mins / 60), m = mins % 60;
  const ap = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return h12 + ":" + pad(m) + " " + ap;
}

function fmtDateLong(d) {
  return DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

function fmtDateShort(d) {
  return DAYS_S[d.getDay()] + ", " + MONTHS_S[d.getMonth()] + " " + d.getDate();
}

/* Chips for one event. Each chip is { label, value }. Only non-empty
   fields become chips. Order: name, date, start, end, price, ages,
   host, location. */
function eventChips(ev) {
  const chips = [];
  if (ev.title) chips.push({ label: "Name", value: ev.title });
  const d = parseDateVal(ev.date);
  if (d) chips.push({ label: "Date", value: fmtDateLong(d) });
  const start = parseTimeVal(ev.startTime);
  const end = parseTimeVal(ev.endTime);
  if (start != null) chips.push({ label: "Start", value: fmtTime(start) });
  if (end != null) chips.push({ label: "End", value: fmtTime(end) });
  if (ev.price) chips.push({ label: "Price", value: ev.price });
  if (ev.ages) chips.push({ label: "Ages", value: ev.ages });
  if (ev.host) chips.push({ label: "Host", value: ev.host });
  if (ev.location) chips.push({ label: "Location", value: ev.location });
  return chips;
}

function eventTitle(ev) {
  return ev.title || "Untitled";
}

function eventSubtitle(ev) {
  const d = parseDateVal(ev.date);
  const start = parseTimeVal(ev.startTime);
  const parts = [];
  if (d) parts.push(fmtDateShort(d));
  if (start != null) parts.push(fmtTime(start));
  return parts.join(" · ");
}

function eventMatches(ev, q) {
  if (!q) return true;
  const hay = [ev.title, ev.host, ev.location, ev.date, ev.price, ev.ages]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.indexOf(q.toLowerCase()) !== -1;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseDateVal, parseTimeVal, fmtTime, fmtDateLong, fmtDateShort, eventChips, eventTitle, eventSubtitle, eventMatches };
}
