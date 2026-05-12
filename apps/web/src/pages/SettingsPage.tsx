import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Bell, BellOff, LogOut, Globe } from "lucide-react";
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

const LEAD_OPTIONS = [60, 30, 14, 7, 3, 1, 0];

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const prefs = useNotifPrefs();
  const push = usePushStatus();
  const enablePush = useEnablePush();
  const disablePush = useDisablePush();
  const test = useSendTestPush();

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
          description: (e as Error).message,
        });
      }
    }
  };

  const onSignOut = async () => {
    if (!confirm(t("settings.signOutConfirm"))) return;
    await signOut();
    navigate("/sign-in");
  };

  const isIos =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/.test(navigator.userAgent) &&
    !(window.matchMedia?.("(display-mode: standalone)").matches ||
      // @ts-expect-error: iOS-only Safari property
      window.navigator?.standalone === true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col gap-3"
    >
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-muted dark:text-muted-dark" />
            {t("settings.language")}
          </CardTitle>
        </CardHeader>
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-muted dark:text-muted-dark" />
            {t("settings.notifications")}
          </CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          {push.isLoading ? (
            <p className="text-sm text-muted dark:text-muted-dark">{t("common.loading")}</p>
          ) : !push.data?.supported ? (
            <p className="text-sm text-muted dark:text-muted-dark">{t("settings.unsupported")}</p>
          ) : push.data.permission === "denied" ? (
            <p className="text-sm text-danger">{t("settings.permissionDenied")}</p>
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
                  onClick={() =>
                    test
                      .mutateAsync()
                      .then((r) =>
                        pushToast({
                          variant: r.sent > 0 ? "success" : "danger",
                          title: t("settings.testSent", { sent: r.sent, total: r.total }),
                        }),
                      )
                      .catch((e) =>
                        pushToast({
                          variant: "danger",
                          title: t("common.error"),
                          description: String(e),
                        }),
                      )
                  }
                >
                  {t("settings.sendTest")}
                </Button>
              )}
            </>
          )}
          {isIos && (
            <p className="text-xs text-muted dark:text-muted-dark">{t("settings.iosHint")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.leadDays")}</CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          {prefs.data?.map((p) => <PrefRow key={p.itemType} pref={p} />)}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function PrefRow({ pref }: { pref: NotifPreference }) {
  const { t } = useTranslation();
  const update = useUpdateNotifPref(pref.itemType);

  const toggleLead = (n: number) => {
    const set = new Set(pref.leadDays);
    if (set.has(n)) set.delete(n);
    else set.add(n);
    void update.mutateAsync({
      enabled: pref.enabled,
      leadDays: [...set].sort((a, b) => b - a),
    });
  };
  const toggleEnabled = () => {
    void update.mutateAsync({ enabled: !pref.enabled, leadDays: pref.leadDays });
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition",
        pref.enabled
          ? "border-border dark:border-border-dark"
          : "border-border bg-surface/40 opacity-70 dark:border-border-dark dark:bg-surface-elev-dark/40",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{t(`items.${pref.itemType}`)}</span>
        <button
          onClick={toggleEnabled}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider transition",
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
          const label = n === 0 ? t("settings.onTheDay") : `-${n}g`;
          return (
            <button
              key={n}
              onClick={() => toggleLead(n)}
              disabled={!pref.enabled}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
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
        "flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
        active
          ? "border-accent bg-accent/15 text-text dark:text-text-dark"
          : "border-border text-muted hover:border-text/30 dark:border-border-dark dark:text-muted-dark dark:hover:border-text-dark/30",
      )}
    >
      {children}
    </button>
  );
}
