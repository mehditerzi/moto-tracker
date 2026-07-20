import crypto from "node:crypto";
import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { config } from "../config.js";

/**
 * Short-lived MapKit JS authorization tokens. The web app's mapkit loader
 * calls this whenever MapKit asks for (re)authorization, so the signing key
 * never leaves the server. Same ES256/.p8 mechanics as APNs provider tokens.
 */
export const mapkitRouter: Router = Router();
mapkitRouter.use(requireUser);

const TOKEN_TTL_S = 30 * 60;

function teamId(): string | undefined {
  return config.MAPKIT_TEAM_ID ?? config.APNS_TEAM_ID;
}

export function mapkitEnabled(): boolean {
  return !!(config.MAPKIT_KEY && config.MAPKIT_KEY_ID && teamId());
}

const b64url = (b: Buffer) =>
  b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

/** The .p8 may be supplied as raw PEM or base64-encoded PEM. */
function privateKeyPem(): string {
  const raw = config.MAPKIT_KEY!;
  if (raw.includes("BEGIN")) return raw;
  return Buffer.from(raw, "base64").toString("utf8");
}

mapkitRouter.get("/", (_req, res) => {
  if (!mapkitEnabled()) {
    res.status(503).json({ error: "mapkit_unavailable" });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(
    Buffer.from(JSON.stringify({ alg: "ES256", kid: config.MAPKIT_KEY_ID, typ: "JWT" })),
  );
  // No `origin` claim on purpose: the iOS wrapper runs on capacitor://localhost
  // while the web runs on the public origin — a pinned origin would break one
  // of them. Short TTL + auth-required issuance is the control instead.
  const claims = b64url(
    Buffer.from(JSON.stringify({ iss: teamId(), iat: now, exp: now + TOKEN_TTL_S })),
  );
  const sig = crypto.sign("SHA256", Buffer.from(`${header}.${claims}`), {
    key: privateKeyPem(),
    dsaEncoding: "ieee-p1363",
  });
  res.json({ token: `${header}.${claims}.${b64url(sig)}`, expiresIn: TOKEN_TTL_S });
});
