/**
 * Subtle haptic feedback. Native (Capacitor) only — the iOS WKWebView doesn't
 * support the web Vibration API, so this no-ops on web/PWA. The plugin is loaded
 * lazily and only on a real device, so it never reaches the web bundle at
 * runtime. Activates on the next `cap:build` (the pod is added by cap sync).
 */
function isNativePlatform(): boolean {
  const cap =
    typeof window !== "undefined"
      ? (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      : undefined;
  return !!cap?.isNativePlatform?.();
}

export function hapticSuccess(): void {
  if (!isNativePlatform()) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, NotificationType }) =>
      Haptics.notification({ type: NotificationType.Success }).catch(() => {}),
    )
    .catch(() => {});
}

export function hapticWarning(): void {
  if (!isNativePlatform()) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, NotificationType }) =>
      Haptics.notification({ type: NotificationType.Warning }).catch(() => {}),
    )
    .catch(() => {});
}
