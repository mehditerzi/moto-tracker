import { Capacitor } from "@capacitor/core";

// Bearer-token auth for the native (Capacitor iOS) build only. WKWebView drops
// the cross-site session cookie from capacitor://localhost → the API origin, so
// on native we store the session token returned by better-auth's bearer plugin
// and send it as `Authorization: Bearer …`. The web build keeps the httpOnly
// cookie (more secure: not readable by JS) and never touches this store.

const TOKEN_KEY = "garajim_bearer_token";

export const isNative = (): boolean => Capacitor.isNativePlatform();

export function getBearerToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setBearerToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — ignore */
  }
}

export function clearBearerToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
