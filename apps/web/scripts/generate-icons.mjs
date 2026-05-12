/**
 * Generate PWA icon PNGs for MotoTracker.
 *
 * Outputs:
 *   apps/web/public/icons/maskable-512.png  — 512×512 maskable (dark bg + lime motorcycle icon)
 *   apps/web/public/icons/badge-72.png      — 72×72 monochrome badge (white circle on transparent)
 *
 * Run from repo root:
 *   node apps/web/scripts/generate-icons.mjs
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve sharp from the API package where it is declared as a dependency.
// pnpm hoists it into the pnpm virtual store; createRequire lets us load it
// from any package.json that lists it, regardless of our cwd.
const apiDir = path.resolve(__dirname, "../../../apps/api");
const require = createRequire(path.join(apiDir, "package.json"));
let sharp;
try {
  sharp = require("sharp");
} catch {
  // Fallback: try the pnpm virtual store path directly
  const storeSharp = path.resolve(
    __dirname,
    "../../../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp"
  );
  const req2 = createRequire(storeSharp + "/package.json");
  sharp = req2("sharp");
}

const ICONS_DIR = path.resolve(__dirname, "../public/icons");

// ---------------------------------------------------------------------------
// maskable-512.png — 512×512, dark bg (#0B0B0E) + lime motorcycle SVG overlay
// ---------------------------------------------------------------------------
const maskableSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <!-- filled circle in safe-zone lime -->
    <circle cx="256" cy="256" r="160" fill="#A3E635"/>
    <!-- minimal motorcycle silhouette (white) centered in safe zone -->
    <!-- rear wheel -->
    <circle cx="160" cy="320" r="60" fill="none" stroke="white" stroke-width="20"/>
    <!-- front wheel -->
    <circle cx="352" cy="320" r="60" fill="none" stroke="white" stroke-width="20"/>
    <!-- frame: seat mound to front fork -->
    <path d="M160 320 L256 180 L352 320" fill="none" stroke="white" stroke-width="20"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  "utf8"
);

await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: { r: 11, g: 11, b: 14, alpha: 1 },
  },
})
  .composite([{ input: maskableSvg, top: 0, left: 0 }])
  .png()
  .toFile(path.join(ICONS_DIR, "maskable-512.png"));

console.log("✓  maskable-512.png (512×512)");

// ---------------------------------------------------------------------------
// badge-72.png — 72×72 monochrome: white circle on transparent background
// ---------------------------------------------------------------------------
const badgeSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
    <circle cx="36" cy="36" r="30" fill="white"/>
  </svg>`,
  "utf8"
);

await sharp({
  create: {
    width: 72,
    height: 72,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: badgeSvg, top: 0, left: 0 }])
  .png()
  .toFile(path.join(ICONS_DIR, "badge-72.png"));

console.log("✓  badge-72.png (72×72)");
console.log("Done.");
