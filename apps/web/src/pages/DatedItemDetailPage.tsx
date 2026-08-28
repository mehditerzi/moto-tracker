import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { addYears, format, parseISO } from "date-fns";
import { Pencil, RotateCw, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DatedItemType } from "@mototracker/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { useDatedItem, useDatedItemsForBike } from "@/hooks/useDatedItems";
import { ApiError } from "@/lib/api";
import { statusFor, statusColorClass } from "@/lib/datedItems";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

/**
 * "Renew" used to open an empty date picker, making the user scroll a calendar
 * to a date that is nearly always knowable: a renewed policy runs from where the
 * old one ended. Sigorta and kasko are annual in Turkey without exception, so
 * we prefill expiry + 1 year (still editable). Muayene periods vary by vehicle
 * age and class and MTV is paid in instalments, so those two are left blank
 * rather than guessed wrong.
 */
function renewTo(bikeId: string, type: DatedItemType, expiresOn: string): string {
  const base = `/bikes/${bikeId}/dated-items/new?type=${type}`;
  if (type !== "sigorta" && type !== "kasko") return base;
  const next = addYears(parseISO(expiresOn), 1);
  if (Number.isNaN(next.getTime())) return base;
  return `${base}&expiresOn=${format(next, "yyyy-MM-dd")}`;
}

export function DatedItemDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const item = useDatedItem(id);
  const history = useDatedItemsForBike(item.data?.bikeId);

  if (item.isLoading) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4" aria-hidden>
        <Skeleton className="h-8 w-20 rounded-xl" />
        <Skeleton className="h-72 rounded-2xl" />
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="h-11 flex-1 rounded-xl" />
        </div>
      </div>
    );
  }
  // A deleted record reached from a stale notification or the widget used to
  // land on a bare red sentence with no navigation at all — inside AppShell you
  // could still tab away, but the screen itself was a dead end.
  if (item.isError || !item.data) {
    const gone = item.error instanceof ApiError && item.error.status === 404;
    return (
      <ErrorState
        onRetry={gone ? undefined : () => void item.refetch()}
        title={gone ? t("common.notFound") : undefined}
        description={gone ? t("errors.not_found") : undefined}
      >
        <Button asChild variant={gone ? "accent" : "ghost"} className={gone ? "" : "text-muted dark:text-muted-dark"}>
          <Link to="/dashboard">
            <ArrowLeft className="h-4 w-4" /> {t("notFound.home")}
          </Link>
        </Button>
      </ErrorState>
    );
  }

  const info = statusFor(item.data.expiresOn);
  const sameType = (history.data ?? [])
    .filter((r) => r.type === item.data!.type)
    .sort((a, b) => (a.expiresOn < b.expiresOn ? 1 : -1));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col gap-4"
    >
      <div className="-mt-2 flex items-center">
        <Button asChild variant="ghost" size="sm">
          <Link to="/dashboard">
            <ArrowLeft className="h-4 w-4" /> {t("common.back")}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="label-micro text-muted dark:text-muted-dark">
            {t("dashboard.active")}
          </div>
          <CardTitle className="text-[22px] tracking-tight">
            {t(`items.${item.data.type}`)}
          </CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <div
            className={cn(
              "flex flex-col items-center gap-1 rounded-2xl border p-6",
              statusColorClass(info.status),
            )}
          >
            <div className="num text-[64px] font-semibold leading-none tracking-tight">
              {info.daysRemaining === null
                ? "—"
                : info.daysRemaining < 0
                  ? t("items.expired")
                  : info.daysRemaining}
            </div>
            <div className="label-micro mt-1 opacity-80">
              {info.daysRemaining !== null && info.daysRemaining >= 0 ? t("items.daysLeft") : ""}
            </div>
            <div className="num mt-2 text-sm opacity-80">{formatDate(item.data.expiresOn, i18n.language)}</div>
          </div>

          <Field label={t("items.provider")} value={item.data.provider} />
          <Field label={t("items.policyNo")} value={item.data.policyNo} />
          <Field
            label={t("items.amount")}
            value={item.data.cost !== null ? `${item.data.cost} ${t("items.currency")}` : null}
          />
          <Field label={t("items.note")} value={item.data.notes} multiline />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild variant="accent" className="flex-1">
          <Link to={renewTo(item.data.bikeId, item.data.type, item.data.expiresOn)}>
            <RotateCw className="h-4 w-4" /> {t("items.renew")}
          </Link>
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <Link to={`/dated-items/${item.data.id}/edit`}>
            <Pencil className="h-4 w-4" /> {t("items.edit")}
          </Link>
        </Button>
      </div>

      {sameType.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("items.history")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {sameType.map((r) => {
                const s = statusFor(r.expiresOn);
                return (
                  <li key={r.id}>
                    <Link
                      to={`/dated-items/${r.id}`}
                      className={cn(
                        "flex items-center justify-between rounded-xl border p-3 text-sm",
                        statusColorClass(s.status),
                        r.id === item.data!.id && "ring-2 ring-accent/40",
                      )}
                    >
                      <span className="font-mono">{formatDate(r.expiresOn, i18n.language)}</span>
                      <span className="opacity-80">{r.provider ?? "—"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string | null | undefined;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted dark:text-muted-dark">
        {label}
      </span>
      <span className={multiline ? "whitespace-pre-wrap text-sm" : "text-sm"}>
        {value ?? <em className="opacity-60">—</em>}
      </span>
    </div>
  );
}
