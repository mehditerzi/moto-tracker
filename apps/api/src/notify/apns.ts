import http2 from "node:http2";
import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Minimal APNs (Apple Push Notification service) sender — provider token (JWT)
 * auth over HTTP/2, using only Node built-ins (no extra dependency).
 *
 * Entirely gated behind APNS_* config: when unconfigured every call is a no-op
 * returning `{ ok: false, skipped: true }`, so the rest of the pipeline is
 * unaffected until you add Apple credentials. See docs/app-store/native-push.md.
 *
 * NOTE: this transport has not been exercised against live APNs in this repo —
 * verify on a real device once credentials are in place.
 */

export interface ApnsResult {
  ok: boolean;
  /** Token is no longer valid (HTTP 410) — caller should delete it. */
  gone?: boolean;
  /** APNs not configured — nothing was sent. */
  skipped?: boolean;
  status?: number;
  /** Apple's machine reason on failure (e.g. "InvalidProviderToken", "BadDeviceToken"). */
  reason?: string;
}

export interface ApnsPayload {
  title: string;
  body: string;
  url?: string;
}

export function apnsConfigured(): boolean {
  return !!(config.APNS_KEY && config.APNS_KEY_ID && config.APNS_TEAM_ID && config.APNS_BUNDLE_ID);
}

const b64url = (b: Buffer) =>
  b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

/** The .p8 may be supplied as raw PEM or base64-encoded PEM. */
function privateKeyPem(): string {
  const raw = config.APNS_KEY!;
  if (raw.includes("BEGIN")) return raw;
  return Buffer.from(raw, "base64").toString("utf8");
}

// APNs provider tokens are valid up to 60 min; reuse for 50.
let cached: { jwt: string; createdAtMs: number } | null = null;
function providerToken(nowMs: number): string {
  if (cached && nowMs - cached.createdAtMs < 50 * 60 * 1000) return cached.jwt;
  const header = b64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: config.APNS_KEY_ID })));
  const claims = b64url(
    Buffer.from(JSON.stringify({ iss: config.APNS_TEAM_ID, iat: Math.floor(nowMs / 1000) })),
  );
  const signingInput = `${header}.${claims}`;
  const sig = crypto.sign("SHA256", Buffer.from(signingInput), {
    key: privateKeyPem(),
    dsaEncoding: "ieee-p1363", // raw r||s — required by JWT ES256
  });
  const jwt = `${signingInput}.${b64url(sig)}`;
  cached = { jwt, createdAtMs: nowMs };
  return jwt;
}

export async function sendApns(deviceToken: string, payload: ApnsPayload): Promise<ApnsResult> {
  if (!apnsConfigured()) return { ok: false, skipped: true };

  const host = config.APNS_PRODUCTION
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
  const body = JSON.stringify({
    aps: { alert: { title: payload.title, body: payload.body }, sound: "default" },
    ...(payload.url ? { url: payload.url } : {}),
  });

  // Build the auth token up front so a malformed .p8 surfaces as a clear reason
  // instead of an unhandled throw inside the request.
  let token: string;
  try {
    token = providerToken(Date.now());
  } catch (e) {
    return { ok: false, reason: `key_error:${(e as Error).message}` };
  }

  return new Promise<ApnsResult>((resolve) => {
    let settled = false;
    const done = (r: ApnsResult) => {
      if (settled) return;
      settled = true;
      if (!r.ok && !r.skipped) {
        console.warn(`[apns] send failed status=${r.status ?? "?"} reason=${r.reason ?? "?"}`);
      }
      try { client.close(); } catch { /* noop */ }
      resolve(r);
    };
    const client = http2.connect(host);
    client.on("error", (e) => done({ ok: false, reason: `connect:${e.message}` }));

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${token}`,
      "apns-topic": config.APNS_BUNDLE_ID!,
      "apns-push-type": "alert",
      "content-type": "application/json",
    });
    let status = 0;
    let raw = "";
    req.on("response", (h) => { status = Number(h[":status"]) || 0; });
    req.on("error", (e) => done({ ok: false, reason: `request:${e.message}` }));
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      // APNs returns `{"reason":"..."}` in the body on any non-200.
      let reason: string | undefined;
      if (raw) {
        try { reason = (JSON.parse(raw) as { reason?: string }).reason; } catch { /* non-JSON */ }
      }
      done({ ok: status === 200, gone: status === 410, status, reason });
    });
    req.end(body);
  });
}
