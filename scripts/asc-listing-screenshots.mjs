/**
 * Replace the App Store listing screenshots on an app store version.
 *
 * The listing had 6.5" screenshots captured 2026-06-24 — before the full-screen
 * map, the rebuilt form controls and vehicle groups — and the en-US locale had
 * none at all. Stale screenshots are worse than none: they are what a reviewer
 * compares the binary against.
 *
 * Sources are produced by the capture harness against an isolated demo
 * database, never against real accounts.
 *
 * Usage:
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-listing-screenshots.mjs <shotsDir> [--dry]
 *
 * <shotsDir> holds <device>/<locale>/*.png, e.g. 6.9/tr/1-dashboard.png.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERSION_ID = process.env.ASC_VERSION_ID ?? "a9d77828-359c-4727-9377-133af0b58132";
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_ID = process.env.ASC_KEY_ID ?? "K5U84RN5N3";
if (!ISSUER) throw new Error("ASC_ISSUER_ID required");
const KEY = fs.readFileSync(`secrets/asc/AuthKey_${KEY_ID}.p8`, "utf8");

const SHOTS = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!SHOTS) throw new Error("usage: node scripts/asc-listing-screenshots.mjs <shotsDir>");

/**
 * Local directory name -> Apple's screenshotDisplayType.
 *
 * There is no `APP_IPHONE_69`. Apple folded the 6.9" iPhone into the existing
 * `APP_IPHONE_67` bucket rather than adding an enum case, and that bucket takes
 * either 1290x2796 (6.7") or 1320x2868 (6.9"). The 6.9" captures go there.
 */
const DISPLAY_TYPE = { "6.9": "APP_IPHONE_67", "6.5": "APP_IPHONE_65" };
/** Local locale dir -> App Store locale. */
const LOCALE = { tr: "tr", en: "en-US" };

const b64u = (b) => Buffer.from(b).toString("base64url");
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const p = b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
  const sig = crypto.sign("sha256", Buffer.from(`${h}.${p}`), { key: KEY, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${b64u(sig)}`;
}
const BASE = "https://api.appstoreconnect.apple.com";
async function req(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method} ${p} → ${res.status} ${json?.errors?.map((e) => e.detail ?? e.title).join("; ") ?? ""}`);
  }
  return json;
}

/** Upload one PNG into a screenshot set and wait for Apple to accept it. */
async function upload(setId, file) {
  const png = fs.readFileSync(file);
  const md5 = crypto.createHash("md5").update(png).digest("hex");
  const reservation = await req("POST", "/v1/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: { fileName: path.basename(file), fileSize: png.length },
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
    },
  });
  const id = reservation.data.id;
  for (const op of reservation.data.attributes.uploadOperations ?? []) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const up = await fetch(op.url, { method: op.method, headers, body: png.subarray(op.offset, op.offset + op.length) });
    if (!up.ok) throw new Error(`chunk → ${up.status} ${await up.text()}`);
  }
  // `uploaded: true` plus the checksum is what commits it; without this the
  // asset sits in AWAITING_UPLOAD forever and silently blocks submission — the
  // exact state that stranded an IAP screenshot earlier in this project.
  await req("PATCH", `/v1/appScreenshots/${id}`, {
    data: { type: "appScreenshots", id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
  });
  return id;
}

async function deliveryState(id) {
  const r = await req("GET", `/v1/appScreenshots/${id}`);
  const s = r.data.attributes.assetDeliveryState ?? {};
  return { state: s.state, errors: s.errors ?? [] };
}

const locs = await req("GET", `/v1/appStoreVersions/${VERSION_ID}/appStoreVersionLocalizations`);
const byLocale = Object.fromEntries(locs.data.map((l) => [l.attributes.locale, l.id]));
console.log("version localizations:", Object.keys(byLocale).join(", "));

const uploaded = [];
for (const devDir of Object.keys(DISPLAY_TYPE)) {
  for (const locDir of Object.keys(LOCALE)) {
    const dir = path.join(SHOTS, devDir, locDir);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    const locale = LOCALE[locDir];
    const locId = byLocale[locale];
    if (!locId) { console.log(`! no ${locale} localization, skipping`); continue; }
    const displayType = DISPLAY_TYPE[devDir];
    console.log(`\n=== ${locale} / ${displayType} — ${files.length} file(s)`);
    if (DRY) { files.forEach((f) => console.log(`   would upload ${f}`)); continue; }

    // Reuse the existing set for this display type, emptying it first: Apple
    // keeps old assets otherwise and the listing would mix Jun 24 and today.
    const sets = await req("GET", `/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets`);
    let set = sets.data.find((s) => s.attributes.screenshotDisplayType === displayType);
    if (set) {
      const old = await req("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots`);
      for (const o of old.data ?? []) {
        await req("DELETE", `/v1/appScreenshots/${o.id}`);
        console.log(`   removed old ${o.attributes.fileName}`);
      }
    } else {
      set = (await req("POST", "/v1/appScreenshotSets", {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: displayType },
          relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: locId } } },
        },
      })).data;
      console.log(`   created set ${set.id}`);
    }

    for (const f of files) {
      const id = await upload(set.id, path.join(dir, f));
      uploaded.push({ locale, displayType, file: f, id });
      console.log(`   uploaded ${f}`);
    }
  }
}

if (!DRY && uploaded.length) {
  // Delivery is asynchronous. Report the real state rather than assuming.
  console.log("\n=== verifying delivery");
  for (let attempt = 0; attempt < 10; attempt++) {
    const states = await Promise.all(uploaded.map((u) => deliveryState(u.id)));
    const pending = states.filter((s) => s.state !== "COMPLETE");
    if (!pending.length) { console.log(`all ${uploaded.length} assets COMPLETE`); break; }
    const failed = states.filter((s) => (s.errors ?? []).length);
    if (failed.length) {
      failed.forEach((f) => console.error("  ERROR", JSON.stringify(f.errors)));
      break;
    }
    if (attempt === 9) console.error(`  ${pending.length} still not COMPLETE: ${pending.map((p) => p.state).join(", ")}`);
    else await new Promise((r) => setTimeout(r, 3000));
  }
}
console.log("\ndone");
