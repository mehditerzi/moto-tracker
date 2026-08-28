/**
 * READ-ONLY App Store Connect audit for the in-app purchase catalogue.
 *
 * Answers the question "why does StoreKit return no products in production?"
 * without touching a single byte of your ASC configuration. Every request this
 * script makes is a GET — there is no code path here that writes, and that is
 * deliberate: the other asc-*.mjs scripts all mutate.
 *
 * It lists every subscription and non-renewing/consumable IAP on the app with
 * its review state, then diffs that against the product IDs the app actually
 * asks StoreKit for (IAP_PRODUCT_IDS in packages/shared). Anything the app
 * requests but ASC does not have — or has in a non-purchasable state — is
 * silently omitted by `Product.products(for:)` at runtime, which is exactly how
 * a paywall ends up rendering buttons that fail on tap.
 *
 * Usage:
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-list-iap.mjs
 * Env:
 *   ASC_ISSUER_ID  (required) Users and Access → Integrations → App Store Connect API
 *   ASC_KEY_ID     (default K5U84RN5N3)
 *   ASC_KEY_PATH   (default secrets/asc/AuthKey_<keyid>.p8)
 *   ASC_BUNDLE_ID  (default com.mehditerzi.mototracker)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BUNDLE_ID = process.env.ASC_BUNDLE_ID ?? "com.mehditerzi.mototracker";
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_ID = process.env.ASC_KEY_ID ?? "K5U84RN5N3";
const KEY_PATH = process.env.ASC_KEY_PATH ?? `secrets/asc/AuthKey_${KEY_ID}.p8`;

if (!ISSUER) {
  console.error("ASC_ISSUER_ID is required (UUID from the Integrations page).");
  console.error("  ASC_ISSUER_ID=<uuid> node scripts/asc-list-iap.mjs");
  process.exit(1);
}
if (!fs.existsSync(KEY_PATH)) {
  console.error(`Private key not found at ${KEY_PATH} (set ASC_KEY_PATH).`);
  process.exit(1);
}
const PRIVATE_KEY = fs.readFileSync(KEY_PATH, "utf8");

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

/** GET only. Follows ASC pagination. */
async function get(pathAndQuery) {
  const out = [];
  let next = `${BASE}${pathAndQuery}`;
  while (next) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${jwt()}` } });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const detail = json?.errors
        ?.map((e) => `${e.status} ${e.code}: ${e.detail ?? e.title}`)
        .join("; ");
      throw new Error(detail || `${res.status} ${res.statusText} for ${next}`);
    }
    out.push(...(json?.data ?? []));
    next = json?.links?.next ?? null;
  }
  return out;
}

/**
 * States in which StoreKit will NOT hand the product to the app. This is the
 * crux: a product sitting in MISSING_METADATA looks present in the ASC UI but
 * is invisible to `Product.products(for:)`.
 */
const PURCHASABLE = new Set(["APPROVED", "READY_TO_SUBMIT", "DEVELOPER_REMOVED_FROM_SALE"]);
const OK_STATES = new Set(["APPROVED", "READY_TO_SUBMIT"]);

function mark(state) {
  if (OK_STATES.has(state)) return "  ok  ";
  if (state === "WAITING_FOR_REVIEW" || state === "IN_REVIEW") return " wait ";
  return " FAIL ";
}

/** Load the app's expected product ids from the shared package (built or TS). */
async function expectedProductIds() {
  const distUrl = pathToFileURL(
    path.resolve("packages/shared/dist/index.js"),
  ).href;
  try {
    const mod = await import(distUrl);
    if (mod.IAP_PRODUCT_IDS?.length) return mod.IAP_PRODUCT_IDS;
  } catch {
    /* fall through to the source-parse below */
  }
  console.warn(
    "! packages/shared is not built — run `pnpm --filter @mototracker/shared build`\n" +
      "  to diff against the app's real product list. Listing ASC only.\n",
  );
  return null;
}

async function main() {
  const apps = await get(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
  const app = apps[0];
  if (!app) {
    console.error(`No app found for bundleId ${BUNDLE_ID}.`);
    process.exit(1);
  }
  console.log(`App: ${app.attributes.name} (${BUNDLE_ID})  id=${app.id}\n`);

  const found = new Map(); // productId -> { kind, state, name }

  // ---- Auto-renewable subscriptions, grouped ----
  const groups = await get(`/v1/apps/${app.id}/subscriptionGroups?limit=200`);
  for (const g of groups) {
    const subs = await get(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=200`);
    console.log(`Subscription group "${g.attributes.referenceName}" — ${subs.length} product(s)`);
    for (const s of subs) {
      const a = s.attributes;
      found.set(a.productId, { kind: "sub", state: a.state, name: a.name });
      console.log(`  [${mark(a.state)}] ${a.productId.padEnd(52)} ${a.state}`);
    }
    console.log("");
  }

  // ---- Non-renewing subscriptions / consumables / non-consumables ----
  const iaps = await get(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`);
  console.log(`In-app purchases (non-renewing / consumable) — ${iaps.length} product(s)`);
  for (const p of iaps) {
    const a = p.attributes;
    found.set(a.productId, { kind: a.inAppPurchaseType, state: a.state, name: a.name });
    console.log(
      `  [${mark(a.state)}] ${a.productId.padEnd(52)} ${a.state}  (${a.inAppPurchaseType})`,
    );
  }
  console.log("");

  // ---- Diff against what the app actually requests ----
  const expected = await expectedProductIds();
  if (!expected) return;

  const missing = expected.filter((id) => !found.has(id));
  const notPurchasable = expected.filter(
    (id) => found.has(id) && !PURCHASABLE.has(found.get(id).state),
  );
  // The distinction that actually matters, and the one that cost a production
  // outage: SANDBOX serves READY_TO_SUBMIT, PRODUCTION serves only APPROVED.
  // A catalogue can look entirely healthy in testing and sell nothing on a real
  // device, so these two are counted separately and never summed.
  const sandboxOnly = expected.filter((id) => found.get(id)?.state === "READY_TO_SUBMIT");
  const liveReady = expected.filter((id) => found.get(id)?.state === "APPROVED");
  const extra = [...found.keys()].filter((id) => !expected.includes(id));

  console.log("─".repeat(72));
  console.log(`The app requests ${expected.length} product ids.`);
  console.log(`  APPROVED — sell in production : ${liveReady.length}`);
  console.log(`  READY_TO_SUBMIT — SANDBOX ONLY: ${sandboxOnly.length}`);
  console.log(`  NOT IN APP STORE CONNECT: ${missing.length}`);
  console.log(`  present but not purchasable anywhere: ${notPurchasable.length}`);
  console.log(`  in ASC but not requested by the app: ${extra.length}`);

  if (sandboxOnly.length) {
    console.log(
      `\nSANDBOX ONLY — ${sandboxOnly.length} product(s) are READY_TO_SUBMIT but never\n` +
        "submitted for review. They resolve in sandbox testing and return NOTHING on a\n" +
        "real device, so the paywall shows buttons that fail on tap. Submit them with:\n" +
        "  ASC_ISSUER_ID=… node scripts/asc-fix-iap.mjs --submit",
    );
  }

  if (missing.length) {
    console.log("\nMISSING — StoreKit silently omits these, so the paywall shows");
    console.log("buttons that fail on tap:");
    for (const id of missing) console.log(`  - ${id}`);
  }
  if (notPurchasable.length) {
    console.log("\nNOT PURCHASABLE — present, but in a state StoreKit will not serve:");
    for (const id of notPurchasable) console.log(`  - ${id}  ${found.get(id).state}`);
  }
  if (extra.length) {
    console.log("\nORPHANED IN ASC — configured but never requested (likely from an");
    console.log("older product-id scheme; harmless, but they cost you nothing to remove):");
    for (const id of extra) console.log(`  - ${id}  ${found.get(id).state}`);
  }

  console.log(
    "\nNote: this cannot see the Paid Applications Agreement, which the API does\n" +
      "not expose. If everything above is green and StoreKit still returns nothing,\n" +
      "check App Store Connect → Business → Agreements, Tax, and Banking; an\n" +
      "inactive agreement suppresses every product with no error anywhere.",
  );

  // Non-zero exit when the catalogue cannot serve the app — useful in CI.
  if (missing.length || notPurchasable.length) process.exit(2);
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  process.exit(1);
});
