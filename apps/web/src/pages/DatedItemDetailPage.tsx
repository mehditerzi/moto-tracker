import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Pencil, RotateCw, ArrowLeft, ScanLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDatedItem, useDatedItemsForBike } from "@/hooks/useDatedItems";
import { statusFor, statusColorClass } from "@/lib/datedItems";
import { cn } from "@/lib/cn";

export function DatedItemDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const item = useDatedItem(id);
  const history = useDatedItemsForBike(item.data?.bikeId);

  if (item.isLoading) {
    return <p className="text-center text-muted dark:text-muted-dark">{t("common.loading")}</p>;
  }
  if (item.isError || !item.data) {
    return <p className="text-center text-danger">{t("common.notFound")}</p>;
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
            <div className="num mt-2 text-sm opacity-80">{item.data.expiresOn}</div>
          </div>

          <Field label={t("items.provider")} value={item.data.provider} />
          <Field label={t("items.policyNo")} value={item.data.policyNo} />
          <Field
            label={t("items.amount")}
            value={item.data.cost !== null ? `${item.data.cost} TL` : null}
          />
          <Field label={t("items.note")} value={item.data.notes} multiline />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild variant="accent" className="flex-1">
          <Link to={`/bikes/${item.data.bikeId}/dated-items/new?type=${item.data.type}`}>
            <RotateCw className="h-4 w-4" /> {t("items.renew")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/capture?bikeId=${item.data.bikeId}`}>
            <ScanLine className="h-4 w-4" />
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
                      <span className="font-mono">{r.expiresOn}</span>
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
