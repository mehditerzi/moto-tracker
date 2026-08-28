import { useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FleetCostVehicle } from "@mototracker/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { ErrorState } from "@/components/ErrorState";
import { useFleetContext } from "@/components/fleet/FleetLayout";
import { useFleetCosts } from "@/hooks/useFleetData";
import { Km, Money, Plate, SectionHeading, Stat } from "@/components/fleet/bits";
import { RowCard, SortableTh, TableShell, Td, Th, Tr, type SortDir } from "@/components/fleet/table";
import { cn } from "@/lib/cn";

type Sort = "costPerKm" | "totalCost" | "distanceKm" | "plate";

/**
 * `/fleet/costs` (docs/fleet-design.md §7.4) — fuel + service + compliance per
 * vehicle and per month, with ₺/km.
 *
 * THE INSIGHT IS THE OUTLIER, so it is stated rather than left to be found: the
 * API already computes the fleet median, each vehicle's ratio to it, and an
 * `outlier` flag, and this screen leads with that. Making a finance lead scan 40
 * rows for the expensive one is exactly the spreadsheet experience we are
 * replacing.
 *
 * `costPerKm` is null for a vehicle with neither fuel nor trip data. That is
 * rendered as an em dash and explained — never as ₺0.00, which would read as
 * "this van is free to run".
 */
export function FleetCostsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "tr" ? "tr-TR" : "en-US";
  const { org } = useFleetContext();
  const [months, setMonths] = useState(12);
  const to = new Date().toISOString().slice(0, 7);
  const from = shiftMonth(to, -(months - 1));
  const q = useFleetCosts(org.orgId, from, to);

  const [sort, setSort] = useState<Sort>("costPerKm");
  const [dir, setDir] = useState<SortDir>("desc");

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-hidden>
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />;

  const { fleet, vehicles, currency } = q.data;
  const outliers = vehicles.filter((v) => v.outlier);
  const maxMonth = Math.max(1, ...q.data.months.map((m) => m.totalCost));

  const sorted = [...vehicles].sort((a, b) => {
    const mul = dir === "asc" ? 1 : -1;
    switch (sort) {
      case "plate":
        return (a.plate ?? a.nickname).localeCompare(b.plate ?? b.nickname) * mul;
      case "totalCost":
        return (a.totalCost - b.totalCost) * mul;
      case "distanceKm":
        return (a.distanceKm - b.distanceKm) * mul;
      default:
        // Unknown ₺/km sorts last whichever way the column points: "we don't
        // know" is not the same as "cheapest".
        if (a.costPerKm === null && b.costPerKm === null) return 0;
        if (a.costPerKm === null) return 1;
        if (b.costPerKm === null) return -1;
        return (a.costPerKm - b.costPerKm) * mul;
    }
  });

  const onSort = (field: Sort) => {
    if (field === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setDir(field === "plate" ? "asc" : "desc");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("fleet.costs.totals")}>
        <SectionHeading title={t("fleet.costs.window", { from, to })}>
          <label className="flex items-center gap-2">
            <span className="sr-only">{t("fleet.costs.range")}</span>
            <Select
              controlSize="sm"
              wrapperClassName="w-40"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
            >
              {[3, 6, 12, 24].map((m) => (
                <option key={m} value={m}>
                  {t("fleet.costs.lastMonths", { count: m })}
                </option>
              ))}
            </Select>
          </label>
        </SectionHeading>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t("fleet.costs.total")} value={fmt(fleet.totalCost, currency, locale)} />
          <Stat label={t("fleet.costs.fuel")} value={fmt(fleet.fuelCost, currency, locale)} />
          <Stat label={t("fleet.costs.maintenance")} value={fmt(fleet.maintenanceCost, currency, locale)} />
          <Stat label={t("fleet.costs.compliance")} value={fmt(fleet.complianceCost, currency, locale)} />
          <Stat label={t("fleet.costs.distance")} value={`${Math.round(fleet.distanceKm).toLocaleString(locale)} km`} />
          <Stat
            label={t("fleet.costs.median")}
            value={fleet.medianCostPerKm === null ? "—" : fmt(fleet.medianCostPerKm, currency, locale)}
          />
        </div>
      </section>

      {outliers.length > 0 && (
        <section
          aria-label={t("fleet.costs.outliers")}
          className="rounded-2xl border border-warning/40 bg-warning/5 p-4"
        >
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-warning" aria-hidden />
            <h2 className="label-micro text-warning">{t("fleet.costs.outliers")}</h2>
          </div>
          <p className="mb-3 text-pretty text-[13px] text-muted dark:text-muted-dark">
            {t("fleet.costs.outliersExplain", {
              factor: fleet.outlierThreshold,
              median: fleet.medianCostPerKm === null ? "—" : fmt(fleet.medianCostPerKm, currency, locale),
            })}
          </p>
          <ul className="flex flex-col gap-1.5">
            {outliers.map((v) => (
              <li key={v.bikeId}>
                <Link
                  to={`/fleet/vehicles/${v.bikeId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface/70 px-3 py-2 transition hover:bg-surface dark:bg-surface-dark/60 dark:hover:bg-surface-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Plate plate={v.plate} />
                    <span className="truncate text-[13px] font-medium">{v.nickname}</span>
                  </span>
                  <span className="flex items-center gap-3 text-[13px]">
                    <span className="num font-semibold text-warning">
                      <Money value={v.costPerKm} currency={currency} />
                      <span className="ml-0.5 text-[11px] font-normal">/km</span>
                    </span>
                    {v.ratioToMedian !== null && (
                      <span className="num rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                        {t("fleet.costs.timesMedian", { ratio: v.ratioToMedian.toFixed(1) })}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={t("fleet.costs.byMonth")}>
        <SectionHeading title={t("fleet.costs.byMonth")} />
        <ul className="flex flex-col gap-1">
          {q.data.months.map((m) => (
            <li key={m.month} className="flex items-center gap-3">
              <span className="num w-16 shrink-0 text-[12px] text-muted dark:text-muted-dark">{m.month}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-elev dark:bg-surface-elev-dark">
                <span
                  aria-hidden
                  className="block h-full rounded-full bg-text/25 dark:bg-text-dark/25"
                  style={{ width: `${Math.round((m.totalCost / maxMonth) * 100)}%` }}
                />
              </span>
              <span className="num w-28 shrink-0 text-right text-[12px]">
                <Money value={m.totalCost} currency={currency} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t("fleet.costs.byVehicle")}>
        <SectionHeading title={t("fleet.costs.byVehicle")} count={vehicles.length} />

        <TableShell label={t("fleet.costs.byVehicle")}>
          <thead>
            <tr>
              <SortableTh field="plate" active={sort} dir={dir} onSort={onSort}>
                {t("fleet.cols.plate")}
              </SortableTh>
              <Th>{t("fleet.cols.vehicle")}</Th>
              <Th align="right">{t("fleet.costs.fuel")}</Th>
              <Th align="right">{t("fleet.costs.maintenance")}</Th>
              <Th align="right">{t("fleet.costs.compliance")}</Th>
              <SortableTh field="totalCost" active={sort} dir={dir} onSort={onSort} align="right">
                {t("fleet.costs.total")}
              </SortableTh>
              <SortableTh field="distanceKm" active={sort} dir={dir} onSort={onSort} align="right">
                {t("fleet.costs.distance")}
              </SortableTh>
              <SortableTh field="costPerKm" active={sort} dir={dir} onSort={onSort} align="right">
                {t("fleet.costs.perKm")}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((v) => (
              <Tr key={v.bikeId}>
                <Td>
                  <Link to={`/fleet/vehicles/${v.bikeId}`} className="hover:underline">
                    <Plate plate={v.plate} />
                  </Link>
                </Td>
                <Td>{v.nickname}</Td>
                <Td align="right">
                  <Money value={v.fuelCost} currency={currency} />
                </Td>
                <Td align="right">
                  <Money value={v.maintenanceCost} currency={currency} />
                </Td>
                <Td align="right">
                  <Money value={v.complianceCost} currency={currency} />
                </Td>
                <Td align="right" className="font-semibold">
                  <Money value={v.totalCost} currency={currency} />
                </Td>
                <Td align="right">
                  <Km value={v.distanceKm > 0 ? Math.round(v.distanceKm) : null} />
                </Td>
                <Td align="right">
                  <PerKm v={v} currency={currency} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>

        <ul className="flex flex-col gap-2 lg:hidden">
          {sorted.map((v) => (
            <li key={v.bikeId}>
              <RowCard className={cn(v.outlier && "border-warning/40")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Plate plate={v.plate} />
                      <span className="truncate text-[14px] font-semibold">{v.nickname}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted dark:text-muted-dark">
                      {t("fleet.costs.fuel")} <Money value={v.fuelCost} currency={currency} /> ·{" "}
                      {t("fleet.costs.maintenance")} <Money value={v.maintenanceCost} currency={currency} />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-semibold">
                      <Money value={v.totalCost} currency={currency} />
                    </div>
                    <div className="mt-0.5 text-[12px]">
                      <PerKm v={v} currency={currency} />
                    </div>
                  </div>
                </div>
              </RowCard>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PerKm({ v, currency }: { v: FleetCostVehicle; currency: string }) {
  const { t } = useTranslation();
  if (v.costPerKm === null) {
    return (
      <span className="text-[12px] text-muted dark:text-muted-dark" title={t("fleet.costs.noDistance")}>
        {t("common.dash")}
      </span>
    );
  }
  return (
    <span className={cn("num inline-flex items-center gap-1.5", v.outlier && "font-semibold text-warning")}>
      <Money value={v.costPerKm} currency={currency} />
      <span className="text-[11px] opacity-70">/km</span>
      {v.outlier && (
        <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold">
          {t("fleet.costs.outlierTag")}
        </span>
      )}
    </span>
  );
}

function fmt(n: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
