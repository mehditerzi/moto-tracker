import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import request from "supertest";
import { SignedDataVerifier, Environment } from "@apple/app-store-server-library";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { config } from "../src/config.js";
import {
  iapEnabled,
  iapDiagnostics,
  resetIapVerifiers,
  describeSignedData,
  verifyTransaction,
} from "../src/lib/appstore.js";

/**
 * Regression cover for the production purchase failure: the server could only
 * ever build a SANDBOX verifier unless IAP_APP_APPLE_ID was set, yet the code
 * claimed only "server NOTIFICATIONS will fail". Real customers' transactions
 * failed too, and the failure was near-invisible in the logs.
 */

const ORIGINAL = {
  rootCaDir: config.IAP_APPLE_ROOT_CA_DIR,
  bundleId: config.IAP_BUNDLE_ID,
  apnsBundleId: config.APNS_BUNDLE_ID,
  appAppleId: config.IAP_APP_APPLE_ID,
};

type MutableConfig = {
  -readonly [K in keyof typeof config]: (typeof config)[K];
};
const mutable = config as MutableConfig;

function restoreConfig(): void {
  mutable.IAP_APPLE_ROOT_CA_DIR = ORIGINAL.rootCaDir;
  mutable.IAP_BUNDLE_ID = ORIGINAL.bundleId;
  mutable.APNS_BUNDLE_ID = ORIGINAL.apnsBundleId;
  mutable.IAP_APP_APPLE_ID = ORIGINAL.appAppleId;
  resetIapVerifiers();
}

beforeEach(() => {
  restoreConfig();
  vi.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

/** A JWS-SHAPED string. Unsigned — good only for the diagnostic path. */
function fakeJws(header: object, payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64(header)}.${b64(payload)}.c2ln`;
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iap-ca-"));
  tempDirs.push(dir);
  return dir;
}

let opensslAvailable = true;
/** Real (self-signed) DER certificate, so SignedDataVerifier can be constructed. */
function writeSelfSignedDer(dir: string): void {
  const key = path.join(dir, "key.pem");
  const cer = path.join(dir, "root.cer");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", key, "-out", cer, "-outform", "DER",
    "-days", "1", "-subj", "/CN=Test Root",
  ], { stdio: "ignore" });
  fs.rmSync(key);
}

try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  opensslAvailable = false;
}

afterAll(() => {
  restoreConfig();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ─── the library contract that caused the outage ──────────────────────────────

describe("App Store verifier construction", () => {
  it("REFUSES to build a production verifier without the numeric app id", () => {
    // This is why an unset IAP_APP_APPLE_ID breaks real purchases, not just
    // notifications: no production verifier exists at all.
    expect(
      () => new SignedDataVerifier([], false, Environment.PRODUCTION, "com.mehditerzi.mototracker"),
    ).toThrow(/appAppleId is required/i);
    // Sandbox needs no app id, which is why sandbox testing looked healthy.
    expect(
      () => new SignedDataVerifier([], false, Environment.SANDBOX, "com.mehditerzi.mototracker"),
    ).not.toThrow();
  });
});

describe("appstore verifier wiring", () => {
  it("is disabled with no root CAs, and says so instead of throwing", async () => {
    mutable.IAP_APPLE_ROOT_CA_DIR = tempDir(); // empty
    mutable.APNS_BUNDLE_ID = "com.mehditerzi.mototracker";
    resetIapVerifiers();

    expect(iapEnabled()).toBe(false);
    expect(iapDiagnostics().environments).toEqual([]);
    await expect(verifyTransaction(fakeJws({ alg: "ES256" }, {}))).rejects.toThrow(
      "iap_no_verifier",
    );
  });

  it("skips an unparseable root CA file rather than taking all of IAP down", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "notacert.pem"), "hello, i am not a certificate");
    mutable.IAP_APPLE_ROOT_CA_DIR = dir;
    mutable.APNS_BUNDLE_ID = "com.mehditerzi.mototracker";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    resetIapVerifiers();

    expect(() => iapEnabled()).not.toThrow();
    expect(iapDiagnostics().rootCaCount).toBe(0);
    expect(errors.mock.calls.flat().join(" ")).toMatch(/unparseable root CA/);
  });

  it.skipIf(!opensslAvailable)(
    "builds SANDBOX only without IAP_APP_APPLE_ID, and names that failure",
    async () => {
      const dir = tempDir();
      writeSelfSignedDer(dir);
      mutable.IAP_APPLE_ROOT_CA_DIR = dir;
      mutable.APNS_BUNDLE_ID = "com.mehditerzi.mototracker";
      mutable.IAP_APP_APPLE_ID = undefined;
      resetIapVerifiers();

      expect(iapEnabled()).toBe(true);
      expect(iapDiagnostics().environments).toEqual(["Sandbox"]);

      vi.spyOn(console, "error").mockImplementation(() => {});
      // A production-signed transaction can only fail here — and the error must
      // blame the configuration, not the customer's receipt.
      await expect(
        verifyTransaction(
          fakeJws(
            { alg: "ES256", x5c: ["a", "b", "c"] },
            { bundleId: "com.mehditerzi.mototracker", environment: "Production" },
          ),
        ),
      ).rejects.toThrow("iap_no_production_verifier");
    },
  );

  it.skipIf(!opensslAvailable)("builds BOTH environments once IAP_APP_APPLE_ID is set", () => {
    const dir = tempDir();
    writeSelfSignedDer(dir);
    mutable.IAP_APPLE_ROOT_CA_DIR = dir;
    mutable.APNS_BUNDLE_ID = "com.mehditerzi.mototracker";
    mutable.IAP_APP_APPLE_ID = 6783515081;
    resetIapVerifiers();

    expect(iapDiagnostics().environments).toEqual(["Sandbox", "Production"]);
    expect(iapDiagnostics().appAppleId).toBe(6783515081);
  });

  it.skipIf(!opensslAvailable)("logs the claimed identity of a JWS it cannot verify", async () => {
    const dir = tempDir();
    writeSelfSignedDer(dir);
    mutable.IAP_APPLE_ROOT_CA_DIR = dir;
    mutable.APNS_BUNDLE_ID = "com.mehditerzi.mototracker";
    mutable.IAP_APP_APPLE_ID = 6783515081;
    resetIapVerifiers();

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      verifyTransaction(
        fakeJws(
          { alg: "ES256", x5c: ["a"] },
          {
            bundleId: "com.someone.else",
            environment: "Production",
            productId: "com.mehditerzi.mototracker.garage.3.yearly",
          },
        ),
      ),
    ).rejects.toThrow("iap_verification_failed");

    const logged = errors.mock.calls.flat().join(" ");
    // Without these two facts a production failure needs a device to debug.
    expect(logged).toContain("com.someone.else");
    expect(logged).toContain("Production");
    expect(logged).toContain("Sandbox"); // per-environment attempt detail
  });
});

// ─── the diagnostic itself ────────────────────────────────────────────────────

describe("describeSignedData", () => {
  it("surfaces the claimed bundle id, environment and product", () => {
    const out = JSON.parse(
      describeSignedData(
        fakeJws(
          { alg: "ES256", x5c: ["a", "b", "c"] },
          {
            bundleId: "com.mehditerzi.mototracker",
            environment: "Production",
            productId: "com.mehditerzi.mototracker.garage.10.yearly",
            transactionId: "2000000999",
          },
        ),
      ),
    );
    expect(out).toMatchObject({
      alg: "ES256",
      chainLength: 3,
      claimedBundleId: "com.mehditerzi.mototracker",
      claimedEnvironment: "Production",
      claimedProductId: "com.mehditerzi.mototracker.garage.10.yearly",
      claimedTransactionId: "2000000999",
    });
  });

  it("never throws on garbage (a simulator receipt, a truncated body)", () => {
    for (const junk of ["", "not-a-jws", "a.b", "...", "ey.ey.ey"]) {
      expect(() => describeSignedData(junk)).not.toThrow();
    }
    // A local StoreKit-configuration receipt has no certificate chain at all.
    expect(JSON.parse(describeSignedData(fakeJws({ alg: "ES256" }, {}))).chainLength).toBe(0);
  });
});

// ─── routes ───────────────────────────────────────────────────────────────────

describe("IAP routes", () => {
  it("POST /api/iap/verify requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/iap/verify").send({ transactions: ["ey.ey.ey"] });
    expect(res.status).toBe(401);
  });

  it("POST /api/iap/verify reports 503 rather than failing silently when unconfigured", async () => {
    mutable.IAP_APPLE_ROOT_CA_DIR = tempDir();
    resetIapVerifiers();
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .post("/api/iap/verify")
      .set("Cookie", cookie)
      .send({ transactions: ["ey.ey.ey"] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("iap_unavailable");
  });

  it("GET /api/iap/status requires auth and exposes whether PRODUCTION can verify", async () => {
    mutable.IAP_APPLE_ROOT_CA_DIR = tempDir();
    mutable.APNS_BUNDLE_ID = "com.mehditerzi.mototracker";
    resetIapVerifiers();
    const app = buildTestApp();

    expect((await request(app).get("/api/iap/status")).status).toBe(401);

    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/iap/status").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: false,
      productionReady: false,
      bundleId: "com.mehditerzi.mototracker",
      environments: [],
    });
  });

  it.skipIf(!opensslAvailable)(
    "POST /api/iap/verify blames the SERVER, not the receipt, with no production verifier",
    async () => {
      const dir = tempDir();
      writeSelfSignedDer(dir);
      mutable.IAP_APPLE_ROOT_CA_DIR = dir;
      mutable.APNS_BUNDLE_ID = "com.mehditerzi.mototracker";
      mutable.IAP_APP_APPLE_ID = undefined;
      resetIapVerifiers();
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const app = buildTestApp();
      const { cookie } = await signUpAndSignIn(app);
      const res = await request(app)
        .post("/api/iap/verify")
        .set("Cookie", cookie)
        .send({
          transactions: [
            fakeJws(
              { alg: "ES256", x5c: ["a"] },
              { bundleId: "com.mehditerzi.mototracker", environment: "Production" },
            ),
          ],
        });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("iap_no_production_verifier");
    },
  );

  it.skipIf(!opensslAvailable)(
    "POST /api/iap/verify still reports verification_failed for a genuinely bad receipt",
    async () => {
      const dir = tempDir();
      writeSelfSignedDer(dir);
      mutable.IAP_APPLE_ROOT_CA_DIR = dir;
      mutable.APNS_BUNDLE_ID = "com.mehditerzi.mototracker";
      mutable.IAP_APP_APPLE_ID = 6783515081;
      resetIapVerifiers();
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const app = buildTestApp();
      const { cookie } = await signUpAndSignIn(app);
      const res = await request(app)
        .post("/api/iap/verify")
        .set("Cookie", cookie)
        .send({ transactions: [fakeJws({ alg: "ES256" }, { bundleId: "com.x" })] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("verification_failed");
    },
  );
});
