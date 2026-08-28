import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Building2, Check, Eye, EyeOff, ExternalLink, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { env } from "@/env";

/**
 * The one-time employee-monitoring acknowledgement (KVKK *aydınlatma*).
 *
 * WHY A DIALOG AND NOT A TOAST. On a company vehicle the organization can read
 * the GPS route a driver recorded, when it started and ended, how far it went,
 * and who recorded it. Telling someone they are being monitored is not a status
 * message — it has to be shown before the monitoring starts and it has to be
 * acknowledged, so trip recording stays suspended until this is accepted (see
 * hooks/useFleetDisclosure.ts and the tracker gate in AppShell).
 *
 * WHAT IT MUST CONTAIN, and does: what IS shared, what is NOT, the three limits
 * on it, and a link to the full policy. Turkish is the primary text here — this
 * is the disclosure surface for a Turkish employee, so it is written, not
 * machine-translated.
 *
 * WHAT IT DOES NOT DO: gate the app. There is one button and it is an
 * acknowledgement, never a consent-or-leave. Location permission stays a device
 * decision the driver can refuse, with the app still fully usable — which the
 * copy says out loud, because a notice that implies otherwise would be worse
 * than none.
 */
export function OrgTripDisclosure({
  orgName,
  onAcknowledge,
}: {
  orgName: string;
  onAcknowledge: () => void;
}) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  const privacyUrl = `${env.VITE_API_URL}/privacy#organizations`;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 pb-safe pl-safe pr-safe sm:items-center sm:p-4">
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="org-disclosure-title"
        aria-describedby="org-disclosure-body"
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-card dark:bg-surface-elev-dark sm:rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-elev ring-1 ring-border dark:bg-bg-dark dark:ring-border-dark">
            <Building2 className="h-5 w-5 text-muted dark:text-muted-dark" strokeWidth={1.8} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id="org-disclosure-title" className="text-balance text-[18px] font-semibold leading-tight tracking-tight">
              {t("fleet.disclosure.title")}
            </h2>
            <p className="mt-1 text-[13px] text-muted dark:text-muted-dark">
              {t("fleet.disclosure.subtitle", { org: orgName })}
            </p>
          </div>
        </div>

        <div id="org-disclosure-body" className="mt-4 flex flex-col gap-4">
          <Group
            icon={<Eye className="h-4 w-4 text-warning" aria-hidden />}
            title={t("fleet.disclosure.sharedTitle")}
            items={[
              t("fleet.disclosure.shared.route"),
              t("fleet.disclosure.shared.times"),
              t("fleet.disclosure.shared.distance"),
              t("fleet.disclosure.shared.who"),
              t("fleet.disclosure.shared.records"),
            ]}
          />

          <Group
            icon={<EyeOff className="h-4 w-4 text-success" aria-hidden />}
            title={t("fleet.disclosure.notSharedTitle")}
            items={[
              t("fleet.disclosure.notShared.personal"),
              t("fleet.disclosure.notShared.liveRide"),
              t("fleet.disclosure.notShared.account"),
            ]}
          />

          <Group
            icon={<Check className="h-4 w-4 text-muted dark:text-muted-dark" aria-hidden />}
            title={t("fleet.disclosure.limitsTitle")}
            items={[
              t("fleet.limits.thisVehicle"),
              t("fleet.limits.whileAssigned"),
              t("fleet.limits.neverPersonal"),
            ]}
          />

          <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-elev/60 p-3 text-[13px] text-muted dark:border-border-dark dark:bg-bg-dark/40 dark:text-muted-dark">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="text-pretty">{t("fleet.disclosure.permission")}</span>
          </p>

          <a
            href={privacyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium underline underline-offset-4"
          >
            {t("fleet.policyLink")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>

        <Button
          ref={buttonRef}
          variant="accent"
          size="lg"
          className="mt-5 w-full"
          onClick={onAcknowledge}
        >
          {t("fleet.disclosure.acknowledge")}
        </Button>
      </motion.div>
    </div>,
    document.body,
  );
}

function Group({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
}) {
  return (
    <section>
      <h3 className="label-micro mb-1.5 flex items-center gap-1.5 text-text dark:text-text-dark">
        {icon}
        {title}
      </h3>
      <ul className="flex flex-col gap-1 pl-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-pretty text-[13px] text-muted dark:text-muted-dark">
            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-border-strong dark:bg-border-strong-dark" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
