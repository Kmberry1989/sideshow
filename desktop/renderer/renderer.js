"use strict";
/* Sideshow panel — reads the saved Main Eventer events from Firestore
   (read-only) and shows each field as a clickable chip. Click a chip to
   copy that exact value; paste it wherever you are working. */

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { eventChips, eventTitle, eventSubtitle, eventMatches } from "./fields.js";

const ALLOWLIST = ["kylematthewberry@gmail.com", "rochelleberry731@gmail.com"];
const COLLECTION = "mainEvent_events";

const $ = (id) => document.getElementById(id);
let auth = null;
let db = null;
let events = [];
let unsubscribe = null;
let queryText = "";

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

function render() {
  const list = $("eventList");
  if (!list) return;
  const filtered = events.filter((ev) => eventMatches(ev, queryText));
  list.innerHTML = "";
  if (!filtered.length) {
    setState(events.length ? "empty" : "empty");
    return;
  }
  setState("list");
  filtered.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "event";
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
      const k = document.createElement("span");
      k.className = "chip-k";
      k.textContent = chip.label;
      const v = document.createElement("span");
      v.className = "chip-v";
      v.textContent = chip.value;
      b.appendChild(k);
      b.appendChild(v);
      b.addEventListener("click", () => {
        window.sideshow.copy(chip.value).then(() => {
          b.classList.add("copied");
          const old = v.textContent;
          v.textContent = "Copied";
          setTimeout(() => { b.classList.remove("copied"); v.textContent = old; }, 1200);
        });
      });
      chips.appendChild(b);
    });
    card.appendChild(chips);
    list.appendChild(card);
  });
}

function subscribe() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!db) return;
  setState("loading");
  const q = query(collection(db, COLLECTION), orderBy("updatedAt", "desc"), limit(50));
  unsubscribe = onSnapshot(q, (snap) => {
    events = [];
    snap.forEach((doc) => events.push(doc.data()));
    render();
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

document.addEventListener("DOMContentLoaded", () => {
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
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.sideshow.hide();
  });
  init();
});
