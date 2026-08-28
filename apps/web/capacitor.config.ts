import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wrapper for the iOS App Store build.
 *
 * Auto-update model: `server.url` points WKWebView at the live web app, so every
 * web deploy reaches the installed app on next launch — no App Store round-trip
 * (after the one submission that ships this config). Because the live app is
 * served same-origin with the API (VITE_API_URL="" in the Docker build), API
 * calls are same-origin and the session cookie just works; the bearer-token path
 * (lib/nativeAuth) remains as a belt-and-suspenders fallback.
 *
 * Trade-off (accepted): the app needs network at launch — there is no offline
 * mode. `webDir`/the bundled `dist` is only a fallback if the remote can't load.
 * To restore offline support later, drop `server.url` and adopt an OTA plugin
 * (e.g. @capgo/capacitor-updater) instead.
 */
const config: CapacitorConfig = {
  appId: "com.mehditerzi.mototracker",
  appName: "Garajım",
  webDir: "dist",
  server: {
    url: "https://mototracker.mehditerzi.com",
    cleartext: false,
    /**
     * Keep the Sign in with Apple hand-off INSIDE the WebView.
     *
     * Without this, Capacitor treats appleid.apple.com as an off-host
     * top-level navigation and hands it to Safari via UIApplication.open.
     * Apple then authenticates in Safari and the callback sets the session
     * cookie in SAFARI's cookie jar — which the WKWebView cannot read. The
     * user lands back in the app still signed out, which is exactly the
     * "it opens Safari and says it couldn't log in" symptom.
     *
     * Because server.url already points at the production origin, the WebView
     * is on the same origin as the auth callback, so once the flow stays
     * inside it the cookie is set on the right origin and sign-in completes.
     *
     * Only the Apple ID hosts are listed — this allowlist decides what may
     * navigate inside the app, so it stays as narrow as possible.
     */
    allowNavigation: ["appleid.apple.com", "account.apple.com"],
  },
  ios: {
    // The web app handles safe areas itself via CSS env() insets (pt-safe /
    // pl-safe / pr-safe / pb-safe). "always" makes WKWebView ALSO inset content
    // below the status bar, doubling the top gap — so use "never" and let CSS
    // own the insets.
    contentInset: "never",
  },
};

export default config;
