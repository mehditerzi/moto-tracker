import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Pencil, RotateCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDatedItem, useDatedItemsForBike } from "@/hooks/useDatedItems";
import { statusFor, statusColorClass, TYPE_LABEL_TR } from "@/lib/datedItems";
import { cn } from "@/lib/cn";

export function DatedItemDetailPage() {
  const { id } = useParams();
  const item = useDatedItem(id);
  const history = useDatedItemsForBike(item.data?.bikeId);

  if (item.isLoading) {
    return <p className="text-center text-muted dark:text-muted-dark">Yükleniyor...</p>;
  }
  if (item.isError || !item.data) {
    return <p className="text-center text-danger">Bulunamadı.</p>;
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
      <Card>
        <CardHeader>
          <CardTitle>{TYPE_LABEL_TR[item.data.type]}</CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <div
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border p-4",
              statusColorClass(info.status),
            )}
          >
            <div className="font-mono text-5xl font-semibold tabular-nums leading-none">
              {info.daysRemaining === null
                ? "—"
                : info.daysRemaining < 0
                  ? "Geçti"
                  : info.daysRemaining}
            </div>
            <div className="text-xs opacity-80">
              {info.daysRemaining !== null && info.daysRemaining >= 0 ? "gün kaldı" : ""}
            </div>
            <div className="mt-1 text-sm opacity-80">{item.data.expiresOn}</div>
          </div>

          <Field label="Şirket" value={item.data.provider} />
          <Field label="Poliçe no" value={item.data.policyNo} />
          <Field label="Tutar" value={item.data.cost !== null ? `${item.data.cost} TL` : null} />
          <Field label="Not" value={item.data.notes} multiline />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild variant="accent" className="flex-1">
          <Link to={`/bikes/${item.data.bikeId}/dated-items/new?type=${item.data.type}`}>
            <RotateCw className="h-4 w-4" /> Yenile
          </Link>
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <Link to={`/dated-items/${item.data.id}/edit`}>
            <Pencil className="h-4 w-4" /> Düzenle
          </Link>
        </Button>
      </div>

      {sameType.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Geçmiş</CardTitle>
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
      <span className="text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
        {label}
      </span>
      <span className={multiline ? "whitespace-pre-wrap text-sm" : "text-sm"}>
        {value ?? <em className="opacity-60">—</em>}
      </span>
    </div>
  );
}
