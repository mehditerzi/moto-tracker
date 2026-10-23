import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ChevronRight, Crown, Download, Fuel, Plus, Receipt, Trash2, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { MoneyInput, NumberInput } from "@/components/ui/number-input";
import { Field, FormRow } from "@/components/ui/field";
import { Sheet } from "@/components/share/ShareSheet";
import { VehicleBar } from "@/components/VehicleBar";
import { ErrorState } from "@/components/ErrorState";
import { AddVehicleButton } from "@/components/AddVehicleButton";
import { useConfirm } from "@/components/ConfirmSheet";
import { CountUp } from "@/components/motion/CountUp";
import { StaggerItem } from "@/components/motion/Stagger";
import { usePaywall } from "@/components/paywall/PaywallContext";
import { useSelectedBike } from "@/hooks/useSelectedBike";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useCostSummary, useCreateExpense, useDeleteExpense, useExpenses, useUpdateExpense } from "@/hooks/useAssistant";
import { EXPENSE_ICON, QUICK_CATEGORIES, SOURCE_COLOR } from "@/lib/expenseCategories";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { hapticSelection, hapticTap } from "@/lib/haptics";
import { friendlyError } from "@/lib/apiError";
import { pushToast } from "@/hooks/useToast";
import { track } from "@/lib/telemetry";
import { env } from "@/env";
import { cn } from "@/lib/cn";
import type { CostSummary, Expense, ExpenseCategory } from "@mototracker/shared";

const SOURCES = ["fuel", "maintenance", "document", "expense"] as const;

/**
 * What the vehicle actually costs: fuel, maintenance, policies and every other
 * receipt, added up — and the one number owners always want, ₺ per km.
 */
export function CostsPage() {
  const { t } = useTranslation();
  const { bikes, bikeId, bike, select } = useSelectedBike();
  const summary = useCostSummary(bikeId);
  const expenses = useExpenses(bikeId);
  const [sheet, setSheet] = useState<{ category: ExpenseCategory; editing?: Expense } | null>(null);

  if (bikes.isError) return <ErrorState onRetry={() => void bikes.refetch()} />;
  if (!bikes.isLoading && (bikes.data?.length ?? 0) === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center">
        <div className="grid h-20 w-20 place-items-center rounded-3xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
          <Wallet className="h-9 w-9 text-muted dark:text-muted-dark" strokeWidth={1.5} />
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">{t("costs.noVehicle")}</h1>
        <AddVehicleButton variant="accent" size="lg">
          <Plus className="h-4 w-4" /> {t("dashboard.addBike")}
        </AddVehicleButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-micro text-muted dark:text-muted-dark">{t("nav.costs")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{t("costs.title")}</h1>
      </header>

      {bike && <VehicleBar bike={bike} bikes={bikes.data ?? []} onChange={select} />}

      {summary.isLoading || !summary.data ? (
        summary.isError ? (
          <ErrorState onRetry={() => void summary.refetch()} />
        ) : (
          <Skeleton className="h-52 rounded-2xl" />
        )
      ) : (
        <SummaryHero summary={summary.data} />
      )}

      <QuickAdd onPick={(category) => setSheet({ category })} />

      <Link
        to="/fuel"
        className="group flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border transition active:scale-[0.99] dark:bg-surface-elev-dark dark:ring-border-dark"
      >
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent-dim dark:text-accent">
          <Fuel className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold">{t("costs.fuelLink")}</div>
          <div className="text-[12.5px] text-muted dark:text-muted-dark">{t("costs.fuelLinkSub")}</div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted transition group-hover:translate-x-0.5 dark:text-muted-dark" />
      </Link>

      {summary.data && summary.data.total > 0 && <MonthlyBars months={summary.data.months} />}
      {summary.data && Object.keys(summary.data.byCategory).length > 0 && (
        <CategoryBreakdown byCategory={summary.data.byCategory} />
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="label-micro text-muted dark:text-muted-dark">{t("costs.history")}</h2>
          {bikeId && <ExportButton bikeId={bikeId} />}
        </div>
        {expenses.isLoading ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : (expenses.data?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-border py-8 text-center dark:border-border-dark">
            <Receipt className="h-6 w-6 text-muted dark:text-muted-dark" />
            <p className="mt-1 text-[14px] font-medium">{t("costs.empty")}</p>
            <p className="max-w-[34ch] text-[13px] text-muted dark:text-muted-dark">{t("costs.emptySub")}</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {expenses.data!.map((e, i) => (
              <StaggerItem key={e.id} index={i}>
                <ExpenseRow expense={e} onEdit={() => setSheet({ category: e.category, editing: e })} />
              </StaggerItem>
            ))}
          </AnimatePresence>
        )}
      </section>

      {bikeId && (
        <ExpenseSheet
          open={!!sheet}
          bikeId={bikeId}
          currentKm={bike?.currentKm ?? null}
          category={sheet?.category ?? "other"}
          editing={sheet?.editing}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

// ─── summary ──────────────────────────────────────────────────────────────────

function SummaryHero({ summary }: { summary: CostSummary }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const thisMonth = summary.months.at(-1)?.total ?? 0;
  const total = summary.total;
  return (
    <Card className="overflow-hidden">
      <CardContent className="gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12.5px] text-muted dark:text-muted-dark">{t("costs.last12")}</div>
            <CountUp
              value={total}
              format={(n) => formatMoney(n)}
              className="num mt-1 block text-[36px] font-semibold leading-none tracking-tight"
            />
          </div>
          <div className="text-right">
            <div className="text-[12.5px] text-muted dark:text-muted-dark">{t("costs.perKm")}</div>
            <div className="num mt-1 text-[22px] font-semibold leading-none">
              {summary.costPerKm != null ? formatMoney(summary.costPerKm, 2) : "—"}
            </div>
          </div>
        </div>

        {total > 0 ? (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface dark:bg-surface-elev-dark" aria-hidden>
              {SOURCES.map((s, i) => {
                const share = summary.bySource[s] / total;
                if (share <= 0) return null;
                return (
                  <motion.div
                    key={s}
                    className={cn("h-full", SOURCE_COLOR[s], i > 0 && "border-l-2 border-bg dark:border-bg-dark")}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${share * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.1 + i * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
                  />
                );
              })}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              {SOURCES.map((s) => (
                <div key={s} className="flex items-center justify-between gap-2 text-[13px]">
                  <dt className="flex min-w-0 items-center gap-2 text-muted dark:text-muted-dark">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", SOURCE_COLOR[s])} />
                    <span className="truncate">{t(`costs.source.${s}`)}</span>
                  </dt>
                  <dd className="num font-medium">{formatMoney(summary.bySource[s])}</dd>
                </div>
              ))}
            </dl>
            <div className="flex items-center justify-between border-t border-border pt-3 text-[13px] dark:border-border-dark">
              <span className="text-muted dark:text-muted-dark">{t("costs.thisMonth")}</span>
              <span className="num font-semibold">{formatMoney(thisMonth)}</span>
            </div>
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted dark:text-muted-dark">{t("costs.noData")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MonthlyBars({ months }: { months: CostSummary["months"] }) {
  const { t, i18n } = useTranslation();
  const reduce = useReducedMotion();
  const last = months.slice(-6);
  const max = Math.max(...last.map((m) => m.total), 1);
  const label = (ym: string) =>
    new Intl.DateTimeFormat(i18n.language.startsWith("en") ? "en-GB" : "tr-TR", { month: "short" }).format(
      new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1),
    );
  return (
    <Card>
      <CardContent className="gap-3">
        <div className="text-[13px] font-medium">{t("costs.byMonth")}</div>
        <div className="flex h-36 items-end gap-2" role="list">
          {last.map((m, i) => (
            <div key={m.month} role="listitem" className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className="num text-[10px] text-muted dark:text-muted-dark">
                {m.total > 0 ? formatMoney(m.total) : ""}
              </span>
              <div className="flex w-full max-w-[34px] flex-1 flex-col justify-end overflow-hidden rounded-lg border-b-2 border-border dark:border-border-dark">
                <motion.div
                  className="flex w-full flex-col-reverse"
                  initial={reduce ? false : { height: 0 }}
                  animate={{ height: `${(m.total / max) * 100}%` }}
                  transition={{ duration: 0.55, delay: i * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  {SOURCES.map((s) =>
                    m[s] > 0 ? (
                      <div key={s} className={SOURCE_COLOR[s]} style={{ height: `${(m[s] / (m.total || 1)) * 100}%` }} />
                    ) : null,
                  )}
                </motion.div>
              </div>
              <span className="text-[11px] capitalize text-muted dark:text-muted-dark">{label(m.month)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryBreakdown({ byCategory }: { byCategory: Record<string, number> }) {
  const { t } = useTranslation();
  const rows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;
  return (
    <Card>
      <CardContent className="gap-3">
        <div className="text-[13px] font-medium">{t("costs.byCategory")}</div>
        {rows.map(([cat, amount]) => {
          const Icon = EXPENSE_ICON[cat as ExpenseCategory] ?? Receipt;
          return (
            <div key={cat} className="flex items-center gap-3">
              <Icon className="h-4 w-4 shrink-0 text-muted dark:text-muted-dark" />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between text-[13px]">
                  <span>{t(`costs.category.${cat}`)}</span>
                  <span className="num font-medium">{formatMoney(amount)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface dark:bg-surface-elev-dark">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${(amount / max) * 100}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── quick add ────────────────────────────────────────────────────────────────

function QuickAdd({ onPick }: { onPick: (c: ExpenseCategory) => void }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="label-micro text-muted dark:text-muted-dark">{t("costs.add")}</h2>
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {QUICK_CATEGORIES.map((c) => {
          const Icon = EXPENSE_ICON[c];
          return (
            <motion.button
              key={c}
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                hapticTap();
                onPick(c);
              }}
              className="flex w-[76px] shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl bg-surface px-2 py-3 ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark"
            >
              <Icon className="h-5 w-5" />
              <span className="w-full truncate text-center text-[11.5px] font-medium">{t(`costs.category.${c}`)}</span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

// ─── list ─────────────────────────────────────────────────────────────────────

function ExpenseRow({ expense, onEdit }: { expense: Expense; onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const del = useDeleteExpense();
  const Icon = EXPENSE_ICON[expense.category];
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-500">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">
            {expense.vendor || t(`costs.category.${expense.category}`)}
          </div>
          <div className="num text-[12px] text-muted dark:text-muted-dark">
            {formatDate(expense.spentOn, i18n.language)}
            {expense.vendor ? ` · ${t(`costs.category.${expense.category}`)}` : ""}
          </div>
        </div>
        <span className="num shrink-0 text-[15px] font-semibold">{formatMoney(expense.amount, expense.amount % 1 ? 2 : 0)}</span>
      </button>
      <button
        type="button"
        aria-label={t("common.delete")}
        disabled={del.isPending}
        onClick={async () => {
          const ok = await confirm({ title: t("costs.deleteConfirm"), confirmLabel: t("common.delete"), destructive: true });
          if (ok) del.mutate(expense.id);
        }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition hover:text-danger dark:text-muted-dark"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function ExportButton({ bikeId }: { bikeId: string }) {
  const { t } = useTranslation();
  const ent = useEntitlement();
  const { openPaywall } = usePaywall();
  const [busy, setBusy] = useState(false);
  const locked = ent.data?.scanLimit != null && !ent.data?.pro;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (locked) {
          openPaywall("export");
          return;
        }
        setBusy(true);
        try {
          // A raw fetch (api() parses JSON), so it attaches the native bearer
          // itself; the CSV goes to the share sheet (or a download on the web).
          const res = await fetch(`${env.VITE_API_URL}/api/expenses/export.csv?bikeId=${encodeURIComponent(bikeId)}`, {
            credentials: "include",
            headers: await authHeader(),
          });
          if (res.status === 402) {
            openPaywall("export");
            return;
          }
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "garajim.csv";
          await shareOrDownload(new File([blob], decodeURIComponent(name), { type: "text/csv" }));
          track("costs_exported", {});
        } catch (e) {
          pushToast({ variant: "danger", title: friendlyError(e, t) });
        } finally {
          setBusy(false);
        }
      }}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] font-medium text-muted transition hover:bg-surface hover:text-text disabled:opacity-50 dark:text-muted-dark dark:hover:bg-surface-elev-dark"
    >
      {locked ? <Crown className="h-3.5 w-3.5 text-accent-dim" /> : <Download className="h-3.5 w-3.5" />}
      {t("costs.export")}
    </button>
  );
}

async function authHeader(): Promise<Record<string, string>> {
  const { isNative, getBearerToken } = await import("@/lib/nativeAuth");
  const bearer = isNative() ? getBearerToken() : null;
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}

/** The share sheet where the platform has one (iOS: Save to Files, Mail…). */
async function shareOrDownload(file: File): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── add / edit sheet ─────────────────────────────────────────────────────────

function ExpenseSheet({
  open,
  bikeId,
  currentKm,
  category: initialCategory,
  editing,
  onClose,
}: {
  open: boolean;
  bikeId: string;
  currentKm: number | null;
  category: ExpenseCategory;
  editing?: Expense;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const key = `${editing?.id ?? "new"}:${initialCategory}:${open}`;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? t("costs.editTitle") : t("costs.addTitle")}
      description={t("costs.sheetSub")}
    >
      {open && (
        <ExpenseForm
          key={key}
          initial={editing}
          initialCategory={initialCategory}
          currentKm={currentKm}
          pending={create.isPending || update.isPending}
          onSubmit={async (values) => {
            try {
              if (editing) await update.mutateAsync({ id: editing.id, ...values });
              else await create.mutateAsync({ bikeId, ...values });
              track(editing ? "expense_updated" : "expense_added", { category: values.category });
              pushToast({ variant: "success", title: t("costs.saved") });
              onClose();
            } catch (e) {
              pushToast({ variant: "danger", title: friendlyError(e, t) });
            }
          }}
        />
      )}
    </Sheet>
  );
}

interface ExpenseValues {
  category: ExpenseCategory;
  amount: number;
  spentOn: string;
  odometerKm: number | null;
  vendor: string | null;
  notes: string | null;
}

function ExpenseForm({
  initial,
  initialCategory,
  currentKm,
  pending,
  onSubmit,
}: {
  initial?: Expense;
  initialCategory: ExpenseCategory;
  currentKm: number | null;
  pending: boolean;
  onSubmit: (v: ExpenseValues) => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? initialCategory);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [spentOn, setSpentOn] = useState(initial?.spentOn ?? todayISO());
  const [km, setKm] = useState(initial?.odometerKm != null ? String(initial.odometerKm) : "");
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const amountNum = Number(amount.replace(",", "."));
  const valid = amount.trim() !== "" && Number.isFinite(amountNum) && amountNum >= 0 && !!spentOn;
  const categories = useMemo(() => QUICK_CATEGORIES.concat(["insurance"]), []);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || pending) return;
        onSubmit({
          category,
          amount: amountNum,
          spentOn,
          odometerKm: km.trim() ? Number(km) : null,
          vendor: vendor.trim() || null,
          notes: initial?.notes ?? null,
        });
      }}
    >
      <div role="radiogroup" aria-label={t("costs.categoryLabel")} className="flex flex-wrap gap-1.5">
        {categories.map((c) => {
          const Icon = EXPENSE_ICON[c];
          const on = c === category;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                if (!on) hapticSelection();
                setCategory(c);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 transition",
                on
                  ? "bg-accent text-black ring-accent"
                  : "bg-surface ring-border dark:bg-surface-elev-dark dark:ring-border-dark",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`costs.category.${c}`)}
            </button>
          );
        })}
      </div>
      <FormRow>
        <Field label={t("costs.amount")}>
          <MoneyInput
            inputMode="decimal"
            autoFocus={!initial}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label={t("fuel.date")}>
          <DateInput value={spentOn} max={todayISO()} onChange={(e) => setSpentOn(e.target.value)} />
        </Field>
      </FormRow>
      <FormRow>
        <Field label={t("costs.vendor")} optional>
          <Input value={vendor} maxLength={120} onChange={(e) => setVendor(e.target.value)} placeholder={t("costs.vendorPh")} />
        </Field>
        <Field label={t("fuel.odometer")} optional>
          <NumberInput
            value={km}
            onChange={(e) => setKm(e.target.value)}
            suffix="km"
            placeholder={currentKm != null ? String(currentKm) : ""}
          />
        </Field>
      </FormRow>
      <Button type="submit" size="lg" variant="accent" disabled={!valid || pending} className="w-full">
        {pending ? t("common.saving") : t("common.save")}
      </Button>
    </form>
  );
}

