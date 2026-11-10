"use strict";
/* Pack portable zips via the electron-packager API (not its CLI): the CLI
   cannot take hook functions, and the locale trim needs the afterExtract
   hook (scripts/after-extract.js). The .map exclusion rides on the `ignore`
   option, which the CLI does accept — but keeping both here keeps the whole
   trim in one place. Usage: node scripts/pack.js win32 darwin | linux
   (run from desktop/, so paths resolve against the app dir). */
const packager = require("@electron/packager");
const afterExtract = require("./after-extract");

async function main() {
  const platforms = process.argv.slice(2);
  if (platforms.length === 0) {
    throw new Error("usage: node scripts/pack.js <platform> [<platform> ...]");
  }
  for (const platform of platforms) {
    const out = await packager({
      dir: ".",
      name: "Sideshow",
      platform,
      arch: "x64",
      out: "dist",
      overwrite: true,
      icon: "assets/icon",
      ignore: /\.map$/,
      afterExtract: [afterExtract],
    });
    console.log(`packed: ${out.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
