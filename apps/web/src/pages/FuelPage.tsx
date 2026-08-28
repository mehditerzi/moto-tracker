import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Fuel, Plus, Trash2, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { MoneyInput, NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Field, FormRow } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { VehicleAvatar } from "@/components/VehicleAvatar";
import { AddVehicleButton } from "@/components/AddVehicleButton";
import { ErrorState } from "@/components/ErrorState";
import { useConfirm } from "@/components/ConfirmSheet";
import { useBikes } from "@/hooks/useBikes";
import { useFuelLogs, useCreateFuelLog, useDeleteFuelLog } from "@/hooks/useFuelLogs";
import { useDatedItemsForBike } from "@/hooks/useDatedItems";
import { fuelSummary, economySeries, monthlySpend } from "@/lib/fuelEconomy";
import { MonthlySpendChart, EconomyTrendChart } from "@/components/FuelCharts";
import { getActiveBikeId, storeActiveBikeId } from "@/hooks/useActiveBike";
import { formatDate } from "@/lib/format";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { track } from "@/lib/telemetry";
import type { Bike } from "@mototracker/shared";

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
  const bike = bikes.data?.find((b) => b.id === bikeId);

  if (bikes.isError) return <ErrorState onRetry={() => void bikes.refetch()} />;

  // "Add a vehicle first" used to be a bare sentence with nothing to tap — the
  // one screen in the app where the instruction and the action were separated.
  if (!bikes.isLoading && (!bikes.data || bikes.data.length === 0)) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center"
      >
        <div className="grid h-20 w-20 place-items-center rounded-3xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
          <Fuel className="h-9 w-9 text-muted dark:text-muted-dark" strokeWidth={1.5} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-balance text-[22px] font-semibold tracking-tight">
            {t("fuel.noVehicle")}
          </h1>
          <p className="text-pretty text-[14px] text-muted dark:text-muted-dark">
            {t("fuel.noVehicleSub")}
          </p>
        </div>
        <AddVehicleButton variant="accent" size="lg">
          <Plus className="h-4 w-4" /> {t("dashboard.addBike")}
        </AddVehicleButton>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-micro text-muted dark:text-muted-dark">{t("nav.fuel")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">
          {t("fuel.title")}
        </h1>
      </header>

      {/* Fuel is recorded per vehicle, so the vehicle is the screen's axis and
          not a control tucked into a corner of the header. It is stated even
          with a single vehicle — otherwise the one figure the page exists to
          show ("₺/km") is attached to nothing the reader can name. */}
      {bike && (
        <VehicleBar
          bike={bike}
          bikes={bikes.data ?? []}
          onChange={(id) => {
            setBikeId(id);
            storeActiveBikeId(id);
          }}
        />
      )}

      <SummaryCard summary={summary} />

      {/* The most repeated action on the screen now sits above the analysis
          rather than below two charts. */}
      {bikeId && <AddFuelForm bikeId={bikeId} vehicleName={bike?.nickname ?? ""} />}

      <CostsCard fuelTotal={fuelTotal} premiumTotal={premiumTotal} />

      <MonthlySpendChart months={monthlySpend(logs.data ?? [])} />
      <EconomyTrendChart points={economySeries(logs.data ?? [])} />

      {logs.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : logs.isError ? (
        <ErrorState onRetry={() => void logs.refetch()} />
      ) : (logs.data?.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center gap-1 py-8 text-center">
          <p className="text-sm font-medium">{t("fuel.empty")}</p>
          <p className="max-w-[34ch] text-[13px] text-muted dark:text-muted-dark">
            {t("fuel.emptySub")}
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="label-micro text-muted dark:text-muted-dark">{t("fuel.history")}</h2>
          {logs.data!.map((l) => (
            <FuelRow
              key={l.id}
              dateLabel={formatDate(l.filledOn, i18n.language)}
              liters={l.liters}
              cost={l.totalCost}
              odo={l.odometerKm}
              isFull={l.isFull}
              id={l.id}
            />
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * Which vehicle this screen is about. One row, one identity: the avatar and the
 * name/plate belong to whatever the picker currently reads, so there is never a
 * moment where the numbers below say one thing and the header another.
 */
function VehicleBar({
  bike,
  bikes,
  onChange,
}: {
  bike: Bike;
  bikes: Bike[];
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const many = bikes.length > 1;
  return (
    <Card className="p-3 sm:p-3">
      <div className="flex items-center gap-3">
        <VehicleAvatar vehicle={bike} size="thumb" className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="label-micro text-muted dark:text-muted-dark">{t("fuel.vehicle")}</div>
          {many ? (
            <Select
              className="mt-1 font-medium"
              value={bike.id}
              onChange={(e) => onChange(e.target.value)}
              aria-label={t("fuel.switchVehicle")}
            >
              {bikes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nickname}
                  {b.plate ? ` · ${b.plate}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="truncate text-[16px] font-semibold leading-tight">
                {bike.nickname}
              </span>
              {bike.plate && (
                <span className="num shrink-0 text-[12px] text-muted dark:text-muted-dark">
                  {bike.plate}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
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
      {/* No padding here: `Card` already pads itself (p-5 / sm:p-6). Setting
          p-4 as well inset the content 36px either side, which on a 320px
          phone spent a quarter of the viewport on padding. */}
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={t("fuel.economy")}
          value={summary.avgL100 != null ? `${summary.avgL100.toFixed(1)} L` : dash}
        />
        <Stat
          label={t("fuel.costPerKm")}
          value={summary.costPerKm != null ? `₺${summary.costPerKm.toFixed(2)}` : dash}
        />
        <Stat
          label={t("fuel.pricePerLiter")}
          value={summary.pricePerLiter != null ? `₺${summary.pricePerLiter.toFixed(2)}` : dash}
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
      <CardContent className="flex flex-col gap-2">
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

/** Today in the device's own timezone. `toISOString()` is UTC, which puts users
 *  east of Greenwich on tomorrow's date for part of every evening. */
function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function AddFuelForm({ bikeId, vehicleName }: { bikeId: string; vehicleName: string }) {
  const { t } = useTranslation();
  const create = useCreateFuelLog();
  // People log a fill-up while standing at the pump, so today is right almost
  // every time — defaulting it removes a required date-picker interaction from
  // the app's most repeated form.
  const [filledOn, setFilledOn] = useState(todayISO);
  const [liters, setLiters] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [odo, setOdo] = useState("");
  const [isFull, setIsFull] = useState(true);
  const [litersError, setLitersError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const litersN = parseFloat(liters);
    if (!(litersN > 0)) {
      // The submit used to return silently when litres was blank or zero, which
      // is indistinguishable from a save that failed on the network.
      setLitersError(t("fuel.litersRequired"));
      return;
    }
    if (!filledOn) return;
    setLitersError("");
    try {
      await create.mutateAsync({
        bikeId,
        filledOn,
        liters: litersN,
        totalCost: totalCost ? parseFloat(totalCost) : null,
        odometerKm: odo ? parseInt(odo, 10) : null,
        isFull,
      });
      track("fuel_logged", { hasCost: !!totalCost, hasOdo: !!odo, isFull });
      setFilledOn(todayISO());
      setLiters("");
      setTotalCost("");
      setOdo("");
      setIsFull(true);
      pushToast({ variant: "success", title: t("fuel.added") });
    } catch (err) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: friendlyError(err, t) });
    }
  };

  return (
    <Card>
      {/* `Card` pads itself; the p-4 that used to be here made it 36px a side.
          Those 32px are what the two-up rows below need to stay two-up. */}
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[15px] font-semibold leading-tight">{t("fuel.addTitle")}</h2>
            {/* Says, in words, which vehicle this fill-up will be filed against.
                Previously nothing on the form named the vehicle at all. */}
            <p className="text-[12px] text-muted dark:text-muted-dark">
              {t("fuel.loggingFor", { name: vehicleName })}
            </p>
          </div>

          {/* Row budget, phone, Turkish. A card's inner width is
              viewport − 32 (AppShell px-4) − 2 (hairline) − 40 (Card p-5):
              246px @320, 301px @375, 319px @393. FormRow's gap is 12px.
              This row needs 168 (`date`) + 12 + 108 (`tiny`) = 288 — two-up
              from 375 up, wrapping to two full rows at 320. */}
          <FormRow>
            {/* `date`, not `grow`: WebKit lays out its own gg.aa.yyyy segments
                and clips them rather than scrolling, so a date field squeezed
                under ~10.5rem prints the year under the picker glyph. `grow`'s
                9rem floor is inside that failure range. */}
            <Field label={t("fuel.date")} width="date">
              <DateInput
                value={filledOn}
                onChange={(e) => setFilledOn(e.target.value)}
                enterKeyHint="next"
                required
              />
            </Field>
            {/* 4–5 characters wide, because that is how much a litre reading is. */}
            <Field label={t("fuel.liters")} width="tiny" error={litersError}>
              <NumberInput
                decimal
                suffix="L"
                value={liters}
                onChange={(e) => {
                  setLiters(e.target.value);
                  if (litersError) setLitersError("");
                }}
                placeholder="35"
                enterKeyHint="next"
              />
            </Field>
          </FormRow>

          {/* 128 (`moneyGrow`) + 12 + 152 (`number`) = 292, so this row is
              two-up from 375 up as well and the two rows stay the same shape. */}
          <FormRow>
            <Field label={t("fuel.cost")} optional width="moneyGrow">
              <MoneyInput
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                placeholder="1500"
                enterKeyHint="next"
              />
            </Field>
            {/* `number`, not `short`. Two reasons, either one sufficient:
                "Kilometre" + the optional hint measures 144px and `short` is
                128px, so the hint used to spill out of the column; and an
                odometer is up to 7 digits, which is what `number` is for. */}
            <Field label={t("fuel.odometer")} optional width="number">
              <NumberInput
                suffix="km"
                value={odo}
                onChange={(e) => setOdo(e.target.value)}
                placeholder="12500"
                enterKeyHint="done"
              />
            </Field>
          </FormRow>

          <Checkbox
            checked={isFull}
            onChange={(e) => setIsFull(e.target.checked)}
            label={t("fuel.fullTank")}
            description={t("fuel.fullTankHint")}
          />

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
  isFull,
  id,
}: {
  dateLabel: string;
  liters: number;
  cost: number | null;
  odo: number | null;
  isFull: boolean;
  id: string;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const del = useDeleteFuelLog();

  // This was the one destructive action in the app with no confirmation and no
  // undo: a mis-tap silently destroyed a fill-up, and with it the economy figure
  // that depends on the gap between two odometer readings.
  const onDelete = async () => {
    if (!(await confirm({ title: t("fuel.deleteConfirm"), confirmLabel: t("items.delete"), destructive: true })))
      return;
    try {
      await del.mutateAsync(id);
    } catch (e) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) });
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg ring-1 ring-border dark:bg-bg-dark dark:ring-border-dark">
            <Fuel className="h-4 w-4 text-muted dark:text-muted-dark" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-medium">
              <span>
                {liters.toLocaleString()} L
                {cost != null && <span className="text-muted dark:text-muted-dark"> · ₺{cost.toLocaleString()}</span>}
              </span>
              {!isFull && (
                <span className="rounded-full bg-surface-elev px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted dark:bg-surface-elev-dark dark:text-muted-dark">
                  {t("fuel.partial")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-muted dark:text-muted-dark">
              <span>{dateLabel}</span>
              {odo != null && (
                <span className="num inline-flex items-center gap-1">
                  <Gauge className="h-3 w-3" /> {odo.toLocaleString()}
                </span>
              )}
              {cost != null && liters > 0 && (
                <span className="num">₺{(cost / liters).toFixed(2)}/L</span>
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
          onClick={() => void onDelete()}
          disabled={del.isPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </Card>
    </motion.div>
  );
}
