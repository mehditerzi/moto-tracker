import { registerPlugin } from "@capacitor/core";
import type { Sample } from "./tripTracking";

// We talk to @capacitor-community/background-geolocation through registerPlugin
// rather than importing the package's JS — the package is only needed as a
// native dependency (its iOS pod is added by `cap sync`). This file is loaded
// lazily (dynamic import) and only on a real device, so it never reaches the
// web bundle or the unit tests.

interface BgLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  /** epoch ms */
  time: number | null;
}

interface AddWatcherOptions {
  backgroundMessage?: string;
  backgroundTitle?: string;
  requestPermissions?: boolean;
  stale?: boolean;
  distanceFilter?: number;
}

interface BackgroundGeolocationPlugin {
  addWatcher(
    options: AddWatcherOptions,
    callback: (position?: BgLocation, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}

const BackgroundGeolocation =
  registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

export interface NativeWatchOptions {
  backgroundTitle: string;
  backgroundMessage: string;
}

export interface NativeWatchHandle {
  stop: () => void;
}

/**
 * Start the native background watcher. Each fix maps to the generic Sample the
 * TripDetector consumes. `backgroundMessage` is what enables true background
 * delivery on iOS — without it the OS suspends location updates.
 */
export async function startNativeWatch(
  onSample: (s: Sample) => void,
  onError: (e: unknown) => void,
  opts: NativeWatchOptions,
): Promise<NativeWatchHandle> {
  const id = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: opts.backgroundTitle,
      backgroundMessage: opts.backgroundMessage,
      requestPermissions: true,
      stale: false,
      // Emit a fix roughly every 25 m of movement — enough resolution for trip
      // distance without hammering the battery.
      distanceFilter: 25,
    },
    (position, error) => {
      if (error) {
        onError(error);
        return;
      }
      if (!position) return;
      onSample({
        lat: position.latitude,
        lng: position.longitude,
        t: position.time ?? Date.now(),
        speed: position.speed,
        accuracy: position.accuracy,
      });
    },
  );
  return { stop: () => void BackgroundGeolocation.removeWatcher({ id }) };
}
