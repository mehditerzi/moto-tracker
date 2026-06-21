import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { env } from "@/env";
import { isNative, getBearerToken, setBearerToken, clearBearerToken } from "./nativeAuth";

// Empty VITE_API_URL → same-origin: BetterAuth resolves against window.location.
export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : ""),
  plugins: [magicLinkClient()],
  fetchOptions: {
    // On native, attach the stored bearer token (web uses the cookie, so the
    // token resolves to undefined and no header is added).
    auth: {
      type: "Bearer",
      token: () => (isNative() ? (getBearerToken() ?? undefined) : undefined),
    },
    // Capture the token better-auth's bearer plugin returns on sign-in/sign-up.
    onSuccess(ctx) {
      if (!isNative()) return;
      const token = ctx.response.headers.get("set-auth-token");
      if (token) setBearerToken(token);
    },
  },
});

export const { signIn, signUp, useSession } = authClient;

// Wrap signOut so the native bearer token is also dropped on the client.
export async function signOut(...args: Parameters<typeof authClient.signOut>) {
  try {
    return await authClient.signOut(...args);
  } finally {
    clearBearerToken();
  }
}
