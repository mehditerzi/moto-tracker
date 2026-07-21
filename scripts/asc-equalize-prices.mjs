/**
 * Fill in world prices for every subscription from its Turkey price point.
 * The ASC UI does this automatically when you pick a price; the API sets only
 * the territory you POST, leaving 170+ territories unpriced — which reads as
 * "Missing Metadata" when availability is worldwide.
 *
 * Idempotent: existing prices 409 and are skipped. Handles 429 rate limits by
 * sleeping and resuming.
 *
 * Usage: ASC_ISSUER_ID=<uuid> node scripts/asc-equalize-prices.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";

const GROUP_ID = "22251276";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body, attempt = 0) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && attempt < 5) {
    console.log("  rate limited — sleeping 60s");
    await sleep(60_000);
    return req(method, path, body, attempt + 1);
  }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json };
}

async function all(path) {
  let url = path;
  const out = [];
  while (url) {
    const page = await req("GET", url);
    if (page.status >= 400) throw new Error(`GET ${url} → ${page.status}`);
    out.push(...(page.json.data ?? []));
    url = page.json.links?.next ? page.json.links.next.replace(BASE, "") : null;
  }
  return out;
}

const subs = await all(`/v1/subscriptionGroups/${GROUP_ID}/subscriptions?limit=200`);
for (const sub of subs) {
  const pid = sub.attributes.productId;
  // Current TUR price → its price point drives the equalizations.
  const prices = await req(
    "GET",
    `/v1/subscriptions/${sub.id}/prices?filter[territory]=TUR&include=subscriptionPricePoint&limit=5`,
  );
  const point = prices.json?.included?.find((i) => i.type === "subscriptionPricePoints");
  if (!point) {
    console.log(`${pid}: NO TUR PRICE — skipping`);
    continue;
  }
  const eq = await all(
    `/v1/subscriptionPricePoints/${point.id}/equalizations?include=territory&limit=8000`,
  );
  let created = 0;
  let existed = 0;
  let failed = 0;
  for (const e of eq) {
    const r = await req("POST", "/v1/subscriptionPrices", {
      data: {
        type: "subscriptionPrices",
        relationships: {
          subscription: { data: { type: "subscriptions", id: sub.id } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: e.id } },
        },
      },
    });
    if (r.status === 201) created++;
    else if (r.status === 409) existed++;
    else failed++;
  }
  console.log(`${pid}: ${eq.length} territories → created ${created}, existed ${existed}, failed ${failed}`);
}
console.log("done");
