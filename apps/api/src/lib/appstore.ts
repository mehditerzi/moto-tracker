import fs from "node:fs";
import path from "node:path";
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
 */

function resolveBundleId(): string | null {
  return config.IAP_BUNDLE_ID ?? config.APNS_BUNDLE_ID ?? null;
}

function loadRootCAs(dir: string): Buffer[] {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => /\.(cer|der|pem)$/i.test(f))
    .map((f) => fs.readFileSync(path.join(abs, f)));
}

let _verifiers: SignedDataVerifier[] | null = null;
let _enabled: boolean | null = null;

function build(): { verifiers: SignedDataVerifier[]; enabled: boolean } {
  if (_verifiers && _enabled !== null) return { verifiers: _verifiers, enabled: _enabled };

  const bundleId = resolveBundleId();
  const roots = loadRootCAs(config.IAP_APPLE_ROOT_CA_DIR);
  const verifiers: SignedDataVerifier[] = [];

  if (bundleId && roots.length > 0) {
    const online = config.IAP_ENABLE_ONLINE_CHECKS;
    // Sandbox always (appAppleId not required there).
    verifiers.push(new SignedDataVerifier(roots, online, Environment.SANDBOX, bundleId));
    // Production needs the numeric app id to verify server notifications.
    if (config.IAP_APP_APPLE_ID) {
      verifiers.push(
        new SignedDataVerifier(roots, online, Environment.PRODUCTION, bundleId, config.IAP_APP_APPLE_ID),
      );
    }
  }

  _verifiers = verifiers;
  _enabled = verifiers.length > 0;
  if (!_enabled) {
    console.warn(
      "[iap] disabled — need Apple root CAs in IAP_APPLE_ROOT_CA_DIR and a bundle id " +
        "(IAP_BUNDLE_ID or APNS_BUNDLE_ID). /api/iap/* will return 503.",
    );
  } else if (!config.IAP_APP_APPLE_ID) {
    console.warn(
      "[iap] IAP_APP_APPLE_ID unset — sandbox only. Production server notifications " +
        "will fail to verify until it is set.",
    );
  }
  return { verifiers: _verifiers, enabled: _enabled };
}

export function iapEnabled(): boolean {
  return build().enabled;
}

/** Try each environment's verifier; return the first that validates, else throw. */
export async function verifyTransaction(
  signedTransaction: string,
): Promise<JWSTransactionDecodedPayload> {
  const { verifiers } = build();
  let lastErr: unknown;
  for (const v of verifiers) {
    try {
      return await v.verifyAndDecodeTransaction(signedTransaction);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("iap_no_verifier");
}

export async function verifyNotification(
  signedPayload: string,
): Promise<ResponseBodyV2DecodedPayload> {
  const { verifiers } = build();
  let lastErr: unknown;
  for (const v of verifiers) {
    try {
      return await v.verifyAndDecodeNotification(signedPayload);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("iap_no_verifier");
}
