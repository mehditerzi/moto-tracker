/**
 * Garajım Pro in App Store Connect — the whole product, idempotently.
 *
 *   1. the "Garajım Pro" subscription group (+ tr / en display names)
 *   2. pro.yearly and pro.monthly, same group level (a crossgrade, not a tier)
 *   3. tr / en localizations
 *   4. the TUR price, then every other territory from Apple's equalizations
 *   5. worldwide availability
 *   6. a one-week FREE TRIAL introductory offer, in every territory
 *   7. the App Review screenshot (pass --screenshot <png>)
 *
 * Every step checks before it writes, so a re-run only fills what is missing.
 * Dry run by default — nothing is written without --apply.
 *
 * What it cannot do: the FIRST subscription of a new group has to be submitted
 * together with an app version, and App Store Connect only lets you attach it
 * on the version page in the web UI ("In-App Purchases and Subscriptions").
 * See docs/ios-iap.md.
 *
 * Usage:
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-pro.mjs                       # dry run
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-pro.mjs --apply --screenshot docs/app-store/pro-paywall.png
 */
import crypto from "node:crypto";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const shotIdx = process.argv.indexOf("--screenshot");
const SCREENSHOT = shotIdx === -1 ? null : process.argv[shotIdx + 1];

const APP_ID = "6783515081";
const GROUP_NAME = "Garajım Pro";
const PRODUCTS = [
  {
    productId: "com.mehditerzi.mototracker.pro.yearly",
    name: "Garajım Pro (Yıllık)",
    period: "ONE_YEAR",
    tryPrice: 349.99,
    loc: {
      tr: { name: "Garajım Pro — Yıllık", description: "Sınırsız araç, tarama, masraf raporu, torpido" },
      "en-US": { name: "Garajım Pro — Yearly", description: "Unlimited vehicles, scans, cost reports, glovebox" },
    },
  },
  {
    productId: "com.mehditerzi.mototracker.pro.monthly",
    name: "Garajım Pro (Aylık)",
    period: "ONE_MONTH",
    tryPrice: 59.99,
    loc: {
      tr: { name: "Garajım Pro — Aylık", description: "Sınırsız araç, tarama, masraf raporu, torpido" },
      "en-US": { name: "Garajım Pro — Monthly", description: "Unlimited vehicles, scans, cost reports, glovebox" },
    },
  },
];
const REVIEW_NOTE =
  "Garajım Pro unlocks unlimited vehicles, unlimited document scans, the cost report with CSV export and an " +
  "unlimited digital glovebox. Free users keep one vehicle and 5 scans per month. To reach the paywall: sign in " +
  "with the demo account, open the Assistant tab and tap the Garajım Pro card (or try adding a second vehicle).";

const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_ID = process.env.ASC_KEY_ID ?? "K5U84RN5N3";
const KEY = fs.readFileSync(process.env.ASC_KEY_PATH ?? `secrets/asc/AuthKey_${KEY_ID}.p8`, "utf8");
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
  if (res.status === 429 && attempt < 6) {
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
    if (page.status >= 400) throw new Error(`GET ${url} → ${page.status} ${JSON.stringify(page.json?.errors?.[0])}`);
    out.push(...(page.json.data ?? []));
    url = page.json.links?.next ? page.json.links.next.replace(BASE, "") : null;
  }
  return out;
}
function err(r) {
  return `${r.status} ${r.json?.errors?.map((e) => e.detail ?? e.title).join("; ") ?? ""}`;
}
/** POST in apply mode; report the intent in a dry run. */
async function write(label, method, path, body) {
  if (!APPLY) {
    console.log(`  [dry] ${label}`);
    return null;
  }
  const r = await req(method, path, body);
  if (r.status >= 400 && r.status !== 409) console.log(`  ✗ ${label} → ${err(r)}`);
  else console.log(`  ✓ ${label}${r.status === 409 ? " (exists)" : ""}`);
  return r;
}

// ─── 1. group ────────────────────────────────────────────────────────────────
const groups = await all(`/v1/apps/${APP_ID}/subscriptionGroups?limit=50`);
let group = groups.find((g) => g.attributes.referenceName === GROUP_NAME);
console.log(`group "${GROUP_NAME}": ${group ? group.id : "missing"}`);
if (!group) {
  const r = await write(`create group ${GROUP_NAME}`, "POST", "/v1/subscriptionGroups", {
    data: {
      type: "subscriptionGroups",
      attributes: { referenceName: GROUP_NAME },
      relationships: { app: { data: { type: "apps", id: APP_ID } } },
    },
  });
  group = r?.json?.data ?? null;
}
if (group) {
  const glocs = await all(`/v1/subscriptionGroups/${group.id}/subscriptionGroupLocalizations?limit=50`);
  for (const locale of ["tr", "en-US"]) {
    if (glocs.some((l) => l.attributes.locale === locale)) continue;
    await write(`group localization ${locale}`, "POST", "/v1/subscriptionGroupLocalizations", {
      data: {
        type: "subscriptionGroupLocalizations",
        attributes: { locale, name: "Garajım Pro", customAppName: "Garajım" },
        relationships: { subscriptionGroup: { data: { type: "subscriptionGroups", id: group.id } } },
      },
    });
  }
}

const territories = await all("/v1/territories?limit=200");
const existing = group ? await all(`/v1/subscriptionGroups/${group.id}/subscriptions?limit=50`) : [];

for (const p of PRODUCTS) {
  console.log(`\n${p.productId}`);
  let sub = existing.find((s) => s.attributes.productId === p.productId);
  if (!sub) {
    if (!group) {
      console.log("  [dry] create subscription (after the group exists)");
      continue;
    }
    const r = await write("create subscription", "POST", "/v1/subscriptions", {
      data: {
        type: "subscriptions",
        attributes: {
          name: p.name,
          productId: p.productId,
          subscriptionPeriod: p.period,
          groupLevel: 1,
          familySharable: false,
          reviewNote: REVIEW_NOTE,
        },
        relationships: { group: { data: { type: "subscriptionGroups", id: group.id } } },
      },
    });
    sub = r?.json?.data;
    if (!sub) continue;
  } else {
    console.log(`  exists (${sub.id}, state ${sub.attributes.state})`);
  }

  // ─── 3. localizations
  const locs = await all(`/v1/subscriptions/${sub.id}/subscriptionLocalizations?limit=50`);
  for (const [locale, l] of Object.entries(p.loc)) {
    if (locs.some((x) => x.attributes.locale === locale)) continue;
    await write(`localization ${locale}`, "POST", "/v1/subscriptionLocalizations", {
      data: {
        type: "subscriptionLocalizations",
        attributes: { locale, name: l.name, description: l.description },
        relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } },
      },
    });
  }

  // ─── 4. prices: TUR first, then Apple's equalizations everywhere else
  const current = await req("GET", `/v1/subscriptions/${sub.id}/prices?include=subscriptionPricePoint,territory&limit=200`);
  const pricedTerritories = new Set(
    (current.json?.data ?? []).map((x) => x.relationships?.territory?.data?.id).filter(Boolean),
  );
  let turPoint = (current.json?.included ?? []).find(
    (i) => i.type === "subscriptionPricePoints" && (current.json?.data ?? []).some(
      (d) => d.relationships?.territory?.data?.id === "TUR" && d.relationships?.subscriptionPricePoint?.data?.id === i.id,
    ),
  );
  if (!turPoint) {
    const points = await all(`/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=TUR&limit=8000`);
    turPoint = points.reduce((a, b) =>
      Math.abs(Number(b.attributes.customerPrice) - p.tryPrice) < Math.abs(Number(a.attributes.customerPrice) - p.tryPrice) ? b : a,
    );
    // A 409 here is NOT "already set": on a subscription created seconds ago
    // Apple answers the first price write with a conflict and stores nothing,
    // which leaves the product in MISSING_METADATA. Retry until it is a 201.
    for (let attempt = 0; APPLY && attempt < 4; attempt++) {
      const r = await req("POST", "/v1/subscriptionPrices", {
        data: {
          type: "subscriptionPrices",
          attributes: { preserveCurrentPrice: false },
          relationships: {
            subscription: { data: { type: "subscriptions", id: sub.id } },
            subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: turPoint.id } },
          },
        },
      });
      console.log(`  TUR price ₺${turPoint.attributes.customerPrice} → ${r.status}`);
      if (r.status === 201) break;
      await sleep(5000);
    }
    if (!APPLY) await write(`TUR price ₺${turPoint.attributes.customerPrice}`, "POST", "/v1/subscriptionPrices", {
      data: {
        type: "subscriptionPrices",
        attributes: { preserveCurrentPrice: false },
        relationships: {
          subscription: { data: { type: "subscriptions", id: sub.id } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: turPoint.id } },
        },
      },
    });
  } else {
    console.log(`  TUR price ₺${turPoint.attributes.customerPrice}`);
  }
  const eq = await all(`/v1/subscriptionPricePoints/${turPoint.id}/equalizations?include=territory&limit=8000`);
  const missing = eq.filter((e) => !pricedTerritories.has(e.relationships?.territory?.data?.id));
  console.log(`  world prices: ${eq.length - missing.length}/${eq.length} set, ${missing.length} to add`);
  if (APPLY) {
    let ok = 0;
    let bad = 0;
    let firstErr = null;
    for (const e of missing) {
      const r = await req("POST", "/v1/subscriptionPrices", {
        data: {
          type: "subscriptionPrices",
          attributes: { preserveCurrentPrice: false },
          relationships: {
            subscription: { data: { type: "subscriptions", id: sub.id } },
            subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: e.id } },
          },
        },
      });
      // Only a 201 is a price. A 409 is how Apple refuses an equalization
      // before the base (TUR) price has landed — it is not "already there".
      if (r.status === 201) ok++;
      else {
        bad++;
        firstErr ??= err(r);
      }
    }
    console.log(`  ${bad ? "✗" : "✓"} world prices: ${ok} written, ${bad} failed${firstErr ? ` (${firstErr})` : ""}`);
  }

  // ─── 5. availability
  const av = await req("GET", `/v1/subscriptions/${sub.id}/subscriptionAvailability`);
  if (!av.json?.data) {
    await write("worldwide availability", "POST", "/v1/subscriptionAvailabilities", {
      data: {
        type: "subscriptionAvailabilities",
        attributes: { availableInNewTerritories: true },
        relationships: {
          subscription: { data: { type: "subscriptions", id: sub.id } },
          availableTerritories: { data: territories.map((tt) => ({ type: "territories", id: tt.id })) },
        },
      },
    });
  } else console.log("  availability set");

  // ─── 6. one-week free trial, per territory
  const offers = await all(`/v1/subscriptions/${sub.id}/introductoryOffers?include=territory&limit=200`);
  const offered = new Set(offers.map((o) => o.relationships?.territory?.data?.id).filter(Boolean));
  const needOffer = territories.filter((tt) => !offered.has(tt.id));
  console.log(`  free trial: ${offered.size}/${territories.length} territories, ${needOffer.length} to add`);
  if (APPLY) {
    let ok = 0;
    let bad = 0;
    let firstErr = null;
    for (const tt of needOffer) {
      const r = await req("POST", "/v1/subscriptionIntroductoryOffers", {
        data: {
          type: "subscriptionIntroductoryOffers",
          attributes: { duration: "ONE_WEEK", offerMode: "FREE_TRIAL", numberOfPeriods: 1 },
          relationships: {
            subscription: { data: { type: "subscriptions", id: sub.id } },
            territory: { data: { type: "territories", id: tt.id } },
          },
        },
      });
      if (r.status === 201 || r.status === 409) ok++;
      else {
        bad++;
        firstErr ??= err(r);
      }
    }
    console.log(`  ✓ free trial: ${ok} written, ${bad} failed${firstErr ? ` (${firstErr})` : ""}`);
  }

  // ─── 7. review screenshot
  let shot = await req("GET", `/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`);
  const shotState = shot.json?.data?.attributes?.assetDeliveryState?.state;
  if (shot.json?.data && shotState === "FAILED" && APPLY && SCREENSHOT) {
    // A failed asset blocks the product (MISSING_METADATA) and is never retried.
    await req("DELETE", `/v1/subscriptionAppStoreReviewScreenshots/${shot.json.data.id}`);
    console.log("  removed FAILED review screenshot");
    shot = { json: null };
  }
  if (shot.json?.data) {
    console.log("  review screenshot set");
  } else if (!SCREENSHOT) {
    console.log("  review screenshot MISSING — pass --screenshot <png>");
  } else if (APPLY) {
    const buf = fs.readFileSync(SCREENSHOT);
    const res = await req("POST", "/v1/subscriptionAppStoreReviewScreenshots", {
      data: {
        type: "subscriptionAppStoreReviewScreenshots",
        attributes: { fileName: SCREENSHOT.split("/").pop(), fileSize: buf.length },
        relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } },
      },
    });
    const r = res.json?.data;
    if (!r) {
      console.log(`  ✗ screenshot reservation → ${err(res)}`);
    } else {
      for (const op of r.attributes.uploadOperations ?? []) {
        const chunk = buf.subarray(op.offset, op.offset + op.length);
        const up = await fetch(op.url, {
          method: op.method,
          headers: Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value])),
          body: chunk,
        });
        if (!up.ok) console.log(`  ✗ screenshot chunk → ${up.status}`);
      }
      const md5 = crypto.createHash("md5").update(buf).digest("hex");
      const done = await req("PATCH", `/v1/subscriptionAppStoreReviewScreenshots/${r.id}`, {
        data: { type: "subscriptionAppStoreReviewScreenshots", id: r.id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
      });
      console.log(`  ✓ review screenshot → ${done.status}`);
    }
  } else console.log(`  [dry] upload review screenshot ${SCREENSHOT}`);
}
console.log(APPLY ? "\ndone" : "\ndry run — re-run with --apply to write");
