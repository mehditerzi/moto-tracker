import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Bell, BellOff, LogOut, Globe, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { setLanguage } from "@/lib/i18n";
import { signOut } from "@/lib/authClient";
import { useNotifPrefs, useUpdateNotifPref } from "@/hooks/useNotifPreferences";
import { useDisablePush, useEnablePush, usePushStatus, useSendTestPush } from "@/hooks/usePush";
import { pushToast } from "@/hooks/useToast";
import { cn } from "@/lib/cn";
import type { NotifPreference } from "@mototracker/shared";
import { useConfirm } from "@/components/ConfirmSheet";
import { isNative } from "@/lib/nativeAuth";
import {
  getPushDiag,
  registerNativePush,
  PUSH_DIAG_EVENT,
  type PushDiag,
} from "@/lib/nativePush";

const LEAD_OPTIONS = [60, 30, 14, 7, 3, 1, 0];

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const prefs = useNotifPrefs();
  const push = usePushStatus();
  const enablePush = useEnablePush();
  const disablePush = useDisablePush();
  const test = useSendTestPush();

  // Native (Capacitor iOS) uses APNs, registered automatically on sign-in — it
  // does NOT use the Web Push subscription flow (unsupported in WKWebView), so
  // the notifications section gets a dedicated native branch below.
  const native = isNative();

  // Surface APNs registration status on-device (it is otherwise swallowed).
  const [pushDiag, setPushDiag] = useState<PushDiag>(() => getPushDiag());
  useEffect(() => {
    if (!native) return;
    const onDiag = (e: Event) =>
      setPushDiag((e as CustomEvent<PushDiag>).detail ?? getPushDiag());
    window.addEventListener(PUSH_DIAG_EVENT, onDiag);
    setPushDiag(getPushDiag());
    return () => window.removeEventListener(PUSH_DIAG_EVENT, onDiag);
  }, [native]);

  const sendTest = () =>
    test
      .mutateAsync()
      .then((r) => {
        if (r.sent > 0) {
          pushToast({
            variant: "success",
            title: t("settings.testSent", { sent: r.sent, total: r.total }),
          });
        } else {
          const desc =
            r.error === "vapid_not_configured" || r.error === "VAPID keys not configured"
              ? t("settings.vapidNotConfigured")
              : (r.error ?? t("settings.testFailed"));
          pushToast({ variant: "danger", title: t("common.error"), description: desc });
        }
      })
      .catch((e) =>
        pushToast({ variant: "danger", title: t("common.error"), description: String(e) }),
      );

  const onLang = (lng: "tr" | "en") => setLanguage(lng);

  const onTogglePush = async () => {
    if (push.data?.subscribed) {
      await disablePush.mutateAsync();
      pushToast({ variant: "success", title: t("settings.disableOnDevice") });
    } else {
      try {
        await enablePush.mutateAsync();
        pushToast({ variant: "success", title: t("settings.enableOnDevice") });
      } catch (e) {
        pushToast({
          variant: "danger",
          title: t("common.error"),
          description:
            (e as Error).message === "push/permission-denied"
              ? t("settings.permissionDenied")
              : (e as Error).message === "VAPID public key not configured on server"
              ? t("settings.vapidNotConfigured")
              : (e as Error).message,
        });
      }
    }
  };

  const onSignOut = async () => {
    if (!(await confirm({ title: t("settings.signOutConfirm"), confirmLabel: t("settings.signOut"), destructive: true }))) return;
    await signOut();
    navigate("/sign-in");
  };

  const isIos =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/.test(navigator.userAgent) &&
    !(
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // @ts-expect-error: iOS-only Safari property
      window.navigator?.standalone === true
    );

  const [iosHintDismissed, setIosHintDismissed] = useState(
    () => localStorage.getItem("moto.iosHintDismissed") === "1",
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col gap-3"
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label-micro text-muted dark:text-muted-dark">
            {t("nav.settings")}
          </div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">
            {t("settings.title")}
          </h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSignOut}
          className="text-muted hover:text-danger dark:text-muted-dark"
        >
          <LogOut className="h-4 w-4" /> {t("settings.signOut")}
        </Button>
      </header>

      <Card>
        <SectionHeader icon={<Globe className="h-3.5 w-3.5" />} label={t("settings.language")} />
        <CardContent>
          <div className="flex gap-2">
            <LangButton active={i18n.language.startsWith("tr")} onClick={() => onLang("tr")}>
              {t("settings.tr")}
            </LangButton>
            <LangButton active={i18n.language.startsWith("en")} onClick={() => onLang("en")}>
              {t("settings.en")}
            </LangButton>
          </div>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={<Bell className="h-3.5 w-3.5" />}
          label={t("settings.notifications")}
        />
        <CardContent className="gap-3">
          {native ? (
            <>
              <p className="text-sm text-muted dark:text-muted-dark">
                {pushDiag.state === "registered"
                  ? t("settings.nativePushInfo")
                  : t("settings.nativePushSetup")}
              </p>
              {pushDiag.state !== "registered" && pushDiag.state !== "idle" && (
                <p
                  className={cn(
                    "text-xs",
                    pushDiag.state === "registering"
                      ? "text-muted dark:text-muted-dark"
                      : "text-danger",
                  )}
                >
                  {pushDiag.state === "registering"
                    ? t("settings.nativePushRegistering")
                    : pushDiag.state === "permission-denied"
                    ? t("settings.permissionDenied")
                    : pushDiag.state === "register-timeout"
                    ? t("settings.nativePushTimeout")
                    : `${t("settings.nativePushError")}${pushDiag.message ? `: ${pushDiag.message}` : ""}`}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={pushDiag.state === "registered" ? "ghost" : "accent"}
                  size="sm"
                  onClick={() => void registerNativePush()}
                  className="self-start"
                >
                  <Bell className="h-4 w-4" /> {t("settings.nativePushRegister")}
                </Button>
                {pushDiag.state === "registered" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={test.isPending}
                    onClick={sendTest}
                    className="self-start"
                  >
                    {t("settings.sendTest")} <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                )}
              </div>
            </>
          ) : push.isLoading ? (
            <p className="text-sm text-muted dark:text-muted-dark">{t("common.loading")}</p>
          ) : !push.data?.supported ? (
            <p className="text-sm text-muted dark:text-muted-dark">{t("settings.unsupported")}</p>
          ) : push.data.permission === "denied" ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm text-danger">{t("settings.permissionDenied")}</p>
              <p className="text-xs text-muted dark:text-muted-dark">{t("settings.permissionDeniedHint")}</p>
            </div>
          ) : (
            <>
              <Button
                variant={push.data.subscribed ? "outline" : "accent"}
                onClick={onTogglePush}
                disabled={enablePush.isPending || disablePush.isPending}
              >
                {push.data.subscribed ? (
                  <>
                    <BellOff className="h-4 w-4" /> {t("settings.disableOnDevice")}
                  </>
                ) : (
                  <>
                    <Bell className="h-4 w-4" /> {t("settings.enableOnDevice")}
                  </>
                )}
              </Button>
              {push.data.subscribed && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={test.isPending}
                  onClick={sendTest}
                  className="self-start"
                >
                  {t("settings.sendTest")} <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                </Button>
              )}
            </>
          )}
          {!native && isIos && !push.data?.subscribed && !iosHintDismissed && push.data?.permission !== "denied" && (
            <div className="flex items-start gap-2">
              <p className="text-xs text-muted dark:text-muted-dark">{t("settings.iosHint")}</p>
              <button
                onClick={() => {
                  localStorage.setItem("moto.iosHintDismissed", "1");
                  setIosHintDismissed(true);
                }}
                className="shrink-0 text-xs text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
                aria-label={t("common.dismiss")}
              >
                ✕
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <SectionHeader label={t("settings.leadDays")} />
        <CardContent className="gap-2">
          {prefs.data?.map((p) => <PrefRow key={p.itemType} pref={p} />)}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function SectionHeader({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-[15px] font-semibold">
        {icon && (
          <span className="text-muted dark:text-muted-dark" aria-hidden>
            {icon}
          </span>
        )}
        {label}
      </CardTitle>
    </CardHeader>
  );
}

function PrefRow({ pref }: { pref: NotifPreference }) {
  const { t } = useTranslation();
  const update = useUpdateNotifPref(pref.itemType);

  const toggleLead = async (n: number) => {
    const set = new Set(pref.leadDays);
    if (set.has(n)) set.delete(n);
    else set.add(n);
    try {
      await update.mutateAsync({
        enabled: pref.enabled,
        leadDays: [...set].sort((a, b) => b - a),
      });
    } catch {
      pushToast({ variant: "danger", title: t("settings.updateFailed") });
    }
  };
  const toggleEnabled = async () => {
    try {
      await update.mutateAsync({ enabled: !pref.enabled, leadDays: pref.leadDays });
    } catch {
      pushToast({ variant: "danger", title: t("settings.updateFailed") });
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition",
        pref.enabled
          ? "border-border dark:border-border-dark"
          : "border-border bg-surface/40 opacity-60 dark:border-border-dark dark:bg-surface-elev-dark/40",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[14px] font-medium">{t(`items.${pref.itemType}`)}</span>
        <button
          onClick={toggleEnabled}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition min-h-[44px] min-w-[44px]",
            pref.enabled
              ? "bg-success/15 text-success"
              : "bg-surface text-muted dark:bg-bg-dark dark:text-muted-dark",
          )}
        >
          {pref.enabled ? t("settings.on") : t("settings.off")}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {LEAD_OPTIONS.map((n) => {
          const on = pref.leadDays.includes(n);
          const label = n === 0 ? t("settings.onTheDay") : t("settings.daysBeforeShort", { count: n });
          return (
            <button
              key={n}
              onClick={() => toggleLead(n)}
              disabled={!pref.enabled}
              aria-label={n !== 0 ? t("settings.daysBefore", { n }) : undefined}
              className={cn(
                "num rounded-full border px-2.5 py-1 text-[11px] font-medium transition min-h-[44px]",
                on
                  ? "border-accent bg-accent/15 text-text dark:text-text-dark"
                  : "border-border text-muted hover:border-text/30 dark:border-border-dark dark:text-muted-dark dark:hover:border-text-dark/30",
                !pref.enabled && "cursor-not-allowed opacity-50 hover:border-border",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LangButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition min-h-[44px]",
        active
          ? "border-accent bg-accent/15 text-text dark:text-text-dark"
          : "border-border text-muted hover:border-text/30 dark:border-border-dark dark:text-muted-dark dark:hover:border-text-dark/30",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
