"use strict";
/* electron-builder afterPack hook: prune Chromium locales from the packaged
   app (keep en-US only). Runs on the unpacked output before the installer /
   dmg is made, for every platform. */
const { pruneLocales } = require("./prune-locales");

module.exports = async function (context) {
  const result = pruneLocales(context.appOutDir, context.electronPlatformName);
  console.log(
    `[trim] locales (${context.electronPlatformName}): kept ${result.kept}, ` +
    `removed ${result.removed.length} entries (${result.removedBytes} bytes)`,
  );
};
