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
