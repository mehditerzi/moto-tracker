/**
 * Attach the review screenshot to every subscription in the Garaj group.
 * Idempotent: subscriptions that already have a screenshot are skipped.
 *
 * Usage: ASC_ISSUER_ID=<uuid> node scripts/asc-screenshots.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";

const GROUP_ID = "22251276";
const FILE = "secrets/asc/assets/paywall-review.png";

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
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status} ${json?.errors?.map((e) => e.detail ?? e.title).join("; ") ?? ""}`,
    );
  }
  return json;
}

const png = fs.readFileSync(FILE);
const md5 = crypto.createHash("md5").update(png).digest("hex");
console.log(`screenshot: ${FILE} (${png.length} bytes, md5 ${md5})`);

const subs = await req("GET", `/v1/subscriptionGroups/${GROUP_ID}/subscriptions?limit=200`);
for (const s of subs.data) {
  const pid = s.attributes.productId;
  // Skip when a screenshot already exists.
  const existing = await req("GET", `/v1/subscriptions/${s.id}/appStoreReviewScreenshot`).catch(() => null);
  if (existing?.data) {
    console.log(`→ ${pid}: screenshot exists, skipping`);
    continue;
  }

  const reservation = await req("POST", "/v1/subscriptionAppStoreReviewScreenshots", {
    data: {
      type: "subscriptionAppStoreReviewScreenshots",
      attributes: { fileName: "paywall-review.png", fileSize: png.length },
      relationships: { subscription: { data: { type: "subscriptions", id: s.id } } },
    },
  });
  const ops = reservation.data.attributes.uploadOperations ?? [];
  for (const op of ops) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const chunk = png.subarray(op.offset, op.offset + op.length);
    const up = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!up.ok) throw new Error(`upload chunk → ${up.status} ${await up.text()}`);
  }
  await req("PATCH", `/v1/subscriptionAppStoreReviewScreenshots/${reservation.data.id}`, {
    data: {
      type: "subscriptionAppStoreReviewScreenshots",
      id: reservation.data.id,
      attributes: { uploaded: true, sourceFileChecksum: md5 },
    },
  });
  console.log(`→ ${pid}: uploaded ✓`);
}
console.log("done");
