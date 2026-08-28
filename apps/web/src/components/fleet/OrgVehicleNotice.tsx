import { Eye, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { env } from "@/env";

/**
 * The standing monitoring notice on a company vehicle's dashboard.
 *
 * The one-time acknowledgement (OrgTripDisclosure) is shown once and then gone;
 * the fact it described is permanent, so the driver needs somewhere to re-read
 * it without hunting through a policy page. This is that place: one always-
 * visible line saying the organization can see trips recorded on this vehicle,
 * expanding to the three limits and a link to the full policy section.
 *
 * Deliberately not dismissible and deliberately quiet — it is a fact about the
 * vehicle, not an alert, so it sits in the same muted register as the odometer
 * rather than shouting in danger red every time the driver opens the app.
 */
export function OrgVehicleNotice({ orgName }: { orgName: string }) {
  const { t } = useTranslation();
  return (
    <details className="rounded-xl border border-border bg-surface/60 px-3.5 py-2.5 dark:border-border-dark dark:bg-surface-dark/50">
      <summary className="flex cursor-pointer list-none items-start gap-2 text-[13px] text-muted dark:text-muted-dark">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="text-pretty">
          {t("fleet.notice.summary", { org: orgName })}{" "}
          <span className="font-medium underline underline-offset-2">{t("fleet.notice.more")}</span>
        </span>
      </summary>
      <ul className="mt-2.5 flex flex-col gap-1.5 pl-5">
        {[
          t("fleet.limits.thisVehicle"),
          t("fleet.limits.whileAssigned"),
          t("fleet.limits.neverPersonal"),
        ].map((line) => (
          <li key={line} className="flex gap-2 text-pretty text-[12px] text-muted dark:text-muted-dark">
            <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-border-strong dark:bg-border-strong-dark" />
            {line}
          </li>
        ))}
      </ul>
      <a
        href={`${env.VITE_API_URL}/privacy#organizations`}
        target="_blank"
        rel="noreferrer"
        className="mt-2.5 inline-flex items-center gap-1.5 pl-5 text-[12px] font-medium underline underline-offset-4"
      >
        {t("fleet.policyLink")}
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </details>
  );
}
