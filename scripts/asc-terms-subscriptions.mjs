/**
 * Migrate the auto-renewable side to the term model:
 *   - DELETE the monthly subscriptions (garage.<n>.monthly + garaj.3.monthly)
 *   - CREATE the 6-month subscriptions (garage.<n>.6mo) with tr localization,
 *     TUR price, worldwide availability. (Yearly stays untouched.)
 * Idempotent. Run asc-equalize-prices.mjs afterwards to world-price the new 6mo.
 *
 * Usage: ASC_ISSUER_ID=<uuid> node scripts/asc-terms-subscriptions.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";

const BUNDLE_ID = "com.mehditerzi.mototracker";
const GROUP_ID = "22251276";
const APP_ID = "6783515081";
const PACKS = [3, 5, 10, 20, 30, 40, 50];
const disc = (n) => (n >= 30 ? 0.3 : n >= 20 ? 0.2 : n >= 10 ? 0.1 : 0);
const sixMonthPrice = (n) => Math.round(n * 60 * (1 - disc(n))); // ₺60/vehicle
const levelFor = (n) => [...PACKS].sort((a, b) => b - a).indexOf(n) + 1;

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
  return { status: res.status, json };
}
async function all(path) {
  let url = path;
  const out = [];
  while (url) {
    const page = await req("GET", url);
    out.push(...(page.json?.data ?? []));
    url = page.json?.links?.next ? page.json.links.next.replace(BASE, "") : null;
  }
  return out;
}

const existing = await all(`/v1/subscriptionGroups/${GROUP_ID}/subscriptions?limit=200`);
const byId = new Map(existing.map((s) => [s.attributes.productId, s]));

// 1. Delete monthly subscriptions.
for (const s of existing) {
  if (/\.(monthly)$/.test(s.attributes.productId)) {
    const del = await req("DELETE", `/v1/subscriptions/${s.id}`);
    console.log(`delete ${s.attributes.productId} → ${del.status}${del.status >= 400 ? " " + JSON.stringify(del.json?.errors?.[0]?.detail) : ""}`);
  }
}

// 2. Create 6-month subscriptions.
const territories = await all("/v1/territories?limit=200");
for (const n of PACKS) {
  const productId = `${BUNDLE_ID}.garage.${n}.6mo`;
  const name = `Garaj ${n} Araç (6 Ay)`;
  const target = sixMonthPrice(n);
  let sub = byId.get(productId);
  if (sub) {
    console.log(`${productId} exists`);
  } else {
    const created = await req("POST", "/v1/subscriptions", {
      data: {
        type: "subscriptions",
        attributes: { name, productId, subscriptionPeriod: "SIX_MONTHS", groupLevel: levelFor(n), familySharable: false },
        relationships: { group: { data: { type: "subscriptionGroups", id: GROUP_ID } } },
      },
    });
    if (created.status !== 201) {
      console.error(`create ${productId} → ${created.status} ${JSON.stringify(created.json?.errors?.[0]?.detail)}`);
      continue;
    }
    sub = created.data ?? created.json.data;
    console.log(`created ${productId} (level ${levelFor(n)})`);
  }
  const subId = sub.id;
  // Localization
  const loc = await req("POST", "/v1/subscriptionLocalizations", {
    data: {
      type: "subscriptionLocalizations",
      attributes: { locale: "tr", name, description: `En fazla ${n} araç takip edin` },
      relationships: { subscription: { data: { type: "subscriptions", id: subId } } },
    },
  });
  console.log(`  loc → ${loc.status === 409 ? "exists" : loc.status}`);
  // TUR price (equalizer script fills the rest of the world)
  const points = await all(`/v1/subscriptions/${subId}/pricePoints?filter[territory]=TUR&limit=8000`);
  if (points.length) {
    const best = points.reduce((a, b) =>
      Math.abs(Number(b.attributes.customerPrice) - target) < Math.abs(Number(a.attributes.customerPrice) - target) ? b : a);
    const pr = await req("POST", "/v1/subscriptionPrices", {
      data: {
        type: "subscriptionPrices",
        relationships: {
          subscription: { data: { type: "subscriptions", id: subId } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: best.id } },
        },
      },
    });
    console.log(`  price ₺${best.attributes.customerPrice} → ${pr.status === 409 ? "exists" : pr.status}`);
  }
  // Availability
  const av = await req("POST", "/v1/subscriptionAvailabilities", {
    data: {
      type: "subscriptionAvailabilities",
      attributes: { availableInNewTerritories: true },
      relationships: {
        subscription: { data: { type: "subscriptions", id: subId } },
        availableTerritories: { data: territories.map((tt) => ({ type: "territories", id: tt.id })) },
      },
    },
  });
  console.log(`  availability → ${av.status === 409 ? "exists" : av.status}`);
}
console.log("done — now run asc-equalize-prices.mjs to world-price the 6-month subs");
