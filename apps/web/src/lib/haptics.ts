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

/** A light tap — for presses that commit something small (a chip, a toggle). */
export function hapticTap(): void {
  if (!isNativePlatform()) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}))
    .catch(() => {});
}

/** The detent click of a picker — for moving a selection, not committing it. */
export function hapticSelection(): void {
  if (!isNativePlatform()) return;
  void import("@capacitor/haptics")
    // iOS only fires selectionChanged on a generator that selectionStart
    // created, so a lone selectionChanged is silently a no-op.
    .then(async ({ Haptics }) => {
      await Haptics.selectionStart();
      await Haptics.selectionChanged();
      await Haptics.selectionEnd();
    })
    .catch(() => {});
}

/** A firm thump — for the one action that must feel deliberate (SOS). */
export function hapticHeavy(): void {
  if (!isNativePlatform()) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {}))
    .catch(() => {});
}
