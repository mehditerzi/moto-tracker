import { Capacitor, registerPlugin } from "@capacitor/core";
import { signIn } from "@/lib/authClient";

interface AppleSignInPlugin {
  signIn(): Promise<{
    identityToken: string;
    nonce: string;
    user: string;
    email?: string;
    givenName?: string;
    familyName?: string;
  }>;
}

const plugin = registerPlugin<AppleSignInPlugin>("AppleSignIn");

/** Is Apple's native sheet in this binary? Older builds use the web flow. */
export function nativeAppleAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("AppleSignIn");
}

/**
 * Sign in with Apple through the system sheet, then hand the identity token to
 * the server (better-auth verifies it against Apple's keys and our bundle ID).
 * Resolves false when the user cancelled — not an error.
 */
export async function signInWithAppleNative(): Promise<boolean> {
  let r: Awaited<ReturnType<AppleSignInPlugin["signIn"]>>;
  try {
    r = await plugin.signIn();
  } catch (e) {
    if ((e as Error).message === "apple_cancelled") return false;
    throw e;
  }
  const res = await signIn.social({
    provider: "apple",
    idToken: {
      token: r.identityToken,
      nonce: r.nonce,
      // Apple sends the name only on the first authorisation; keep it.
      ...(r.givenName || r.familyName || r.email
        ? { user: { name: { firstName: r.givenName ?? "", lastName: r.familyName ?? "" }, email: r.email } }
        : {}),
    },
  });
  if (res.error) throw new Error(res.error.message ?? "apple_sign_in_failed");
  return true;
}
