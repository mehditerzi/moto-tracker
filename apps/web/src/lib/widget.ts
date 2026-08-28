/**
 * Pushes the "next deadline" to the iOS home-screen widget. Native only — calls
 * a small custom Capacitor plugin (`WidgetBridge`, scaffolded in ios/, see
 * docs/ios-widget.md) that writes to the shared App Group and reloads the widget
 * timeline. No-ops on web/PWA, so it's safe to call unconditionally.
 */
export interface WidgetDeadline {
  label: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  vehicle: string;
  daysRemaining: number;
}

function isNativePlatform(): boolean {
  const cap =
    typeof window !== "undefined"
      ? (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      : undefined;
  return !!cap?.isNativePlatform?.();
}

interface WidgetBridgePlugin {
  setNextDeadline(o: { data: string }): Promise<void>;
}

/**
 * Registered once, not per call.
 *
 * `registerPlugin` used to run inside the `.then()` on every invocation, so
 * each dashboard render that pushed a deadline re-registered the bridge and the
 * native side logged:
 *
 *   [warn] Capacitor plugin "WidgetBridge" already registered.
 *          Cannot register plugins twice.
 *
 * The calls still worked, but the warning is the native runtime telling us we
 * are doing something wrong, and it buried the genuinely useful lines in the
 * device log. `lib/nativeIap.ts` already caches its handle the same way — this
 * was the odd one out.
 */
let widgetPlugin: Promise<WidgetBridgePlugin> | null = null;
function bridge(): Promise<WidgetBridgePlugin> {
  widgetPlugin ??= import("@capacitor/core").then(({ registerPlugin }) =>
    registerPlugin<WidgetBridgePlugin>("WidgetBridge"),
  );
  return widgetPlugin;
}

export function pushNextDeadline(deadline: WidgetDeadline | null): void {
  if (!isNativePlatform()) return;
  void bridge()
    .then((Widget) => Widget.setNextDeadline({ data: JSON.stringify(deadline) }))
    .catch(() => {
      /* plugin not present (pre-widget build) — ignore */
    });
}
