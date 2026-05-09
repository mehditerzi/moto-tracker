import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Bell, BellOff, LogOut } from "lucide-react";
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
        pushToast({ variant: "danger", title: "Hata", description: (e as Error).message });
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col gap-3"
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.title")}</CardTitle>
        </CardHeader>
        <CardContent className="gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
              {t("settings.language")}
            </h3>
            <div className="flex gap-2">
              <LangButton active={i18n.language.startsWith("tr")} onClick={() => onLang("tr")}>
                {t("settings.tr")}
              </LangButton>
              <LangButton active={i18n.language.startsWith("en")} onClick={() => onLang("en")}>
                {t("settings.en")}
              </LangButton>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
              {t("settings.notifications")}
            </h3>

            {!push.data?.supported && (
              <p className="text-sm text-muted dark:text-muted-dark">
                Bu tarayıcı bildirimleri desteklemiyor. {t("settings.iosHint")}
              </p>
            )}
            {push.data?.supported && (
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
                            title: `Gönderildi: ${r.sent}/${r.total}`,
                          }),
                        )
                        .catch((e) =>
                          pushToast({ variant: "danger", title: "Hata", description: String(e) }),
                        )
                    }
                  >
                    {t("settings.sendTest")}
                  </Button>
                )}
              </>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
              {t("settings.leadDays")}
            </h3>
            {prefs.data?.map((p) => <PrefRow key={p.itemType} pref={p} />)}
          </section>

          <Button
            variant="danger"
            onClick={async () => {
              await signOut();
              navigate("/sign-in");
            }}
          >
            <LogOut className="h-4 w-4" /> {t("settings.signOut")}
          </Button>
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
    <div className="rounded-xl border border-border p-3 dark:border-border-dark">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{t(`items.${pref.itemType}`)}</span>
        <button
          onClick={toggleEnabled}
          className={cn(
            "rounded-full px-2 py-0.5 text-xs",
            pref.enabled
              ? "bg-success/15 text-success"
              : "bg-surface text-muted dark:bg-surface-elev-dark dark:text-muted-dark",
          )}
        >
          {pref.enabled ? "Açık" : "Kapalı"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {LEAD_OPTIONS.map((n) => {
          const on = pref.leadDays.includes(n);
          return (
            <button
              key={n}
              onClick={() => toggleLead(n)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                on
                  ? "border-accent bg-accent/15 text-text dark:text-text-dark"
                  : "border-border text-muted dark:border-border-dark dark:text-muted-dark",
              )}
            >
              {n === 0 ? "gün" : `-${n}g`}
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
        "flex-1 rounded-xl border px-3 py-2 text-sm",
        active
          ? "border-accent bg-accent/15"
          : "border-border dark:border-border-dark",
      )}
    >
      {children}
    </button>
  );
}
