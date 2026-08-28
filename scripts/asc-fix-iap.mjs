/**
 * Repair in-app purchases whose App Review screenshot never finished uploading,
 * and (optionally) submit READY_TO_SUBMIT products for review.
 *
 * WHY THIS EXISTS
 * ---------------
 * Uploading a review screenshot is three steps: reserve a slot, PUT the bytes,
 * then PATCH `uploaded: true` with the checksum. If the run dies between step 1
 * and step 3 the product keeps a screenshot row stuck in `AWAITING_UPLOAD`, and
 * ASC holds the product at MISSING_METADATA — which StoreKit silently omits from
 * `Product.products(for:)`, so the paywall shows a button that fails on tap.
 *
 * `asc-nonrenewing.mjs` cannot heal this. Its guard is:
 *
 *     if (existingShot.json?.data) { console.log("  screenshot: exists"); }
 *
 * An AWAITING_UPLOAD row IS truthy, so every re-run reports "exists" and skips.
 * The product stays broken forever. This script checks the delivery STATE, not
 * mere presence, and replaces an incomplete asset rather than skipping it.
 *
 * ON SUBMISSION: a complete screenshot only reaches READY_TO_SUBMIT, which
 * StoreKit serves in SANDBOX ONLY. Production serves APPROVED products. `--submit`
 * posts each READY_TO_SUBMIT product for App Review; approval is Apple's clock,
 * not ours.
 *
 * Usage:
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-fix-iap.mjs             # dry run (default)
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-fix-iap.mjs --apply     # repair screenshots
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-fix-iap.mjs --submit    # + submit for review
 */
import crypto from "node:crypto";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply") || process.argv.includes("--submit");
const SUBMIT = process.argv.includes("--submit");
const BUNDLE_ID = process.env.ASC_BUNDLE_ID ?? "com.mehditerzi.mototracker";
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_ID = process.env.ASC_KEY_ID ?? "K5U84RN5N3";
const KEY_PATH = process.env.ASC_KEY_PATH ?? `secrets/asc/AuthKey_${KEY_ID}.p8`;
const SHOT = process.env.ASC_REVIEW_SHOT ?? "secrets/asc/assets/paywall-review.png";

if (!ISSUER) {
  console.error("ASC_ISSUER_ID is required (Users and Access → Integrations).");
  process.exit(1);
}
for (const [label, p] of [["private key", KEY_PATH], ["review screenshot", SHOT]]) {
  if (!fs.existsSync(p)) {
    console.error(`${label} not found at ${p}`);
    process.exit(1);
  }
}

const PRIVATE_KEY = fs.readFileSync(KEY_PATH, "utf8");
const png = fs.readFileSync(SHOT);
const md5 = crypto.createHash("md5").update(png).digest("hex");

const b64u = (buf) => Buffer.from(buf).toString("base64url");
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const payload = b64u(
    JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }),
  );
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: PRIVATE_KEY,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64u(sig)}`;
}

const BASE = "https://api.appstoreconnect.apple.com";
async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
async function all(path) {
  const out = [];
  let next = `${BASE}${path}`;
  while (next) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${jwt()}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.errors?.[0]?.detail ?? `${res.status} for ${next}`);
    out.push(...(json.data ?? []));
    next = json.links?.next ?? null;
  }
  return out;
}
const detail = (r) => JSON.stringify(r.json?.errors?.[0]?.detail ?? r.json?.errors?.[0]?.title ?? "");

/** Reserve → PUT parts → PATCH uploaded. Returns true only if all three land. */
async function uploadScreenshot(iapId) {
  const rsv = await req("POST", "/v1/inAppPurchaseAppStoreReviewScreenshots", {
    data: {
      type: "inAppPurchaseAppStoreReviewScreenshots",
      attributes: { fileName: "paywall-review.png", fileSize: png.length },
      relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } } },
    },
  });
  if (rsv.status !== 201) return `reserve ${rsv.status} ${detail(rsv)}`;

  for (const op of rsv.json.data.attributes.uploadOperations ?? []) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((x) => [x.name, x.value]));
    const up = await fetch(op.url, {
      method: op.method,
      headers,
      body: png.subarray(op.offset, op.offset + op.length),
    });
    if (!up.ok) return `upload part ${up.status}`;
  }
  const commit = await req("PATCH", `/v1/inAppPurchaseAppStoreReviewScreenshots/${rsv.json.data.id}`, {
    data: {
      type: "inAppPurchaseAppStoreReviewScreenshots",
      id: rsv.json.data.id,
      attributes: { uploaded: true, sourceFileChecksum: md5 },
    },
  });
  return commit.status >= 400 ? `commit ${commit.status} ${detail(commit)}` : null;
}

const apps = await all(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
if (!apps[0]) {
  console.error(`No app for bundleId ${BUNDLE_ID}.`);
  process.exit(1);
}
console.log(`App: ${apps[0].attributes.name} (${BUNDLE_ID})`);
console.log(
  APPLY
    ? `Mode: APPLY${SUBMIT ? " + SUBMIT FOR REVIEW" : ""} — writes to App Store Connect\n`
    : "Mode: DRY RUN — nothing will be written. Re-run with --apply (or --submit).\n",
);

const iaps = await all(`/v1/apps/${apps[0].id}/inAppPurchasesV2?limit=200`);
const broken = [];
const submittable = [];

for (const iap of iaps) {
  const { productId, state } = iap.attributes;
  const shot = (await req("GET", `/v2/inAppPurchases/${iap.id}/appStoreReviewScreenshot`)).json?.data;
  const shotState = shot?.attributes?.assetDeliveryState?.state ?? (shot ? "UNKNOWN" : "NONE");
  if (shotState !== "COMPLETE") broken.push({ iap, productId, state, shot, shotState });
  else if (state === "READY_TO_SUBMIT") submittable.push({ iap, productId });
}

// ---- 1. repair incomplete screenshots ----
if (broken.length === 0) {
  console.log("Screenshots: all complete.\n");
} else {
  console.log(`Screenshots: ${broken.length} incomplete\n`);
  for (const b of broken) {
    if (!APPLY) {
      console.log(`  WOULD REPAIR ${b.productId.padEnd(48)} ${b.state}  screenshot=${b.shotState}`);
      continue;
    }
    process.stdout.write(`  repairing ${b.productId.padEnd(48)} screenshot=${b.shotState} … `);
    // A stranded reservation occupies the single screenshot slot; drop it first
    // or the new reserve is rejected as a duplicate.
    if (b.shot) await req("DELETE", `/v1/inAppPurchaseAppStoreReviewScreenshots/${b.shot.id}`);
    const err = await uploadScreenshot(b.iap.id);
    if (err) {
      console.log(`FAILED (${err})`);
    } else {
      const after = (await req("GET", `/v2/inAppPurchases/${b.iap.id}`)).json?.data?.attributes?.state;
      console.log(`done → ${after}`);
      if (after === "READY_TO_SUBMIT") submittable.push({ iap: b.iap, productId: b.productId });
    }
  }
  console.log("");
}

// ---- 2. submit for review ----
console.log(`Ready to submit for review: ${submittable.length}`);
if (!SUBMIT) {
  if (submittable.length) {
    console.log("  (not submitting — re-run with --submit)");
    console.log(
      "  These are purchasable in SANDBOX only until Apple approves them.\n" +
        "  Production serves APPROVED products, which is why they fail on device.",
    );
  }
} else {
  let ok = 0;
  let failed = 0;
  for (const s of submittable) {
    process.stdout.write(`  submitting ${s.productId.padEnd(48)} … `);
    const r = await req("POST", "/v1/inAppPurchaseSubmissions", {
      data: {
        type: "inAppPurchaseSubmissions",
        relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id: s.iap.id } } },
      },
    });
    if (r.status === 201) {
      ok++;
      console.log("submitted");
    } else {
      failed++;
      console.log(`FAILED ${r.status} ${detail(r)}`);
    }
  }
  console.log(`\n  ${ok} submitted, ${failed} failed.`);
}

console.log("\nRe-check any time with:  ASC_ISSUER_ID=… node scripts/asc-list-iap.mjs");
