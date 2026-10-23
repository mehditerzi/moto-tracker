export interface Fix {
  lat: number;
  lng: number;
  /** Metres, as the device reports it. */
  accuracy: number;
}

export type FixError = "unsupported" | "denied" | "unavailable" | "timeout";

/**
 * One position, now. Uses the WebView's geolocation, which on iOS goes through
 * the app's own location permission (NSLocationWhenInUseUsageDescription).
 * A cached fix up to 30 s old is fine — in an emergency, a fast answer that is
 * a few metres stale beats a perfect one that takes half a minute.
 */
export function getCurrentFix(timeoutMs = 15_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("unsupported" satisfies FixError));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(
          new Error(
            (e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable") satisfies FixError,
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: timeoutMs },
    );
  });
}
