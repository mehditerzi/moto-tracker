import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wrapper for the iOS App Store build.
 *
 * The web assets are bundled into the app (webDir = Vite's `dist`) and served
 * from the `capacitor://localhost` origin inside WKWebView. API calls go to the
 * absolute production URL baked in at build time via VITE_API_URL — see the
 * `cap:build` script. Because that makes requests cross-origin, the API must:
 *   1. allow the `capacitor://localhost` origin in CORS with credentials
 *      (set WEB_ORIGIN=capacitor://localhost on the API), and
 *   2. issue its session cookie as SameSite=None; Secure (or move auth to a
 *      bearer token) so WKWebView sends it cross-site.
 */
const config: CapacitorConfig = {
  appId: "com.mehditerzi.mototracker",
  appName: "Garajım",
  webDir: "dist",
  ios: {
    contentInset: "always",
  },
};

export default config;
