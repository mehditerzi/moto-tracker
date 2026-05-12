import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { env } from "@/env";

// Empty VITE_API_URL → same-origin: BetterAuth resolves against window.location.
export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : ""),
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
