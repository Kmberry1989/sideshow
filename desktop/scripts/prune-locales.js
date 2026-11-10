"use strict";
/* Prune Chromium locale files from a packaged Electron app, keeping only
   en-US English. Chromium ships ~55 locale files (~40-60 MB) that this app
   never uses — the UI is English-only. Safe to drop: the app renders in
   English regardless; a non-English OS locale only affects Chromium's own
   chrome (context menus, etc.), which this frameless overlay does not show.

   Layouts (root = the directory holding the Electron distribution):
   - win32 / linux: <root>/locales/*.pak — keep en-US.pak
   - darwin: <root>/*.app/Contents/Frameworks/Electron Framework.framework/
     Versions/A/Resources/*.lproj — keep en.lproj
   Returns { kept, removed: [paths], removedBytes }. */
const fs = require("node:fs");
const path = require("node:path");

function pruneDir(dir, keepName, isDir) {
  const removed = [];
  let removedBytes = 0;
  if (!fs.existsSync(dir)) return { removed, removedBytes };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === keepName) continue;
    if (isDir && !entry.isDirectory()) continue;
    if (!isDir && !entry.isFile()) continue;
    const p = path.join(dir, entry.name);
    const size = entry.isDirectory()
      ? (function dirSize(d) {
          let total = 0;
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const q = path.join(d, e.name);
            total += e.isDirectory() ? dirSize(q) : fs.statSync(q).size;
          }
          return total;
        })(p)
      : fs.statSync(p).size;
    fs.rmSync(p, { recursive: true, force: true });
    removed.push(p);
    removedBytes += size;
  }
  return { removed, removedBytes };
}

function pruneLocales(root, platform) {
  const removed = [];
  let removedBytes = 0;
  let kept = null;
  if (platform === "darwin") {
    // One .app per output dir; find it rather than hard-coding the name.
    const apps = fs.existsSync(root)
      ? fs.readdirSync(root, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name.endsWith(".app"))
          .map((e) => e.name)
      : [];
    for (const app of apps) {
      const resources = path.join(
        root, app, "Contents", "Frameworks", "Electron Framework.framework",
        "Versions", "A", "Resources",
      );
      const r = pruneDir(resources, "en.lproj", true);
      removed.push(...r.removed);
      removedBytes += r.removedBytes;
    }
    kept = "en.lproj";
  } else {
    const locales = path.join(root, "locales");
    const r = pruneDir(locales, "en-US.pak", false);
    removed.push(...r.removed);
    removedBytes += r.removedBytes;
    kept = "en-US.pak";
  }
  return { kept, removed, removedBytes };
}

module.exports = { pruneLocales };
