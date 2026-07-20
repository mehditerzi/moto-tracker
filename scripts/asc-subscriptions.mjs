/**
 * Create the Garajım vehicle-pack subscriptions in App Store Connect.
 *
 * Idempotent: safe to re-run — existing group/subscriptions/localizations/
 * prices are detected and skipped, so a partial failure just needs a re-run.
 * Also deletes the stray NON-consumable "garage.*" in-app purchase created by
 * mistake (subscriptions are a different product type).
 *
 * Usage:
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-subscriptions.mjs
 * Env:
 *   ASC_ISSUER_ID  (required) Users and Access → Integrations → App Store Connect API
 *   ASC_KEY_ID     (default K5U84RN5N3)
 *   ASC_KEY_PATH   (default secrets/asc/AuthKey_<keyid>.p8)
 */
import crypto from "node:crypto";
import fs from "node:fs";

const BUNDLE_ID = "com.mehditerzi.mototracker";
const GROUP_NAME = "Garaj Aboneliği";
const PACKS = [3, 5, 10, 20, 30, 40, 50];
const UNIT = { monthly: 20, yearly: 100 };
const disc = (n) => (n >= 30 ? 0.3 : n >= 20 ? 0.2 : n >= 10 ? 0.1 : 0);
const priceTry = (n, p) => Math.round(n * UNIT[p] * (1 - disc(n)));
// 3.monthly: the original "garage" ID was burned by a deleted non-consumable —
// Apple never allows reuse — so it lives under "garaj" (must match the
// PRODUCT_ID_OVERRIDES map in packages/shared/src/schemas/iap.ts).
const productIdFor = (n, p) =>
  n === 3 && p === "monthly" ? `${BUNDLE_ID}.garaj.3.monthly` : `${BUNDLE_ID}.garage.${n}.${p}`;
// ASC group level: 1 = highest level of service (biggest pack). Monthly and
// yearly of the same pack share a level (crossgrade).
const levelFor = (n) => [...PACKS].sort((a, b) => b - a).indexOf(n) + 1;

const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_ID = process.env.ASC_KEY_ID ?? "K5U84RN5N3";
const KEY_PATH = process.env.ASC_KEY_PATH ?? `secrets/asc/AuthKey_${KEY_ID}.p8`;
if (!ISSUER) {
  console.error("ASC_ISSUER_ID is required (UUID from the Integrations page).");
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
async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.status} ${e.code}: ${e.detail ?? e.title}`).join("; ");
    const err = new Error(`${method} ${path} → ${res.status}${detail ? ` (${detail})` : ""}`);
    err.status = res.status;
    err.codes = (json?.errors ?? []).map((e) => e.code ?? "");
    throw err;
  }
  return json;
}
const isConflict = (e) =>
  e.status === 409 && e.codes?.some((c) => /DUPLICATE|ALREADY|CONFLICT|ENTITY_ERROR.*taken/i.test(c));

async function all(path) {
  // Follow pagination.
  let url = path;
  const out = [];
  while (url) {
    const page = await req("GET", url);
    out.push(...(page.data ?? []));
    url = page.links?.next ? page.links.next.replace(BASE, "") : null;
  }
  return out;
}

// ── main ─────────────────────────────────────────────────────────────────────
console.log("→ finding app", BUNDLE_ID);
const apps = await req("GET", `/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
const app = apps.data?.[0];
if (!app) throw new Error(`app with bundle id ${BUNDLE_ID} not found`);
console.log(`  app id ${app.id} (${app.attributes.name})`);

// 1. Stray non-consumable IAP(s) created by mistake: report always, delete
//    ONLY when explicitly requested via ASC_DELETE_STRAY=1.
try {
  const iaps = await all(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`);
  for (const iap of iaps) {
    if (iap.attributes.productId?.includes(".garage.")) {
      if (process.env.ASC_DELETE_STRAY === "1") {
        console.log(`→ deleting stray non-consumable IAP ${iap.attributes.productId} (${iap.id})`);
        await req("DELETE", `/v2/inAppPurchases/${iap.id}`);
        console.log("  deleted");
      } else {
        console.log(
          `! stray NON-consumable IAP found: ${iap.attributes.productId} (${iap.id}) — ` +
            "wrong product type; delete it in ASC or re-run with ASC_DELETE_STRAY=1. " +
            "Its product ID stays blocked for the subscription until it's gone.",
        );
      }
    }
  }
} catch (e) {
  console.warn("  (skipping IAP check:", e.message + ")");
}

// 2. Subscription group.
let groups = await all(`/v1/apps/${app.id}/subscriptionGroups?limit=200`);
let group = groups.find((g) => g.attributes.referenceName === GROUP_NAME);
if (group) {
  console.log(`→ group "${GROUP_NAME}" exists (${group.id})`);
} else {
  console.log(`→ creating group "${GROUP_NAME}"`);
  const created = await req("POST", "/v1/subscriptionGroups", {
    data: {
      type: "subscriptionGroups",
      attributes: { referenceName: GROUP_NAME },
      relationships: { app: { data: { type: "apps", id: app.id } } },
    },
  });
  group = created.data;
}

// 3. Territories (for availability) — fetched once.
const territories = await all(`/v1/territories?limit=200`);
console.log(`  ${territories.length} territories`);

const existing = await all(`/v1/subscriptionGroups/${group.id}/subscriptions?limit=200`);
const byProductId = new Map(existing.map((s) => [s.attributes.productId, s]));

for (const n of PACKS) {
  for (const period of ["monthly", "yearly"]) {
    const productId = productIdFor(n, period);
    const target = priceTry(n, period);
    const trName = `Garaj ${n} Araç (${period === "yearly" ? "Yıllık" : "Aylık"})`;

    // 3a. Subscription.
    let sub = byProductId.get(productId);
    if (sub) {
      console.log(`→ ${productId} exists (${sub.id})`);
    } else {
      console.log(`→ creating ${productId} (level ${levelFor(n)}, target ₺${target})`);
      try {
        const created = await req("POST", "/v1/subscriptions", {
          data: {
            type: "subscriptions",
            attributes: {
              name: trName,
              productId,
              subscriptionPeriod: period === "yearly" ? "ONE_YEAR" : "ONE_MONTH",
              groupLevel: levelFor(n),
              familySharable: false,
            },
            relationships: { group: { data: { type: "subscriptionGroups", id: group.id } } },
          },
        });
        sub = created.data;
      } catch (e) {
        console.error(`  FAILED: ${e.message}`);
        continue;
      }
    }

    // 3b. Turkish localization.
    try {
      await req("POST", "/v1/subscriptionLocalizations", {
        data: {
          type: "subscriptionLocalizations",
          attributes: { locale: "tr", name: trName, description: `En fazla ${n} araç takip edin` },
          relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } },
        },
      });
      console.log("  localization tr ✓");
    } catch (e) {
      if (isConflict(e) || e.status === 409) console.log("  localization exists");
      else console.error(`  localization FAILED: ${e.message}`);
    }

    // 3c. Price — nearest TUR price point to the formula price.
    try {
      const points = await all(
        `/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=TUR&limit=8000`,
      );
      if (!points.length) throw new Error("no TUR price points returned");
      const best = points.reduce((a, b) =>
        Math.abs(Number(b.attributes.customerPrice) - target) <
        Math.abs(Number(a.attributes.customerPrice) - target)
          ? b
          : a,
      );
      await req("POST", "/v1/subscriptionPrices", {
        data: {
          type: "subscriptionPrices",
          relationships: {
            subscription: { data: { type: "subscriptions", id: sub.id } },
            subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: best.id } },
          },
        },
      });
      console.log(`  price ₺${best.attributes.customerPrice} ✓ (target ₺${target})`);
    } catch (e) {
      if (e.status === 409) console.log("  price exists");
      else console.error(`  price FAILED: ${e.message}`);
    }

    // 3d. Availability — all territories, auto-include future ones.
    try {
      await req("POST", "/v1/subscriptionAvailabilities", {
        data: {
          type: "subscriptionAvailabilities",
          attributes: { availableInNewTerritories: true },
          relationships: {
            subscription: { data: { type: "subscriptions", id: sub.id } },
            availableTerritories: {
              data: territories.map((t) => ({ type: "territories", id: t.id })),
            },
          },
        },
      });
      console.log("  availability ✓");
    } catch (e) {
      if (e.status === 409) console.log("  availability exists");
      else console.error(`  availability FAILED: ${e.message}`);
    }
  }
}

console.log("\nDone. Remaining manual steps in App Store Connect:");
console.log("  • add a review screenshot per subscription when submitting");
console.log("  • set App Store Server Notifications V2 URLs (App Information)");
console.log("  • attach the subscriptions to the next app version for review");
