/**
 * Generate the Sign in with Apple client secret (APPLE_CLIENT_SECRET).
 *
 * Apple's "client secret" is an ES256 JWT valid at most 6 months — set a
 * reminder to re-run this and update .env before it expires.
 *
 * Usage:
 *   node scripts/apple-client-secret.mjs <path/to/AuthKey_XXXX.p8> <KEY_ID> <TEAM_ID> <SERVICE_ID>
 *
 * SERVICE_ID = the Services ID from the developer portal (= APPLE_CLIENT_ID),
 * e.g. com.mehditerzi.mototracker.web
 */
import crypto from "node:crypto";
import fs from "node:fs";

const [keyPath, keyId, teamId, serviceId] = process.argv.slice(2);
if (!keyPath || !keyId || !teamId || !serviceId) {
  console.error("usage: node scripts/apple-client-secret.mjs <AuthKey.p8> <KEY_ID> <TEAM_ID> <SERVICE_ID>");
  process.exit(1);
}

const key = fs.readFileSync(keyPath, "utf8");
const b64u = (b) => Buffer.from(b).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = b64u(JSON.stringify({ alg: "ES256", kid: keyId }));
const payload = b64u(
  JSON.stringify({
    iss: teamId,
    iat: now,
    exp: now + 180 * 24 * 3600, // Apple's max is 6 months
    aud: "https://appleid.apple.com",
    sub: serviceId,
  }),
);
const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
  key,
  dsaEncoding: "ieee-p1363",
});

console.log(`APPLE_CLIENT_ID=${serviceId}`);
console.log(`APPLE_CLIENT_SECRET=${header}.${payload}.${b64u(sig)}`);
console.log(`# expires ${new Date((now + 180 * 24 * 3600) * 1000).toISOString().slice(0, 10)} — regenerate before then`);
