import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, ChevronRight, PhoneCall } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FleetTriageRow } from "@mototracker/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { useFleetContext } from "@/components/fleet/FleetLayout";
import { useFleetTriage } from "@/hooks/useFleetData";
import {
  DaysRemaining,
  DueKindLabel,
  HolderCell,
  Plate,
  SectionHeading,
  Stat,
  StatusBadge,
  StatusRail,
} from "@/components/fleet/bits";
import { RowCard, TableShell, Td, Th, Tr } from "@/components/fleet/table";
import { cn } from "@/lib/cn";

/**
 * `/fleet` — the triage board (docs/fleet-design.md §7.1).
 *
 * EXCEPTION-FIRST, NOT INVENTORY-FIRST. A manager with 40 vehicles does not want
 * to see 40 vehicles; they want the three that need action today.
 *
 * ONE PRESENTATION DECISION IS MADE HERE, NOT IN THE API. `/triage` turns every
 * open rental contract's `ends_at` into a `contract_due` deadline, which is
 * honest data — a ten-day rental that started four days ago really does end in
 * six. But a rental company's whole fleet is out on ordinary contracts at any
 * moment, so putting those rows in "next 30 days" would bury the lapsed
 * insurance policy the board exists to surface under thirty cars that are simply
 * out on hire. So:
 *
 *   • an OVERDUE return stays with the overdue documents — a car that has not
 *     come back is the most urgent thing a rental operator has — but it is
 *     styled as its own kind of problem, because the action is "ring the
 *     customer", not "renew a policy";
 *   • an ON-TIME return is pulled out of the compliance horizon entirely and
 *     given a compact, visually subordinate "due back" list of its own;
 *   • the summary strip counts the two separately, because "6 overdue" meaning
 *     three unreturned cars is a completely different morning from "6 overdue"
 *     meaning six lapsed policies.
 *
 * In `fleet` mode no contracts exist, so every one of those lists is empty and
 * the section disappears rather than rendering an empty box.
 *
 * An empty board is a SUCCESS state, not an empty state: "Tüm araçlar güncel".
 */
export function FleetBoardPage() {
  const { t } = useTranslation();
  const { org } = useFleetContext();
  const [horizon, setHorizon] = useState(30);
  const q = useFleetTriage(org.orgId, horizon);

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-hidden>
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />;

  const { overdue, upcoming, summary } = q.data;

  const isReturn = (r: FleetTriageRow) => r.kind === "contract_due";
  const overdueReturns = overdue.filter(isReturn);
  const overdueDocs = overdue.filter((r) => !isReturn(r));
  const upcomingDocs = upcoming.filter((r) => !isReturn(r));
  const dueBack = upcoming.filter(isReturn);

  const clear = overdue.length === 0 && upcomingDocs.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {clear ? (
        <AllClear total={summary.totalVehicles} horizon={horizon} />
      ) : (
        <>
          {overdue.length > 0 && (
            <section aria-labelledby="fleet-overdue">
              <SectionHeading
                id="fleet-overdue"
                title={t("fleet.board.overdue")}
                count={overdue.length}
                tone="danger"
              />
              {overdueReturns.length > 0 && (
                <p className="mb-2 text-[12px] text-danger">
                  {t("fleet.board.overdueBreakdown", {
                    docs: overdueDocs.length,
                    returns: overdueReturns.length,
                  })}
                </p>
              )}
              <TriageList rows={overdue} />
            </section>
          )}

          {upcomingDocs.length > 0 && (
            <section aria-labelledby="fleet-upcoming">
              <SectionHeading
                id="fleet-upcoming"
                title={t("fleet.board.upcoming", { days: horizon })}
                count={upcomingDocs.length}
              >
                <HorizonPicker value={horizon} onChange={setHorizon} />
              </SectionHeading>
              <TriageList rows={upcomingDocs} />
            </section>
          )}
        </>
      )}

      {/* Subordinate by design: routine returns are business as usual, not
          exceptions, so they sit below the compliance sections in a quieter
          treatment and never compete with them for attention. */}
      {dueBack.length > 0 && <DueBackSection rows={dueBack} horizon={horizon} />}

      <section aria-label={t("fleet.board.summary")}>
        <SectionHeading title={t("fleet.board.summary")}>
          {clear && <HorizonPicker value={horizon} onChange={setHorizon} />}
        </SectionHeading>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t("fleet.summary.total")} value={summary.totalVehicles} />
          <Stat label={t(`fleet.summary.inUse.${org.mode}`)} value={summary.inUse} />
          <Stat label={t("fleet.summary.idle")} value={summary.idle} />
          <div
            className={cn(
              "rounded-xl",
              // The one place the glow treatment is allowed on this screen: a
              // genuinely overdue fleet. Everywhere else it would stop meaning
              // anything (§6).
              overdueDocs.length > 0 && "animate-danger-glow",
            )}
          >
            <Stat
              label={t("fleet.summary.overdueDocs")}
              value={overdueDocs.length}
              tone={overdueDocs.length > 0 ? "danger" : "default"}
            />
          </div>
          {org.mode === "rental" ? (
            <div className={cn("rounded-xl", overdueReturns.length > 0 && "animate-danger-glow")}>
              <Stat
                label={t("fleet.summary.overdueReturns")}
                value={overdueReturns.length}
                tone={overdueReturns.length > 0 ? "danger" : "default"}
              />
            </div>
          ) : (
            <Stat
              label={t("fleet.summary.dueSoon")}
              value={upcomingDocs.length}
              tone={upcomingDocs.length > 0 ? "warning" : "default"}
            />
          )}
          {org.mode === "rental" ? (
            <Stat
              label={t("fleet.summary.dueSoon")}
              value={upcomingDocs.length}
              tone={upcomingDocs.length > 0 ? "warning" : "default"}
            />
          ) : (
            <Stat label={t("fleet.summary.pendingOcr")} value={summary.documentsPendingOcr} />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted dark:text-muted-dark">
          {org.mode === "rental" && (
            <span>{t("fleet.summary.dueBackNote", { count: dueBack.length, days: horizon })}</span>
          )}
          {org.mode === "rental" && (
            <span>{t("fleet.summary.pendingOcrNote", { count: summary.documentsPendingOcr })}</span>
          )}
          {summary.archived > 0 && (
            <span>{t("fleet.summary.archivedNote", { count: summary.archived })}</span>
          )}
        </div>
      </section>
    </div>
  );
}

function HorizonPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{t("fleet.board.horizon")}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-[12px] dark:border-border-dark dark:bg-surface-elev-dark"
      >
        {[7, 30, 60, 90].map((d) => (
          <option key={d} value={d}>
            {t("fleet.board.horizonDays", { count: d })}
          </option>
        ))}
      </select>
    </label>
  );
}

function AllClear({ total, horizon }: { total: number; horizon: number }) {
  const { t } = useTranslation();
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-4 rounded-2xl border border-success/30 bg-success/5 p-5"
    >
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-success/10 text-success ring-1 ring-success/25">
        <CheckCircle2 className="h-6 w-6" strokeWidth={1.8} aria-hidden />
      </div>
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold tracking-tight">{t("fleet.board.allCurrent")}</h2>
        <p className="mt-0.5 text-pretty text-[13px] text-muted dark:text-muted-dark">
          {t("fleet.board.allCurrentSub", { count: total, days: horizon })}
        </p>
      </div>
    </motion.section>
  );
}

// ─── due back (rental mode, on time) ──────────────────────────────────────────

/**
 * Routine returns. Compact on purpose: one line per vehicle, customer name
 * first because that is who gets rung, and no status chips — an on-time rental
 * has no status worth colouring.
 */
function DueBackSection({ rows, horizon }: { rows: FleetTriageRow[]; horizon: number }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="fleet-dueback">
      <SectionHeading id="fleet-dueback" title={t("fleet.board.dueBack", { days: horizon })} count={rows.length} />
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={`${r.bikeId}-${r.recordId ?? r.dueOn}`}>
            <Link
              to={`/fleet/vehicles/${r.bikeId}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface/50 px-3 py-2 transition hover:bg-surface dark:border-border-dark/70 dark:bg-surface-dark/40 dark:hover:bg-surface-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Plate plate={r.plate} className="text-[12px]" />
                <span className="truncate text-[13px]">{r.nickname}</span>
                <span className="truncate text-[13px] text-muted dark:text-muted-dark">
                  · {r.holder?.name ?? t("fleet.holder.idle")}
                </span>
              </span>
              <span className="num shrink-0 text-[12px] text-muted dark:text-muted-dark">
                {r.dueOn} · {t("fleet.daysLeft", { count: r.daysRemaining })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── exception rows ───────────────────────────────────────────────────────────

function TriageList({ rows }: { rows: FleetTriageRow[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <>
      <TableShell label={t("fleet.board.title")}>
        <thead>
          <tr>
            <Th>{t("fleet.cols.plate")}</Th>
            <Th>{t("fleet.cols.vehicle")}</Th>
            <Th>{t("fleet.cols.due")}</Th>
            <Th>{t("fleet.cols.dueOn")}</Th>
            <Th align="right">{t("fleet.cols.days")}</Th>
            <Th>{t("fleet.cols.status")}</Th>
            <Th>{t("fleet.cols.holder")}</Th>
            <Th className="w-8">
              <span className="sr-only">{t("fleet.cols.open")}</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const late = r.kind === "contract_due";
            return (
              <Tr
                key={`${r.bikeId}-${r.kind}-${r.recordId ?? r.dueOn}`}
                onClick={() => navigate(`/fleet/vehicles/${r.bikeId}`)}
                className={late ? "bg-danger/[0.04]" : undefined}
              >
                <Td>
                  <Plate plate={r.plate} />
                </Td>
                <Td>
                  <span className="font-medium">{r.nickname}</span>
                  <span className="ml-2 text-muted dark:text-muted-dark">
                    {[r.make, r.model].filter(Boolean).join(" ")}
                  </span>
                </Td>
                <Td>
                  <span className={cn("inline-flex items-center gap-1.5", late && "font-medium text-danger")}>
                    {late && <PhoneCall className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                    <DueKindLabel kind={r.kind} label={r.label} />
                  </span>
                </Td>
                <Td>
                  <span className="num text-muted dark:text-muted-dark">{r.dueOn}</span>
                </Td>
                <Td align="right">
                  <DaysRemaining days={r.daysRemaining} status={r.status} />
                </Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td className="max-w-[220px]">
                  {/* On a late return the customer's name IS the action, so it is
                      promoted out of the muted holder treatment. */}
                  <span className={late ? "font-medium" : undefined}>
                    <HolderCell holder={r.holder} />
                  </span>
                </Td>
                <Td>
                  <ChevronRight className="h-4 w-4 text-muted dark:text-muted-dark" aria-hidden />
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableShell>

      <ul className="flex flex-col gap-2 lg:hidden">
        {rows.map((r) => {
          const late = r.kind === "contract_due";
          return (
            <li key={`${r.bikeId}-${r.kind}-${r.recordId ?? r.dueOn}`}>
              <Link
                to={`/fleet/vehicles/${r.bikeId}`}
                className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <RowCard className={late ? "border-danger/40" : undefined}>
                  <StatusRail status={r.status} />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Plate plate={r.plate} />
                        <span className="truncate text-[14px] font-semibold">{r.nickname}</span>
                      </div>
                      <p
                        className={cn(
                          "mt-1 flex items-center gap-1.5 text-[13px]",
                          late ? "font-medium text-danger" : "text-muted dark:text-muted-dark",
                        )}
                      >
                        {late && <PhoneCall className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                        <DueKindLabel kind={r.kind} label={r.label} /> ·{" "}
                        <span className="num">{r.dueOn}</span>
                      </p>
                      <div className={cn("mt-2", late && "font-medium")}>
                        <HolderCell holder={r.holder} />
                      </div>
                      {late && (
                        <p className="mt-1 text-[12px] text-danger">{t("fleet.board.callCustomer")}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <DaysRemaining days={r.daysRemaining} status={r.status} />
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                </RowCard>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
