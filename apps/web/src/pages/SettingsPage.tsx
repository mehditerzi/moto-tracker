import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Bell, BellOff, LogOut, Globe, ChevronRight, Trash2, Crown, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setLanguage } from "@/lib/i18n";
import { signOut } from "@/lib/authClient";
import { api, ApiError } from "@/lib/api";
import { clearBearerToken } from "@/lib/nativeAuth";
import { queryClient } from "@/lib/queryClient";
import {
  useNotifCategories,
  useNotifPrefs,
  useUpdateNotifCategory,
  useUpdateNotifPref,
} from "@/hooks/useNotifPreferences";
import { useDisablePush, useEnablePush, usePushStatus, useSendTestPush } from "@/hooks/usePush";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
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
import { useEntitlement } from "@/hooks/useEntitlement";
import { useMe } from "@/hooks/useMe";
import { PaywallSheet } from "@/components/PaywallSheet";

/**
 * Subscription section: always visible so the upgrade/manage path isn't only
 * discoverable by hitting the vehicle cap.
 */
function SubscriptionCard() {
  const { t } = useTranslation();
  const ent = useEntitlement();
  const [paywall, setPaywall] = useState(false);
  const d = ent.data;
  return (
    <Card>
      <SectionHeader icon={<Crown className="h-3.5 w-3.5" />} label={t("settings.subscription")} />
      <CardContent className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold">
              {d && d.tier !== "free"
                ? t("paywall.tierVehicles", { count: d.maxVehicles })
                : t("settings.freePlan")}
            </div>
            <div className="text-[13px] text-muted dark:text-muted-dark">
              {d
                ? t("settings.vehiclesUsed", { used: d.activeVehicles, max: d.maxVehicles })
                : "…"}
            </div>
          </div>
          <Button size="sm" variant="accent" onClick={() => setPaywall(true)}>
            {d && d.tier !== "free" ? t("settings.changePack") : t("paywall.choosePack")}
          </Button>
        </div>
      </CardContent>
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} />
    </Card>
  );
}

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
        pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) }),
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
              : friendlyError(e, t),
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

      <SubscriptionCard />

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

      <SharingNotificationsCard />

      <DeleteAccountCard />
    </motion.div>
  );
}

/**
 * Sharing activity — a category, not a schedule, so it gets a plain switch and
 * no lead-day row.
 *
 * The second paragraph is the important one and it is not boilerplate: this
 * toggle does NOT cover requests filed against a vehicle you hold. Those are
 * always delivered, because they start a three-week window after which the
 * person who asked may open their own record of the vehicle, and a settings
 * screen that quietly disabled that would be a way to lose your car's record by
 * having tidied your notifications. Saying so here — where the switch is —
 * is the difference between a documented exception and a broken promise.
 */
function SharingNotificationsCard() {
  const { t } = useTranslation();
  const categories = useNotifCategories();
  const update = useUpdateNotifCategory("sharing");
  const sharing = categories.data?.find((c) => c.category === "sharing");

  if (!sharing) return null;

  const toggle = async () => {
    try {
      await update.mutateAsync({ enabled: !sharing.enabled });
    } catch {
      pushToast({ variant: "danger", title: t("settings.updateFailed") });
    }
  };

  return (
    <Card>
      <SectionHeader
        icon={<Users className="h-3.5 w-3.5" />}
        label={t("settings.sharingNotifications")}
      />
      <CardContent className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted dark:text-muted-dark">
            {t("settings.sharingNotificationsDesc")}
          </p>
          <button
            onClick={toggle}
            disabled={update.isPending}
            aria-pressed={sharing.enabled}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition min-h-[44px] min-w-[44px]",
              sharing.enabled
                ? "bg-success/15 text-success"
                : "bg-surface text-muted dark:bg-bg-dark dark:text-muted-dark",
            )}
          >
            {sharing.enabled ? t("settings.on") : t("settings.off")}
          </button>
        </div>
        <p className="text-xs text-muted dark:text-muted-dark">
          {t("settings.sharingNotificationsAlways")}
        </p>
      </CardContent>
    </Card>
  );
}

/** Must match DELETE_CONFIRM_PHRASE in apps/api/src/routes/me.ts. */
const DELETE_CONFIRM_PHRASE = "DELETE";

function DeleteAccountCard() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const me = useMe();
  const [gateOpen, setGateOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Magic-link / Google / Apple accounts have no password to re-enter, so they
  // confirm by typing the phrase instead. `hasPassword` comes from GET /api/me;
  // default to the password gate while it loads (the safer of the two).
  const hasPassword = me.data?.user.hasPassword !== false;

  const start = async () => {
    const ok = await confirm({
      title: t("settings.deleteAccountConfirmTitle"),
      message: t("settings.deleteAccountConfirmMessage"),
      confirmLabel: t("settings.deleteAccountContinue"),
      destructive: true,
    });
    if (!ok) return;
    setValue("");
    setError(null);
    setGateOpen(true);
  };

  // The phrase must match exactly — the server rejects anything else.
  const ready = hasPassword ? value.length > 0 : value === DELETE_CONFIRM_PHRASE;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/me", {
        method: "DELETE",
        json: hasPassword ? { password: value } : { confirm: DELETE_CONFIRM_PHRASE },
      });
      // Server already destroyed the session via cascade; just clear the client.
      clearBearerToken();
      queryClient.clear();
      pushToast({ variant: "success", title: t("settings.deleteAccountSuccess") });
      navigate("/welcome", { replace: true });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401 && hasPassword) {
        setError(t("settings.deleteAccountWrongPassword"));
      } else if (status === 400 || status === 401) {
        setError(
          hasPassword
            ? t("settings.deleteAccountWrongPassword")
            : t("settings.deleteAccountWrongConfirmation", { phrase: DELETE_CONFIRM_PHRASE }),
        );
      } else {
        pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) });
      }
      setBusy(false);
    }
  };

  return (
    <Card className="border-danger/30">
      <SectionHeader icon={<Trash2 className="h-3.5 w-3.5" />} label={t("settings.deleteAccount")} />
      <CardContent className="gap-3">
        <p className="text-sm text-muted dark:text-muted-dark">
          {t("settings.deleteAccountSectionDesc")}
        </p>
        <Button
          variant="ghost"
          onClick={start}
          className="self-start text-danger hover:bg-danger/10"
        >
          <Trash2 className="h-4 w-4" /> {t("settings.deleteAccount")}
        </Button>

        {gateOpen && (
          <div className="mt-1 flex flex-col gap-2 rounded-xl border border-danger/30 p-3">
            <label htmlFor="delete-confirm" className="text-[13px] font-medium">
              {hasPassword
                ? t("settings.deleteAccountPasswordMessage")
                : t("settings.deleteAccountConfirmPhraseMessage", {
                    phrase: DELETE_CONFIRM_PHRASE,
                  })}
            </label>
            <Input
              id="delete-confirm"
              type={hasPassword ? "password" : "text"}
              autoComplete={hasPassword ? "current-password" : "off"}
              autoCapitalize={hasPassword ? undefined : "characters"}
              autoCorrect={hasPassword ? undefined : "off"}
              spellCheck={hasPassword ? undefined : false}
              value={value}
              placeholder={
                hasPassword
                  ? t("settings.deleteAccountPasswordPlaceholder")
                  : DELETE_CONFIRM_PHRASE
              }
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button
                onClick={submit}
                disabled={!ready || busy}
                className="flex-1 bg-danger text-white hover:bg-danger/90"
              >
                {t("settings.deleteAccountSubmit")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setGateOpen(false);
                  setValue("");
                  setError(null);
                }}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
