import { CalendarClock, Search, ShieldCheck, Receipt, ExternalLink, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { OFFICIAL_SERVICES } from "@/lib/turkishServices";
import { track } from "@/lib/telemetry";

const ICONS: Record<string, LucideIcon> = {
  inspectionBooking: CalendarClock,
  inspectionStatus: Search,
  insurancePolicy: ShieldCheck,
  trafficFines: Receipt,
};

/**
 * Quick links to the official Turkish vehicle services (TÜVTÜRK + e-Devlet).
 * Plain anchors with target=_blank — on native (Capacitor) an off-host https
 * link opens in the system browser, where the user's e-Devlet login works.
 */
export function OfficialServicesCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("services.title")}</CardTitle>
        <CardDescription>{t("services.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="gap-2">
        {OFFICIAL_SERVICES.map((s) => {
          const Icon = ICONS[s.id] ?? ExternalLink;
          return (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("service_opened", { id: s.id })}
              className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition hover:border-text/20 hover:bg-surface-elev dark:border-border-dark dark:hover:bg-surface-elev-dark"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg ring-1 ring-border dark:bg-bg-dark dark:ring-border-dark">
                <Icon className="h-4 w-4 text-muted dark:text-muted-dark" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1 text-[14px] font-medium">{t(s.labelKey)}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted dark:text-muted-dark" />
            </a>
          );
        })}
      </CardContent>
    </Card>
  );
}
