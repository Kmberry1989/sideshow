"use strict";
/* electron-packager afterExtract hook: prune Chromium locales from the
   extracted Electron distribution (keep en-US only). Runs after the
   Electron zip is extracted, before the app files are copied in, for
   every platform the pack script targets. */
const { pruneLocales } = require("./prune-locales");

module.exports = function (buildPath, _electronVersion, platform, _arch, callback) {
  try {
    const result = pruneLocales(buildPath, platform);
    console.log(
      `[trim] locales (${platform}): kept ${result.kept}, ` +
      `removed ${result.removed.length} entries (${result.removedBytes} bytes)`,
    );
    callback();
  } catch (err) {
    callback(err);
  }
};
