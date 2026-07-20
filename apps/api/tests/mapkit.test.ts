import { describe, it, expect } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { config } from "../src/config.js";

describe("/api/mapkit-token", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    expect((await request(app).get("/api/mapkit-token")).status).toBe(401);
  });

  it("503s while MapKit is unconfigured, and public-config reflects it", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/mapkit-token").set("Cookie", cookie);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("mapkit_unavailable");
    const cfg = await request(app).get("/api/public-config");
    expect(cfg.body.mapkit).toBe(false);
  });

  it("issues a decodable ES256 JWT once configured", async () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const mutable = config as { MAPKIT_KEY?: string; MAPKIT_KEY_ID?: string; MAPKIT_TEAM_ID?: string };
    mutable.MAPKIT_KEY = pem;
    mutable.MAPKIT_KEY_ID = "TESTKEY001";
    mutable.MAPKIT_TEAM_ID = "TESTTEAM01";
    try {
      const app = buildTestApp();
      const { cookie } = await signUpAndSignIn(app);
      const res = await request(app).get("/api/mapkit-token").set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [h, c] = res.body.token.split(".");
      const header = JSON.parse(Buffer.from(h, "base64url").toString());
      const claims = JSON.parse(Buffer.from(c, "base64url").toString());
      expect(header).toMatchObject({ alg: "ES256", kid: "TESTKEY001" });
      expect(claims.iss).toBe("TESTTEAM01");
      expect(claims.exp - claims.iat).toBe(30 * 60);
    } finally {
      delete mutable.MAPKIT_KEY;
      delete mutable.MAPKIT_KEY_ID;
      delete mutable.MAPKIT_TEAM_ID;
    }
  });
});
