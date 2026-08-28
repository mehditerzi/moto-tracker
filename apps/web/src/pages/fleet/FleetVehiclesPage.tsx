import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Search, FileClock, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FleetInventoryRow, FleetInventorySort, FleetStatus } from "@mototracker/shared";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { AddVehicleButton } from "@/components/AddVehicleButton";
import { useFleetContext } from "@/components/fleet/FleetLayout";
import { canManageFleet } from "@/hooks/useOrgs";
import { useFleetInventory, useOrgDetail } from "@/hooks/useFleetData";
import {
  DaysRemaining,
  DueKindLabel,
  HolderCell,
  Km,
  Plate,
  StatusBadge,
  StatusRail,
} from "@/components/fleet/bits";
import { RowCard, SortableTh, TableShell, Td, Th, Tr, type SortDir } from "@/components/fleet/table";

/**
 * `/fleet/vehicles` — the full inventory (docs/fleet-design.md §7.2).
 *
 * Sorting and filtering are server-side because both are DERIVED (a status is a
 * date minus today, a holder is one of two tables) and the API is the only place
 * that rule lives. The client's job is to keep the table on screen while a sort
 * round-trips, which `placeholderData` does — clicking a header should re-point
 * the arrow, not blank the screen.
 *
 * Plate search is forwarded verbatim: the API folds spacing on both sides, so
 * `34ABC123` finds `34 ABC 123`, which is how people type a plate they are
 * reading off a windscreen.
 */
export function FleetVehiclesPage() {
  const { t } = useTranslation();
  const { org } = useFleetContext();
  const navigate = useNavigate();

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<FleetStatus | "">("");
  const [holder, setHolder] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState<FleetInventorySort>("expiry");
  const [dir, setDir] = useState<SortDir>("asc");

  // Debounced: a plate is 7 characters and one request per keystroke would
  // re-sort the table under the user's fingers.
  useEffect(() => {
    const h = setTimeout(() => setQuery(rawQuery.trim()), 220);
    return () => clearTimeout(h);
  }, [rawQuery]);

  const q = useFleetInventory(org.orgId, {
    q: query || undefined,
    status: status || undefined,
    holder: holder || undefined,
    sort,
    dir,
    includeArchived,
  });

  // Holder options accumulate across loads: filtering BY a holder narrows the
  // response to that holder, so deriving the option list from the current page
  // alone would make the filter collapse to one entry the moment it is used.
  const seenHolders = useRef(new Map<string, string>());
  for (const row of q.data?.items ?? []) {
    if (row.holder) seenHolders.current.set(row.holder.id, row.holder.name);
  }
  const holderOptions = useMemo(
    () => [...seenHolders.current.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data],
  );

  const onSort = (field: FleetInventorySort) => {
    if (field === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setDir("asc");
    }
  };

  const rows = q.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <AddVehicleAction />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted dark:text-muted-dark"
            aria-hidden
          />
          <Input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder={t("fleet.vehicles.searchPlaceholder")}
            aria-label={t("fleet.vehicles.search")}
            className="pl-9"
          />
        </div>

        <label className="flex items-center gap-2">
          <span className="sr-only">{t("fleet.vehicles.filterStatus")}</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as FleetStatus | "")}
            className="h-11 rounded-xl border border-border bg-surface px-2.5 text-[13px] dark:border-border-dark dark:bg-surface-elev-dark"
          >
            <option value="">{t("fleet.vehicles.anyStatus")}</option>
            {(["expired", "danger", "soon", "ok", "unset"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`fleet.status.${s}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <span className="sr-only">{t("fleet.vehicles.filterHolder")}</span>
          <select
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            className="h-11 max-w-[200px] rounded-xl border border-border bg-surface px-2.5 text-[13px] dark:border-border-dark dark:bg-surface-elev-dark"
          >
            <option value="">{t("fleet.vehicles.anyHolder")}</option>
            <option value="assigned">{t(`fleet.vehicles.inUse.${org.mode}`)}</option>
            <option value="idle">{t("fleet.holder.idle")}</option>
            {holderOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-muted dark:text-muted-dark">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-accent dark:border-border-dark"
          />
          {t("fleet.vehicles.includeArchived")}
        </label>
      </div>

      {q.isPending ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
      ) : q.isError || !q.data ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-[14px] text-muted dark:border-border-dark dark:text-muted-dark">
          {t("fleet.vehicles.noMatches")}
        </p>
      ) : (
        <>
          <p aria-live="polite" className="text-[12px] text-muted dark:text-muted-dark">
            {t("fleet.vehicles.showing", { count: rows.length, total: q.data.total })}
          </p>

          <TableShell label={t("fleet.tabs.vehicles")}>
            <thead>
              <tr>
                <SortableTh field="plate" active={sort} dir={dir} onSort={onSort}>
                  {t("fleet.cols.plate")}
                </SortableTh>
                <SortableTh field="nickname" active={sort} dir={dir} onSort={onSort}>
                  {t("fleet.cols.vehicle")}
                </SortableTh>
                <SortableTh field="status" active={sort} dir={dir} onSort={onSort}>
                  {t("fleet.cols.status")}
                </SortableTh>
                <Th>{t("fleet.cols.due")}</Th>
                <SortableTh field="expiry" active={sort} dir={dir} onSort={onSort} align="right">
                  {t("fleet.cols.days")}
                </SortableTh>
                <SortableTh field="km" active={sort} dir={dir} onSort={onSort} align="right">
                  {t("fleet.cols.km")}
                </SortableTh>
                <Th>{t("fleet.cols.kmDue")}</Th>
                <Th>{t("fleet.cols.holder")}</Th>
                <Th className="w-8">
                  <span className="sr-only">{t("fleet.cols.open")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.bikeId} onClick={() => navigate(`/fleet/vehicles/${r.bikeId}`)}>
                  <Td>
                    <Plate plate={r.plate} />
                  </Td>
                  <Td>
                    <span className="font-medium">{r.nickname}</span>
                    <span className="ml-2 text-muted dark:text-muted-dark">
                      {[r.make, r.model, r.year].filter(Boolean).join(" ")}
                    </span>
                    {r.archived && (
                      <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted dark:border-border-dark dark:text-muted-dark">
                        {t("fleet.vehicles.archived")}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td>
                    {r.nextDue ? (
                      <span>
                        <DueKindLabel kind={r.nextDue.kind} label={r.nextDue.label} />
                        <span className="num ml-2 text-muted dark:text-muted-dark">{r.nextDue.dueOn}</span>
                      </span>
                    ) : (
                      <span className="text-muted dark:text-muted-dark">{t("fleet.vehicles.noDeadline")}</span>
                    )}
                  </Td>
                  <Td align="right">
                    {r.nextDue ? (
                      <DaysRemaining days={r.nextDue.daysRemaining} status={r.status} />
                    ) : (
                      <span className="text-muted dark:text-muted-dark">{t("common.dash")}</span>
                    )}
                  </Td>
                  <Td align="right">
                    <Km value={r.currentKm} />
                  </Td>
                  <Td>
                    <KmDue kmDue={r.kmDue} />
                  </Td>
                  <Td className="max-w-[200px]">
                    <HolderCell holder={r.holder} />
                  </Td>
                  <Td>
                    <ChevronRight className="h-4 w-4 text-muted dark:text-muted-dark" aria-hidden />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>

          <ul className="flex flex-col gap-2 lg:hidden">
            {rows.map((r) => (
              <li key={r.bikeId}>
                <Link
                  to={`/fleet/vehicles/${r.bikeId}`}
                  className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <RowCard>
                    <StatusRail status={r.status} />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Plate plate={r.plate} />
                          <span className="truncate text-[14px] font-semibold">{r.nickname}</span>
                        </div>
                        <p className="mt-1 text-[13px] text-muted dark:text-muted-dark">
                          {r.nextDue ? (
                            <>
                              <DueKindLabel kind={r.nextDue.kind} label={r.nextDue.label} /> ·{" "}
                              <span className="num">{r.nextDue.dueOn}</span>
                            </>
                          ) : (
                            t("fleet.vehicles.noDeadline")
                          )}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <HolderCell holder={r.holder} />
                          <span className="text-[12px] text-muted dark:text-muted-dark">
                            <Km value={r.currentKm} />
                          </span>
                        </div>
                        <div className="mt-1">
                          <KmDue kmDue={r.kmDue} />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {r.nextDue && <DaysRemaining days={r.nextDue.daysRemaining} status={r.status} />}
                        <StatusBadge status={r.status} />
                        {r.documentsPendingOcr > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted dark:text-muted-dark">
                            <FileClock className="h-3 w-3" aria-hidden />
                            {r.documentsPendingOcr}
                          </span>
                        )}
                      </div>
                    </div>
                  </RowCard>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * "Add vehicle" — the only way, other than a CSV import, that a vehicle can end
 * up owned by an organization.
 *
 * OWNER/MANAGER ONLY. `POST /api/bikes` refuses an org vehicle from staff with
 * a 403 (apps/api/src/routes/bikes.ts) for the same reason `permits()` refuses
 * them a deletion: staff run the fleet day to day, but its size is a billing
 * decision. Mirrored here so the button is not offered to someone it would only
 * ever 403 for; the server remains the enforcement point.
 *
 * At the ceiling the action is closed off with the numbers and nothing else —
 * no price, no plan, no "contact sales" link. An organization's allowance is
 * agreed in its contract and raised by the operator, and the app carries no
 * fleet acquisition affordance at all (docs/fleet-design.md §1). This is the
 * same posture `/fleet/import` takes when a CSV would overflow the ceiling.
 */
function AddVehicleAction() {
  const { t } = useTranslation();
  const { org } = useFleetContext();
  const manages = canManageFleet(org.role);
  // Skipped entirely for staff — they get neither the button nor the request.
  const detail = useOrgDetail(manages ? org.orgId : undefined);

  if (!manages) return null;

  const full = !!detail.data && detail.data.activeVehicles >= detail.data.maxVehicles;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {full && (
        <p role="status" className="text-[13px] text-warning">
          {t("fleet.vehicles.limitReached", {
            current: detail.data!.activeVehicles,
            max: detail.data!.maxVehicles,
          })}
        </p>
      )}
      <AddVehicleButton orgId={org.orgId} variant="accent" size="sm" disabled={full}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("fleet.vehicles.add")}
      </AddVehicleButton>
    </div>
  );
}

/**
 * A km-based service interval. It has no due DATE, so it cannot appear on the
 * date-sorted board — but "due in 800 km" is how a courier fleet actually
 * schedules an oil change, so the inventory row is where it surfaces.
 */
function KmDue({ kmDue }: { kmDue: FleetInventoryRow["kmDue"] }) {
  const { t, i18n } = useTranslation();
  if (!kmDue) return <span className="text-muted dark:text-muted-dark">{t("common.dash")}</span>;
  const overdue = kmDue.kmRemaining < 0;
  const n = new Intl.NumberFormat(i18n.language === "tr" ? "tr-TR" : "en-US").format(
    Math.abs(kmDue.kmRemaining),
  );
  return (
    <span className={`text-[12px] ${overdue ? "text-danger" : "text-muted dark:text-muted-dark"}`}>
      {t(`maintenance.kinds.${kmDue.label}`, { defaultValue: kmDue.label })}{" "}
      <span className="num font-medium">
        {overdue ? t("fleet.kmOverdue", { km: n }) : t("fleet.kmLeft", { km: n })}
      </span>
    </span>
  );
}
