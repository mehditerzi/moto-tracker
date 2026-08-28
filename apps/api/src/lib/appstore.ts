import fs from "node:fs";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import {
  SignedDataVerifier,
  Environment,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { config } from "../config.js";

/**
 * App Store transaction / notification verification. We verify the JWS signature
 * chain against Apple's root CAs ourselves — no third-party billing service.
 *
 * A verifier is bound to a single environment (Sandbox or Production) and rejects
 * payloads from the other, so we keep one per environment and try them in turn:
 * a TestFlight/sandbox purchase decodes with the Sandbox verifier, a real one
 * with Production. Verification is offline by default (cert-chain only); enable
 * OCSP via IAP_ENABLE_ONLINE_CHECKS if the box can reach Apple.
 *
 * `IAP_APP_APPLE_ID` is REQUIRED for anything production: the library refuses to
 * construct a PRODUCTION verifier without it, so an unset value means real
 * customers' purchases AND Apple's notifications both fail signature checks,
 * every time. `assertIapConfig()` shouts about that at boot rather than letting
 * it surface as mystery 400s months later.
 */

function resolveBundleId(): string | null {
  return config.IAP_BUNDLE_ID ?? config.APNS_BUNDLE_ID ?? null;
}

/**
 * Read Apple's root CAs. Each file is parsed here rather than inside
 * `SignedDataVerifier`, because the library's constructor parses them eagerly —
 * one corrupt or misnamed file would otherwise throw and take ALL of IAP down
 * with a stack trace that says nothing about certificates.
 */
function loadRootCAs(dir: string): Buffer[] {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return [];
  const out: Buffer[] = [];
  for (const file of fs.readdirSync(abs).filter((f) => /\.(cer|der|pem)$/i.test(f))) {
    const full = path.join(abs, file);
    try {
      const buf = fs.readFileSync(full);
      new X509Certificate(buf); // throws on anything that isn't a certificate
      out.push(buf);
    } catch (e) {
      console.error(`[iap] ignoring unparseable root CA ${full}: ${(e as Error).message}`);
    }
  }
  return out;
}

interface NamedVerifier {
  env: "Sandbox" | "Production";
  verifier: SignedDataVerifier;
}

interface BuiltVerifiers {
  verifiers: NamedVerifier[];
  enabled: boolean;
  /** Everything a human needs to see why verification is/isn't working. */
  diagnostics: {
    bundleId: string | null;
    rootCaCount: number;
    rootCaDir: string;
    appAppleId: number | null;
    onlineChecks: boolean;
    environments: string[];
  };
}

let _built: BuiltVerifiers | null = null;

function build(): BuiltVerifiers {
  if (_built) return _built;

  const bundleId = resolveBundleId();
  const roots = loadRootCAs(config.IAP_APPLE_ROOT_CA_DIR);
  const verifiers: NamedVerifier[] = [];

  if (bundleId && roots.length > 0) {
    const online = config.IAP_ENABLE_ONLINE_CHECKS;
    // Sandbox always (appAppleId not required there).
    verifiers.push({
      env: "Sandbox",
      verifier: new SignedDataVerifier(roots, online, Environment.SANDBOX, bundleId),
    });
    // Production REQUIRES the numeric app id. Without it there is simply no
    // production verifier, so every real purchase fails to verify.
    if (config.IAP_APP_APPLE_ID) {
      verifiers.push({
        env: "Production",
        verifier: new SignedDataVerifier(
          roots,
          online,
          Environment.PRODUCTION,
          bundleId,
          config.IAP_APP_APPLE_ID,
        ),
      });
    }
  }

  _built = {
    verifiers,
    enabled: verifiers.length > 0,
    diagnostics: {
      bundleId,
      rootCaCount: roots.length,
      rootCaDir: path.resolve(config.IAP_APPLE_ROOT_CA_DIR),
      appAppleId: config.IAP_APP_APPLE_ID ?? null,
      onlineChecks: config.IAP_ENABLE_ONLINE_CHECKS,
      environments: verifiers.map((v) => v.env),
    },
  };
  return _built;
}

/** Test seam: forget the memoized verifiers so config changes take effect. */
export function resetIapVerifiers(): void {
  _built = null;
}

export function iapEnabled(): boolean {
  return build().enabled;
}

/** Which environments a JWS can currently be verified against. */
export function iapDiagnostics(): BuiltVerifiers["diagnostics"] {
  return build().diagnostics;
}

/**
 * Loud, boot-time truth about the IAP configuration. Called from the server
 * bootstrap; safe to call repeatedly.
 */
export function assertIapConfig(): void {
  const { enabled, diagnostics } = build();
  if (!enabled) {
    console.error(
      "[iap] DISABLED — /api/iap/* will return 503 and NO purchase can be granted. " +
        `Need Apple root CAs in ${diagnostics.rootCaDir} (found ${diagnostics.rootCaCount}) ` +
        `and a bundle id via IAP_BUNDLE_ID or APNS_BUNDLE_ID (resolved: ${diagnostics.bundleId ?? "none"}).`,
    );
    return;
  }
  if (!diagnostics.appAppleId) {
    console.error(
      "[iap] IAP_APP_APPLE_ID is UNSET — no PRODUCTION verifier was built. " +
        "Every purchase by a real (non-sandbox) customer will fail verification with " +
        "'iap_no_production_verifier', and so will Apple's production server notifications. " +
        "Set it to the numeric Apple ID from App Store Connect → App Information.",
    );
    return;
  }
  console.info(
    `[iap] ready — bundleId=${diagnostics.bundleId} appAppleId=${diagnostics.appAppleId} ` +
      `roots=${diagnostics.rootCaCount} online=${diagnostics.onlineChecks} ` +
      `environments=[${diagnostics.environments.join(", ")}]`,
  );
}

/**
 * Trim a JWS to something safe and useful for a log line. Everything it reports
 * is CLAIMED, not verified — that is precisely what makes it diagnostic: an
 * environment or bundle id that does not match ours is the failure.
 * Exported for tests.
 */
export function describeSignedData(signedData: string): string {
  const [header, payload] = signedData.split(".");
  const decode = (part: string | undefined): unknown => {
    if (!part) return null;
    try {
      return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  };
  const head = decode(header) as { alg?: string; x5c?: string[] } | null;
  const body = decode(payload) as
    | { bundleId?: string; environment?: string; productId?: string; transactionId?: string }
    | null;
  return JSON.stringify({
    alg: head?.alg ?? null,
    chainLength: head?.x5c?.length ?? 0,
    // Claimed (UNVERIFIED) values straight off the payload — they are exactly
    // what a mismatch looks like, which is the whole point of logging them.
    claimedBundleId: body?.bundleId ?? null,
    claimedEnvironment: body?.environment ?? null,
    claimedProductId: body?.productId ?? null,
    claimedTransactionId: body?.transactionId ?? null,
    length: signedData.length,
  });
}

class IapVerificationError extends Error {
  constructor(
    message: string,
    readonly attempts: { env: string; error: string }[],
    readonly fingerprint: string,
  ) {
    super(message);
    this.name = "IapVerificationError";
  }
}

/**
 * Try each environment's verifier; return the first that validates, else throw.
 *
 * On failure this logs the per-environment error AND the claimed (unverified)
 * header/payload of the JWS. A production failure is then diagnosable straight
 * from the container logs — "claimedEnvironment: Production" with only
 * `[Sandbox]` attempted is the IAP_APP_APPLE_ID problem; a `claimedBundleId`
 * that differs from ours is a wrong-app problem; an empty chain is a simulator
 * StoreKit-configuration receipt.
 */
async function verifyWith<T>(
  signedData: string,
  kind: "transaction" | "notification",
  run: (v: SignedDataVerifier) => Promise<T>,
): Promise<T> {
  const { verifiers, diagnostics } = build();
  const attempts: { env: string; error: string }[] = [];

  if (verifiers.length === 0) {
    console.error(`[iap] ${kind}: no verifier configured`, describeSignedData(signedData));
    throw new IapVerificationError("iap_no_verifier", attempts, describeSignedData(signedData));
  }

  for (const { env, verifier } of verifiers) {
    try {
      return await run(verifier);
    } catch (e) {
      attempts.push({ env, error: (e as Error).message || String(e) });
    }
  }

  const fingerprint = describeSignedData(signedData);
  const noProduction = !diagnostics.appAppleId;
  console.error(
    `[iap] ${kind} verification FAILED` +
      (noProduction ? " (no PRODUCTION verifier — IAP_APP_APPLE_ID is unset)" : "") +
      ` attempted=${JSON.stringify(attempts)} jws=${fingerprint}`,
  );
  throw new IapVerificationError(
    noProduction ? "iap_no_production_verifier" : "iap_verification_failed",
    attempts,
    fingerprint,
  );
}

export async function verifyTransaction(
  signedTransaction: string,
): Promise<JWSTransactionDecodedPayload> {
  return verifyWith(signedTransaction, "transaction", (v) =>
    v.verifyAndDecodeTransaction(signedTransaction),
  );
}

export async function verifyNotification(
  signedPayload: string,
): Promise<ResponseBodyV2DecodedPayload> {
  return verifyWith(signedPayload, "notification", (v) =>
    v.verifyAndDecodeNotification(signedPayload),
  );
}
