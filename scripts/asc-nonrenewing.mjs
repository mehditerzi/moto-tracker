/**
 * Create the 28 non-renewing multi-year IAPs (garage.<n>.<2yr|3yr|5yr|10yr>).
 * For each: product, tr localization, price schedule (TUR base, auto-equalized
 * worldwide), availability, and a review screenshot. Idempotent — existing
 * products/parts are detected and skipped.
 *
 * Usage: ASC_ISSUER_ID=<uuid> node scripts/asc-nonrenewing.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";

const APP_ID = "6783515081";
const BUNDLE = "com.mehditerzi.mototracker";
const PACKS = [3, 5, 10, 20, 30, 40, 50];
const TERMS = [
  { key: "2yr", per: 200, label: "2 Yıl" },
  { key: "3yr", per: 300, label: "3 Yıl" },
  { key: "5yr", per: 500, label: "5 Yıl" },
  { key: "10yr", per: 1000, label: "10 Yıl" },
];
const disc = (n) => (n >= 30 ? 0.3 : n >= 20 ? 0.2 : n >= 10 ? 0.1 : 0);
const priceTry = (n, per) => Math.round(n * per * (1 - disc(n)));
const SHOT = "secrets/asc/assets/paywall-review.png";

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
async function req(method, path, body, attempt = 0) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 60_000));
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
    out.push(...(page.json?.data ?? []));
    url = page.json?.links?.next ? page.json.links.next.replace(BASE, "") : null;
  }
  return out;
}

const png = fs.readFileSync(SHOT);
const md5 = crypto.createHash("md5").update(png).digest("hex");
const territories = await all("/v1/territories?limit=200");
const existing = await all(`/v1/apps/${APP_ID}/inAppPurchasesV2?limit=200`);
const byPid = new Map(existing.map((i) => [i.attributes.productId, i]));

let created = 0;
for (const n of PACKS) {
  for (const term of TERMS) {
    const productId = `${BUNDLE}.garage.${n}.${term.key}`;
    const name = `Garaj ${n} Araç (${term.label})`;
    const target = priceTry(n, term.per);

    // 1. Product
    let iap = byPid.get(productId);
    if (iap) {
      console.log(`${productId}: exists`);
    } else {
      const c = await req("POST", "/v2/inAppPurchases", {
        data: {
          type: "inAppPurchases",
          attributes: { name, productId, inAppPurchaseType: "NON_RENEWING_SUBSCRIPTION" },
          relationships: { app: { data: { type: "apps", id: APP_ID } } },
        },
      });
      if (c.status !== 201) {
        console.error(`${productId}: create FAILED ${c.status} ${JSON.stringify(c.json?.errors?.[0]?.detail)}`);
        continue;
      }
      iap = c.json.data;
      created++;
      console.log(`${productId}: created`);
    }
    const iapId = iap.id;

    // 2. Localization
    const loc = await req("POST", "/v1/inAppPurchaseLocalizations", {
      data: {
        type: "inAppPurchaseLocalizations",
        attributes: { locale: "tr", name, description: `En fazla ${n} araç — ${term.label.toLowerCase()} erişim` },
        relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } } },
      },
    });
    if (loc.status !== 201 && loc.status !== 409) console.error(`  loc FAILED ${loc.status} ${JSON.stringify(loc.json?.errors?.[0]?.detail)}`);

    // 3. Price schedule (TUR base, auto-equalized) — skip if one exists.
    const sched = await req("GET", `/v2/inAppPurchases/${iapId}/iapPriceSchedule`);
    if (sched.status === 200 && sched.json?.data) {
      console.log("  price: exists");
    } else {
      const pts = await all(`/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=TUR&limit=8000`);
      if (!pts.length) {
        console.error("  price FAILED: no TUR price points");
      } else {
        const best = pts.reduce((a, b) =>
          Math.abs(Number(b.attributes.customerPrice) - target) < Math.abs(Number(a.attributes.customerPrice) - target) ? b : a);
        const ps = await req("POST", "/v1/inAppPurchasePriceSchedules", {
          data: {
            type: "inAppPurchasePriceSchedules",
            relationships: {
              inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
              baseTerritory: { data: { type: "territories", id: "TUR" } },
              manualPrices: { data: [{ type: "inAppPurchasePrices", id: "${price1}" }] },
            },
          },
          included: [{
            type: "inAppPurchasePrices",
            id: "${price1}",
            attributes: { startDate: null },
            relationships: {
              inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: best.id } },
            },
          }],
        });
        console.log(`  price ₺${best.attributes.customerPrice} → ${ps.status}${ps.status >= 400 ? " " + JSON.stringify(ps.json?.errors?.[0]?.detail) : ""}`);
      }
    }

    // 4. Availability
    const av = await req("POST", "/v1/inAppPurchaseAvailabilities", {
      data: {
        type: "inAppPurchaseAvailabilities",
        attributes: { availableInNewTerritories: true },
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
          availableTerritories: { data: territories.map((tt) => ({ type: "territories", id: tt.id })) },
        },
      },
    });
    if (av.status !== 201 && av.status !== 409) console.error(`  availability FAILED ${av.status} ${JSON.stringify(av.json?.errors?.[0]?.detail)}`);

    // 5. Review screenshot
    const existingShot = await req("GET", `/v2/inAppPurchases/${iapId}/appStoreReviewScreenshot`);
    if (existingShot.json?.data) {
      console.log("  screenshot: exists");
    } else {
      const rsv = await req("POST", "/v1/inAppPurchaseAppStoreReviewScreenshots", {
        data: {
          type: "inAppPurchaseAppStoreReviewScreenshots",
          attributes: { fileName: "paywall-review.png", fileSize: png.length },
          relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } } },
        },
      });
      if (rsv.status !== 201) {
        console.error(`  screenshot reserve FAILED ${rsv.status} ${JSON.stringify(rsv.json?.errors?.[0]?.detail)}`);
      } else {
        for (const op of rsv.json.data.attributes.uploadOperations ?? []) {
          const headers = Object.fromEntries((op.requestHeaders ?? []).map((x) => [x.name, x.value]));
          await fetch(op.url, { method: op.method, headers, body: png.subarray(op.offset, op.offset + op.length) });
        }
        const commit = await req("PATCH", `/v1/inAppPurchaseAppStoreReviewScreenshots/${rsv.json.data.id}`, {
          data: { type: "inAppPurchaseAppStoreReviewScreenshots", id: rsv.json.data.id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
        });
        console.log(`  screenshot → ${commit.status}`);
      }
    }
  }
}
console.log(`\ndone — ${created} products created`);
