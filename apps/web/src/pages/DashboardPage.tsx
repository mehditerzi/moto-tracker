import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Bike as BikeIcon, Settings2, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDashboard } from "@/hooks/useDashboard";
import { useUpdateBike } from "@/hooks/useBikes";
import { StatusChip } from "@/components/StatusChip";
import { BikeSwitcher } from "@/components/BikeSwitcher";
import { TYPE_ORDER } from "@/lib/datedItems";
import { statusFor } from "@/lib/datedItems";
import { CaptureFab } from "@/components/CaptureFab";
import { MaintenancePanel } from "@/components/MaintenancePanel";
import { pushToast } from "@/hooks/useToast";
import type { DashboardEntry } from "@mototracker/shared";

export function DashboardPage() {
  const { t } = useTranslation();
  const dash = useDashboard();
  const [activeBikeId, setActiveBikeId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (dash.data && dash.data.length > 0 && !activeBikeId) {
      setActiveBikeId(dash.data[0]!.bike.id);
    }
  }, [dash.data, activeBikeId]);

  if (dash.isLoading)
    return <p className="text-center text-muted dark:text-muted-dark">{t("dashboard.loading")}</p>;
  if (dash.isError || !dash.data)
    return <p className="text-center text-danger">{t("dashboard.loadFailed")}</p>;

  if (dash.data.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center"
      >
        <div className="relative grid h-24 w-24 place-items-center rounded-3xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
          <span aria-hidden className="absolute inset-0 rounded-3xl bg-accent/5" />
          <BikeIcon className="relative h-11 w-11 text-muted dark:text-muted-dark" strokeWidth={1.6} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-tight">
            {t("dashboard.empty")}
          </h1>
          <p className="text-pretty text-[15px] text-muted dark:text-muted-dark">
            {t("dashboard.emptySub")}
          </p>
        </div>
        <Button asChild variant="accent" size="lg">
          <Link to="/bikes/new"><Plus className="h-4 w-4" /> {t("dashboard.addBike")}</Link>
        </Button>
        <CaptureFab />
      </motion.div>
    );
  }

  const active = (dash.data.find((e) => e.bike.id === activeBikeId) ?? dash.data[0])!;

  return (
    <div className="flex flex-col gap-5">
      <UpcomingAlertsCard entries={dash.data} />

      <BikeSwitcher entries={dash.data} activeBikeId={active.bike.id} onSelect={setActiveBikeId} />

      <AnimatePresence mode="wait">
        <motion.div
          key={active.bike.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
          className="flex flex-col gap-5"
        >
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="label-micro text-muted dark:text-muted-dark">{t("dashboard.active")}</div>
              <h1 className="mt-1.5 truncate text-[32px] font-semibold leading-none tracking-tight">
                {active.bike.nickname}
              </h1>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-muted dark:text-muted-dark">
                <span className="truncate">
                  {[active.bike.make, active.bike.model, active.bike.year].filter(Boolean).join(" · ") || "—"}
                </span>
                {active.bike.plate && (
                  <span className="num text-xs uppercase tracking-wider">{active.bike.plate}</span>
                )}
              </div>
              <QuickKmUpdate bikeId={active.bike.id} currentKm={active.bike.currentKm} />
            </div>
            <Button asChild variant="outline" size="icon" aria-label={t("dashboard.edit")}>
              <Link to={`/bikes/${active.bike.id}/edit`}><Pencil className="h-4 w-4" /></Link>
            </Button>
          </header>

          <section className="grid gap-3 sm:grid-cols-3" aria-label={t("dashboard.active")}>
            {TYPE_ORDER.map((type, i) => (
              <StatusChip key={type} type={type} bikeId={active.bike.id} item={active.items[type]} index={i} />
            ))}
          </section>

          <MaintenancePanel bikeId={active.bike.id} />
        </motion.div>
      </AnimatePresence>

      <div className="mb-safe mt-4 flex items-center justify-center">
        <Button asChild size="sm" variant="ghost" className="text-muted dark:text-muted-dark">
          <Link to="/bikes"><Settings2 className="h-3.5 w-3.5" /> {t("dashboard.manageBikes")}</Link>
        </Button>
      </div>
      <CaptureFab bikeId={active.bike.id} />
    </div>
  );
}

// ─── upcoming alerts card ─────────────────────────────────────────────────────

interface UpcomingItem {
  bikeId: string;
  bikeName: string;
  type: "sigorta" | "kasko" | "muayene";
  itemId: string;
  daysRemaining: number;
  expiresOn: string;
}

function collectUpcoming(entries: DashboardEntry[]): UpcomingItem[] {
  const result: UpcomingItem[] = [];
  for (const entry of entries) {
    for (const type of TYPE_ORDER) {
      const item = entry.items[type];
      if (!item?.expiresOn) continue;
      const info = statusFor(item.expiresOn);
      if (info.daysRemaining === null) continue;
      if (info.daysRemaining > 60) continue;
      result.push({
        bikeId: entry.bike.id,
        bikeName: entry.bike.nickname,
        type,
        itemId: item.id,
        daysRemaining: info.daysRemaining,
        expiresOn: item.expiresOn,
      });
    }
  }
  return result.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

function UpcomingAlertsCard({ entries }: { entries: DashboardEntry[] }) {
  const { t } = useTranslation();
  const items = collectUpcoming(entries);
  if (items.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
      <div className="rounded-2xl border border-border bg-surface/80 px-4 py-3 dark:border-border-dark dark:bg-surface-dark/60">
        <p className="label-micro mb-2.5 text-muted dark:text-muted-dark">{t("dashboard.upcoming")}</p>
        <ul className="flex flex-col gap-1.5">
          {items.slice(0, 4).map((item) => (
            <UpcomingRow key={`${item.bikeId}-${item.type}`} item={item} />
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

function UpcomingRow({ item }: { item: UpcomingItem }) {
  const { t } = useTranslation();
  const urgency =
    item.daysRemaining < 0 ? "text-danger" :
    item.daysRemaining <= 7 ? "text-danger" :
    item.daysRemaining <= 30 ? "text-warning" :
    "text-success";

  return (
    <li>
      <Link
        to={`/dated-items/${item.itemId}`}
        className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-elev dark:hover:bg-surface-elev-dark transition"
      >
        <div className="min-w-0">
          <span className="text-[13px] font-medium">
            {t(`items.${item.type}`)}
          </span>
          {" "}
          <span className="text-[12px] text-muted dark:text-muted-dark truncate">
            · {item.bikeName}
          </span>
        </div>
        <div className={`flex items-baseline gap-1 shrink-0 ${urgency}`}>
          <span className="num text-[15px] font-semibold leading-none">
            {item.daysRemaining < 0 ? t("items.expired") : item.daysRemaining}
          </span>
          {item.daysRemaining >= 0 && (
            <span className="text-[10px] font-medium opacity-80">{t("items.daysLeft")}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

// ─── quick km update ──────────────────────────────────────────────────────────

function QuickKmUpdate({ bikeId, currentKm }: { bikeId: string; currentKm: number | null }) {
  const { t } = useTranslation();
  const update = useUpdateBike(bikeId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentKm != null ? String(currentKm) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when bike switches
  useEffect(() => {
    setValue(currentKm != null ? String(currentKm) : "");
    setEditing(false);
  }, [bikeId, currentKm]);

  const save = async () => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 0 && n !== currentKm) {
      try {
        await update.mutateAsync({ currentKm: n } as any);
        pushToast({ variant: "success", title: t("bike.updated") });
      } catch {
        pushToast({ variant: "danger", title: t("items.saveFailed") });
      }
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <Gauge className="h-3.5 w-3.5 shrink-0 text-muted dark:text-muted-dark" />
        <Input
          ref={inputRef}
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="h-7 w-28 text-sm"
          autoFocus
        />
        <span className="text-xs text-muted dark:text-muted-dark">km</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setEditing(true); }}
      className="mt-2 flex items-center gap-1.5 text-sm text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark transition"
      title={t("dashboard.updateKm")}
    >
      <Gauge className="h-3.5 w-3.5 shrink-0" />
      <span className="num">
        {currentKm != null ? `${currentKm.toLocaleString()} km` : t("dashboard.addKm")}
      </span>
      <Pencil className="h-3 w-3 opacity-50" />
    </button>
  );
}
