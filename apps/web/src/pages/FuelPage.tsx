import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Fuel, Plus, Trash2, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useBikes } from "@/hooks/useBikes";
import { useFuelLogs, useCreateFuelLog, useDeleteFuelLog } from "@/hooks/useFuelLogs";
import { useDatedItemsForBike } from "@/hooks/useDatedItems";
import { fuelSummary } from "@/lib/fuelEconomy";
import { getActiveBikeId, storeActiveBikeId } from "@/hooks/useActiveBike";
import { formatDate } from "@/lib/format";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { track } from "@/lib/telemetry";

export function FuelPage() {
  const { t, i18n } = useTranslation();
  const bikes = useBikes();
  const [bikeId, setBikeId] = useState<string | undefined>(() => getActiveBikeId());

  // Default to the active/first bike once the list loads (and self-heal a stale id).
  useEffect(() => {
    if (!bikes.data || bikes.data.length === 0) return;
    if (!bikeId || !bikes.data.some((b) => b.id === bikeId)) setBikeId(bikes.data[0]!.id);
  }, [bikes.data, bikeId]);

  const logs = useFuelLogs(bikeId);
  const items = useDatedItemsForBike(bikeId);
  const summary = fuelSummary(logs.data ?? []);
  const fuelTotal = (logs.data ?? []).reduce((s, l) => s + (l.totalCost ?? 0), 0);
  const premiumTotal = (items.data ?? []).reduce((s, i) => s + (i.cost ?? 0), 0);

  if (!bikes.isLoading && (!bikes.data || bikes.data.length === 0)) {
    return (
      <div className="py-16 text-center text-muted dark:text-muted-dark">{t("fuel.noVehicle")}</div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label-micro text-muted dark:text-muted-dark">{t("nav.fuel")}</div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">
            {t("fuel.title")}
          </h1>
        </div>
        {bikes.data && bikes.data.length > 1 && (
          <select
            value={bikeId ?? ""}
            onChange={(e) => {
              setBikeId(e.target.value);
              storeActiveBikeId(e.target.value);
            }}
            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
          >
            {bikes.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nickname}
              </option>
            ))}
          </select>
        )}
      </header>

      <SummaryCard summary={summary} />

      <CostsCard fuelTotal={fuelTotal} premiumTotal={premiumTotal} />

      {bikeId && <AddFuelForm bikeId={bikeId} />}

      {logs.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : (logs.data?.length ?? 0) === 0 ? (
        <p className="py-8 text-center text-sm text-muted dark:text-muted-dark">{t("fuel.empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {logs.data!.map((l) => (
            <FuelRow
              key={l.id}
              dateLabel={formatDate(l.filledOn, i18n.language)}
              liters={l.liters}
              cost={l.totalCost}
              odo={l.odometerKm}
              id={l.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="num text-[20px] font-semibold leading-none">{value}</span>
      <span className="text-[11px] text-muted dark:text-muted-dark">{label}</span>
    </div>
  );
}

function SummaryCard({ summary }: { summary: ReturnType<typeof fuelSummary> }) {
  const { t } = useTranslation();
  const dash = "—";
  return (
    <Card>
      <CardContent className="grid grid-cols-3 gap-3 p-4">
        <Stat
          label={t("fuel.economy")}
          value={summary.avgL100 != null ? `${summary.avgL100.toFixed(1)} L` : dash}
        />
        <Stat
          label={t("fuel.costPerKm")}
          value={summary.costPerKm != null ? `₺${summary.costPerKm.toFixed(2)}` : dash}
        />
        <Stat label={t("fuel.last30")} value={`₺${Math.round(summary.last30Spend).toLocaleString()}`} />
      </CardContent>
    </Card>
  );
}

function CostsCard({ fuelTotal, premiumTotal }: { fuelTotal: number; premiumTotal: number }) {
  const { t } = useTranslation();
  const total = fuelTotal + premiumTotal;
  if (total <= 0) return null;
  const tl = (n: number) => `₺${Math.round(n).toLocaleString()}`;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted dark:text-muted-dark">{t("fuel.totalSpend")}</span>
          <span className="num text-[20px] font-semibold leading-none">{tl(total)}</span>
        </div>
        <div className="flex items-center justify-between text-[13px] text-muted dark:text-muted-dark">
          <span>{t("nav.fuel")}</span>
          <span className="num">{tl(fuelTotal)}</span>
        </div>
        <div className="flex items-center justify-between text-[13px] text-muted dark:text-muted-dark">
          <span>{t("fuel.premiums")}</span>
          <span className="num">{tl(premiumTotal)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function AddFuelForm({ bikeId }: { bikeId: string }) {
  const { t } = useTranslation();
  const create = useCreateFuelLog();
  const [filledOn, setFilledOn] = useState("");
  const [liters, setLiters] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [odo, setOdo] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const litersN = parseFloat(liters);
    if (!filledOn || !(litersN > 0)) return;
    try {
      await create.mutateAsync({
        bikeId,
        filledOn,
        liters: litersN,
        totalCost: totalCost ? parseFloat(totalCost) : null,
        odometerKm: odo ? parseInt(odo, 10) : null,
        isFull: true,
      });
      track("fuel_logged", { hasCost: !!totalCost, hasOdo: !!odo });
      setFilledOn("");
      setLiters("");
      setTotalCost("");
      setOdo("");
      pushToast({ variant: "success", title: t("fuel.added") });
    } catch (err) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: friendlyError(err, t) });
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-date">{t("fuel.date")}</Label>
              <Input id="f-date" type="date" value={filledOn} onChange={(e) => setFilledOn(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-liters">{t("fuel.liters")}</Label>
              <Input
                id="f-liters"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={liters}
                onChange={(e) => setLiters(e.target.value)}
                placeholder="35"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-cost">{t("fuel.cost")}</Label>
              <Input id="f-cost" type="number" inputMode="decimal" step="0.01" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} placeholder="1500" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-odo">{t("fuel.odometer")}</Label>
              <Input id="f-odo" type="number" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} placeholder="12500" />
            </div>
          </div>
          <Button type="submit" variant="accent" disabled={create.isPending}>
            <Plus className="h-4 w-4" /> {t("fuel.add")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function FuelRow({
  dateLabel,
  liters,
  cost,
  odo,
  id,
}: {
  dateLabel: string;
  liters: number;
  cost: number | null;
  odo: number | null;
  id: string;
}) {
  const { t } = useTranslation();
  const del = useDeleteFuelLog();
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg ring-1 ring-border dark:bg-bg-dark dark:ring-border-dark">
            <Fuel className="h-4 w-4 text-muted dark:text-muted-dark" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-medium">
              {liters.toLocaleString()} L
              {cost != null && <span className="text-muted dark:text-muted-dark"> · ₺{cost.toLocaleString()}</span>}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-muted dark:text-muted-dark">
              <span>{dateLabel}</span>
              {odo != null && (
                <span className="num inline-flex items-center gap-1">
                  <Gauge className="h-3 w-3" /> {odo.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("items.delete")}
          className="h-9 w-9 text-muted hover:text-danger"
          onClick={() => del.mutate(id)}
          disabled={del.isPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </Card>
    </motion.div>
  );
}
