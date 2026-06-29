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

export function pushNextDeadline(deadline: WidgetDeadline | null): void {
  if (!isNativePlatform()) return;
  void import("@capacitor/core")
    .then(({ registerPlugin }) => {
      const Widget = registerPlugin<{ setNextDeadline(o: { data: string }): Promise<void> }>(
        "WidgetBridge",
      );
      return Widget.setNextDeadline({ data: JSON.stringify(deadline) });
    })
    .catch(() => {
      /* plugin not present (pre-widget build) — ignore */
    });
}
