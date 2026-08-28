import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileText, Pencil } from "lucide-react";
import type { DatedItem, DatedItemType, OrgBusinessMode } from "@mototracker/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { StatusChip } from "@/components/StatusChip";
import { MaintenancePanel } from "@/components/MaintenancePanel";
import { TYPE_ORDER } from "@/lib/datedItems";
import { useBike } from "@/hooks/useBikes";
import { useDatedItemsForBike } from "@/hooks/useDatedItems";
import { useDocumentsForBike } from "@/hooks/useDocuments";
import { useFleetContext } from "@/components/fleet/FleetLayout";
import { HolderPanel } from "@/components/fleet/HolderPanel";
import { useFleetVehicleHistory } from "@/hooks/useFleetData";
import { Km, Plate, SectionHeading } from "@/components/fleet/bits";
import { env } from "@/env";

/**
 * `/fleet/vehicles/:id` (docs/fleet-design.md §7.3).
 *
 * Deliberately NOT a new vehicle screen. Compliance, maintenance and documents
 * are the consumer dashboard's own components pointed at an org vehicle — they
 * already read and write through endpoints that authorise org membership, and a
 * second implementation would be a second set of bugs. What fleet adds is the
 * part with no consumer equivalent: who holds the vehicle, and who held it
 * before.
 */
export function FleetVehicleDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { org } = useFleetContext();
  const bike = useBike(id);
  const items = useDatedItemsForBike(id);
  const history = useFleetVehicleHistory(org.orgId, id);
  const docs = useDocumentsForBike(id);

  if (bike.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-hidden>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  }
  if (bike.isError || !bike.data) {
    return (
      <ErrorState onRetry={() => void bike.refetch()} title={t("fleet.detail.notFound")}>
        <Button asChild variant="ghost">
          <Link to="/fleet/vehicles">{t("fleet.detail.backToInventory")}</Link>
        </Button>
      </ErrorState>
    );
  }

  const b = bike.data;
  const latest = latestByType(items.data ?? []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted dark:text-muted-dark">
          <Link to="/fleet/vehicles">
            <ArrowLeft className="h-3.5 w-3.5" /> {t("fleet.detail.backToInventory")}
          </Link>
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Plate plate={b.plate} className="text-[15px]" />
            {b.archived && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted dark:border-border-dark dark:text-muted-dark">
                {t("fleet.vehicles.archived")}
              </span>
            )}
          </div>
          <h1 className="mt-1 truncate text-[28px] font-semibold leading-none tracking-tight">
            {b.nickname}
          </h1>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-[14px] text-muted dark:text-muted-dark">
            <span>{[b.make, b.model, b.year].filter(Boolean).join(" · ") || t("common.dash")}</span>
            <span>
              <Km value={b.currentKm} />
            </span>
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={`/bikes/${b.id}/edit`}>
            <Pencil className="h-3.5 w-3.5" /> {t("dashboard.edit")}
          </Link>
        </Button>
      </header>

      <HolderPanel
        orgId={org.orgId}
        mode={org.mode}
        role={org.role}
        bikeId={b.id}
        currentKm={b.currentKm}
      />

      <section aria-label={t("fleet.detail.compliance")}>
        <SectionHeading title={t("fleet.detail.compliance")} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TYPE_ORDER.map((type, i) => (
            <StatusChip key={type} type={type} bikeId={b.id} item={latest[type] ?? null} index={i} />
          ))}
        </div>
      </section>

      <MaintenancePanel bikeId={b.id} />

      <section aria-label={t("fleet.detail.documents")}>
        <SectionHeading title={t("fleet.detail.documents")} count={docs.data?.length} />
        {docs.isPending ? (
          <Skeleton className="h-20 rounded-2xl" />
        ) : (docs.data ?? []).length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-5 text-center text-[13px] text-muted dark:border-border-dark dark:text-muted-dark">
            {t("fleet.detail.noDocuments")}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {(docs.data ?? []).map((d) => (
              <li key={d.id}>
                <Link
                  to={`/documents/${d.id}/review`}
                  className="group block overflow-hidden rounded-xl border border-border bg-surface transition hover:border-text/20 dark:border-border-dark dark:bg-surface-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <div className="grid h-20 place-items-center bg-bg/60 dark:bg-bg-dark/60">
                    {d.mimeType.startsWith("image/") ? (
                      <img
                        src={`${env.VITE_API_URL}/api/documents/${d.id}/file`}
                        alt=""
                        className="h-20 w-full object-cover"
                      />
                    ) : (
                      <FileText className="h-6 w-6 text-muted dark:text-muted-dark" aria-hidden />
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-[12px] font-medium">
                      {d.docType ? t(`fleet.detail.docTypes.${d.docType}`) : t("fleet.detail.document")}
                    </p>
                    <p className="num text-[10px] text-muted dark:text-muted-dark">
                      {d.createdAt.slice(0, 10)}
                      {d.ocrStatus === "pending" && ` · ${t("fleet.detail.ocrPending")}`}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("fleet.detail.history")}>
        <SectionHeading title={t("fleet.detail.history")} />
        {history.isPending ? (
          <Skeleton className="h-20 rounded-2xl" />
        ) : history.isError || !history.data ? (
          <p className="text-[13px] text-danger">{t("dashboard.loadFailed")}</p>
        ) : (
          <HistoryList history={history.data} mode={org.mode} />
        )}
      </section>
    </div>
  );
}

function HistoryList({
  history,
  mode,
}: {
  history: NonNullable<ReturnType<typeof useFleetVehicleHistory>["data"]>;
  /**
   * The two BUSINESS modes only. `OrgMode` gained a third value ('personal',
   * the consumer garage group) and this component renders assignment/contract
   * vocabulary that a household has none of. Keeping the prop narrow means the
   * compiler — not a comment — enforces that a personal group can never reach a
   * fleet screen; `useFleetAccess` filters it out well before this point.
   */
  mode: OrgBusinessMode;
}) {
  const { t } = useTranslation();
  // One list, both modes: whichever relationship the org actually uses is the
  // one with rows. A rental org that also lent a van to staff sees both.
  const rows = [
    ...history.assignments.map((a) => ({
      id: a.id,
      who: a.userName ?? a.userEmail ?? a.userId,
      kind: t("fleet.detail.assignment"),
      from: a.startedAt.slice(0, 10),
      to: a.endedAt?.slice(0, 10) ?? null,
      startKm: a.startKm,
      endKm: a.endKm,
      status: a.endedAt ? "closed" : "open",
    })),
    ...history.contracts.map((c) => ({
      id: c.id,
      who: c.customerName ?? c.customerId,
      kind: t("fleet.detail.contract"),
      from: c.startedAt.slice(0, 10),
      to: (c.returnedAt ?? c.endsAt)?.slice(0, 10) ?? null,
      startKm: c.handoverKm,
      endKm: c.returnKm,
      status: c.status,
    })),
  ].sort((a, b) => b.from.localeCompare(a.from));

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-5 text-center text-[13px] text-muted dark:border-border-dark dark:text-muted-dark">
        {t(`fleet.detail.noHistory.${mode}`)}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2 text-[13px] dark:border-border-dark dark:bg-surface-dark/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{r.who}</span>
            <span className="text-[11px] text-muted dark:text-muted-dark">{r.kind}</span>
            {r.status === "open" && (
              <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                {t("fleet.detail.openNow")}
              </span>
            )}
          </span>
          <span className="num text-[12px] text-muted dark:text-muted-dark">
            {r.from} → {r.to ?? t("fleet.detail.ongoing")}
            {r.startKm != null && r.endKm != null && ` · ${(r.endKm - r.startKm).toLocaleString()} km`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Latest `dated_item` per type — the same "newest expiry wins" rule the
 *  consumer dashboard uses, so both screens agree about a vehicle. */
function latestByType(items: DatedItem[]): Partial<Record<DatedItemType, DatedItem>> {
  const out: Partial<Record<DatedItemType, DatedItem>> = {};
  for (const item of items) {
    const cur = out[item.type];
    if (!cur || (item.expiresOn ?? "") > (cur.expiresOn ?? "")) out[item.type] = item;
  }
  return out;
}
