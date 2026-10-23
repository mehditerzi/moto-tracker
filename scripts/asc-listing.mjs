/**
 * Push a listing (name, subtitle, keywords, promo text, description, what's new)
 * from a JSON file onto the editable App Store version — creating that version
 * first if it does not exist yet.
 *
 * Name and subtitle live on the app's EDITABLE appInfo (the one in
 * PREPARE_FOR_SUBMISSION, which exists only while a version is being
 * prepared); everything else on the version's localizations.
 *
 * Dry run by default.
 *
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-listing.mjs docs/app-store/listing-1.4.json --version 1.4 [--apply]
 */
import crypto from "node:crypto";
import fs from "node:fs";

const APP_ID = "6783515081";
const FILE = process.argv[2];
const APPLY = process.argv.includes("--apply");
const vIdx = process.argv.indexOf("--version");
const VERSION = vIdx === -1 ? null : process.argv[vIdx + 1];
if (!FILE || !VERSION) throw new Error("usage: asc-listing.mjs <listing.json> --version <x.y> [--apply]");
const listing = JSON.parse(fs.readFileSync(FILE, "utf8"));

const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_ID = process.env.ASC_KEY_ID ?? "K5U84RN5N3";
const KEY = fs.readFileSync(`secrets/asc/AuthKey_${KEY_ID}.p8`, "utf8");
if (!ISSUER) throw new Error("ASC_ISSUER_ID required");
const b64u = (b) => Buffer.from(b).toString("base64url");
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const p = b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
  const sig = crypto.sign("sha256", Buffer.from(`${h}.${p}`), { key: KEY, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${b64u(sig)}`;
}
const BASE = "https://api.appstoreconnect.apple.com";
async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.errors?.map((e) => e.detail ?? e.title).join("; ")}`);
  return json;
}

// ─── the version ──────────────────────────────────────────────────────────────
const versions = await req("GET", `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=10`);
let version = versions.data.find((v) => v.attributes.versionString === VERSION);
if (!version) {
  console.log(`version ${VERSION} missing → ${APPLY ? "creating" : "[dry] would create"}`);
  if (APPLY) {
    version = (
      await req("POST", "/v1/appStoreVersions", {
        data: {
          type: "appStoreVersions",
          attributes: { platform: "IOS", versionString: VERSION, releaseType: "AFTER_APPROVAL" },
          relationships: { app: { data: { type: "apps", id: APP_ID } } },
        },
      })
    ).data;
  }
}
if (version) console.log(`version ${VERSION}: ${version.id} (${version.attributes.appStoreState})`);

// ─── version localizations ────────────────────────────────────────────────────
if (version) {
  const locs = await req("GET", `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  for (const [locale, l] of Object.entries(listing)) {
    if (locale.startsWith("_")) continue;
    const attrs = {
      description: l.description,
      keywords: l.keywords,
      promotionalText: l.promotionalText,
      whatsNew: l.whatsNew,
    };
    const existing = locs.data.find((x) => x.attributes.locale === locale);
    if (!APPLY) {
      console.log(`[dry] ${locale}: ${existing ? "update" : "create"} version localization`);
      continue;
    }
    if (existing) {
      await req("PATCH", `/v1/appStoreVersionLocalizations/${existing.id}`, {
        data: { type: "appStoreVersionLocalizations", id: existing.id, attributes: attrs },
      });
    } else {
      await req("POST", "/v1/appStoreVersionLocalizations", {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: { locale, ...attrs },
          relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
        },
      });
    }
    console.log(`✓ ${locale}: version localization`);
  }
}

// ─── name / subtitle on the editable appInfo ──────────────────────────────────
const infos = await req("GET", `/v1/apps/${APP_ID}/appInfos`);
const editable = infos.data.find((i) =>
  ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "WAITING_FOR_REVIEW"].includes(i.attributes.appStoreState ?? i.attributes.state),
);
if (!editable) {
  console.log("no editable appInfo yet (it appears once the new version exists) — name/subtitle skipped");
} else {
  const ilocs = await req("GET", `/v1/appInfos/${editable.id}/appInfoLocalizations`);
  for (const [locale, l] of Object.entries(listing)) {
    if (locale.startsWith("_")) continue;
    const existing = ilocs.data.find((x) => x.attributes.locale === locale);
    if (!existing) continue;
    if (!APPLY) {
      console.log(`[dry] ${locale}: name "${l.name}", subtitle "${l.subtitle}"`);
      continue;
    }
    await req("PATCH", `/v1/appInfoLocalizations/${existing.id}`, {
      data: { type: "appInfoLocalizations", id: existing.id, attributes: { name: l.name, subtitle: l.subtitle } },
    });
    console.log(`✓ ${locale}: name + subtitle`);
  }
}
console.log(APPLY ? "done" : "dry run — add --apply to write");
