import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Pencil, Bike as BikeIcon, Settings2, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { FIELD_WIDTH } from "@/components/ui/control";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/hooks/useDashboard";
import { useUpdateBike } from "@/hooks/useBikes";
import { useActiveBikeId } from "@/hooks/useActiveBike";
import { vehicleIcon } from "@/lib/vehicleType";
import { pushNextDeadline } from "@/lib/widget";
import { StatusChip } from "@/components/StatusChip";
import { ErrorState } from "@/components/ErrorState";
import { AddVehicleButton } from "@/components/AddVehicleButton";
import { BikeSwitcher } from "@/components/BikeSwitcher";
import { VehicleAvatar } from "@/components/VehicleAvatar";
import { TYPE_ORDER } from "@/lib/datedItems";
import { statusFor } from "@/lib/datedItems";
import { MaintenancePanel } from "@/components/MaintenancePanel";
import { OfficialServicesCard } from "@/components/OfficialServicesCard";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { useFleetDisclosure } from "@/hooks/useFleetDisclosure";
import { OrgVehicleBadge } from "@/components/fleet/OrgVehicleBadge";
import { OrgVehicleNotice } from "@/components/fleet/OrgVehicleNotice";
import { SharedVehicleBadgeById } from "@/components/share/SharedVehicleBadge";
import type { DashboardEntry, DatedItemType } from "@mototracker/shared";

export function DashboardPage() {
  const { t } = useTranslation();
  const dash = useDashboard();
  // Which vehicles belong to an organization, and to which one. Empty (and free
  // of any request) for a consumer — see hooks/useFleetDisclosure.ts.
  const { orgVehicles } = useFleetDisclosure();
  // Persisted (localStorage) so the selection survives the capture → review →
  // back round-trip and app restarts — the OCR button always targets the bike
  // the user actually picked.
  const [activeBikeId, setActiveBikeId] = useActiveBikeId();

  useEffect(() => {
    if (!dash.data || dash.data.length === 0) return;
    // Default to the first bike, and self-heal if the stored id points at a bike
    // that no longer exists (archived/deleted) so we never get stuck on a ghost.
    const exists = activeBikeId && dash.data.some((e) => e.bike.id === activeBikeId);
    if (!exists) setActiveBikeId(dash.data[0]!.bike.id);
  }, [dash.data, activeBikeId, setActiveBikeId]);

  // Feed the iOS home-screen widget the soonest upcoming deadline (native no-op
  // on web). Recomputed whenever the dashboard data changes.
  useEffect(() => {
    if (!dash.data) return;
    const next = collectUpcoming(dash.data)[0];
    pushNextDeadline(
      next
        ? {
            label: t(`items.${next.type}`),
            date: next.expiresOn,
            vehicle: next.bikeName,
            daysRemaining: next.daysRemaining,
          }
        : null,
    );
  }, [dash.data, t]);

  if (dash.isLoading)
    return (
      <div className="flex flex-col gap-5" aria-hidden>
        {/* upcoming card */}
        <div className="rounded-2xl border border-border bg-surface/80 px-4 py-3 dark:border-border-dark dark:bg-surface-dark/60">
          <Skeleton className="mb-2.5 h-3 w-20" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-4/5" />
          </div>
        </div>
        {/* bike switcher placeholder */}
        <Skeleton className="h-10 w-full rounded-2xl" />
        {/* active vehicle header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="mt-1 h-5 w-28" />
          </div>
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
        {/* 3-up status chips */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    );
  if (dash.isError || !dash.data) return <ErrorState onRetry={() => void dash.refetch()} />;

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
        <AddVehicleButton variant="accent" size="lg">
          <Plus className="h-4 w-4" /> {t("dashboard.addBike")}
        </AddVehicleButton>
      </motion.div>
    );
  }

  const active = (dash.data.find((e) => e.bike.id === activeBikeId) ?? dash.data[0])!;
  const ActiveIcon = vehicleIcon(active.bike.vehicleType);
  const activeOrg = orgVehicles.get(active.bike.id) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <UpcomingAlertsCard entries={dash.data} />

      <BikeSwitcher
        entries={dash.data}
        activeBikeId={active.bike.id}
        onSelect={setActiveBikeId}
        orgNameFor={(id) => orgVehicles.get(id)?.orgName ?? null}
      />

      {/* Was wrapped in `<AnimatePresence mode="wait">`. "wait" holds the new
          vehicle back until the old one has finished its 0.22s exit, so every
          tap on the switcher spent a fifth of a second on an empty column
          before anything appeared — on the app's front door, on the interaction
          people repeat most. The entrance stays; only the enforced wait goes. */}
      <motion.div
        key={active.bike.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="flex flex-col gap-5"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="label-micro flex items-center gap-1.5 text-muted dark:text-muted-dark">
                <ActiveIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t("dashboard.active")}
              </div>
              {/* Persistent, non-dismissible: a driver must never be unsure
                  which garage they are in. */}
              {activeOrg && <OrgVehicleBadge orgName={activeOrg.orgName} />}
            </div>
            {/* `leading-tight`, not `leading-none`. Geist's content box is
                1.30em, so a line box of exactly 1em combined with `truncate`
                (which brings `overflow:hidden`) clipped 0.15em off the top and
                bottom of every glyph — the descender of a ğ/ş/y and the dot of
                an İ, i.e. most Turkish nicknames. 1.25em clears both. */}
            <h1 className="mt-1.5 truncate text-[32px] font-semibold leading-tight tracking-tight">
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
            {/* Quiet, but always there. The worst state to be in with a shared
                vehicle is not knowing you are in it. */}
            <SharedVehicleBadgeById bikeId={active.bike.id} />
            <QuickKmUpdate bikeId={active.bike.id} currentKm={active.bike.currentKm} />
          </div>
          {/* h-11/w-11 rather than the `icon` size's 40px: this is the only way
              into the vehicle's record from the front door and it has to meet
              the 44px target the rest of the app holds itself to. */}
          <Button
            asChild
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label={t("dashboard.edit")}
          >
            <Link to={`/bikes/${active.bike.id}/edit`}><Pencil className="h-4 w-4" /></Link>
          </Button>
        </header>

        {/* BELOW the header, and only when there is something to show.

            It used to sit between the switcher and the header, rendered
            unconditionally, because making it conditional jumped the page by
            ~160px whenever you switched between a vehicle with a photo and one
            without. Reserving the space did fix the jump, but it charged every
            photo-less vehicle a screen-wide tinted rectangle whose entire
            message was "no photo here".

            Ordering it below the header fixes the same jump for free and keeps
            nothing on screen that has nothing to say. What you look at when you
            tap the switcher — the name, the make/model, the plate, the km — now
            sits at a fixed offset under the switcher and cannot move; only the
            status chips and below shift, by exactly the height of a photo that
            is actually there. Animating the height was not an option worth
            taking: `key={active.bike.id}` remounts this whole subtree on every
            switch, so there is no persistent box for a layout transition to
            animate between. */}
        {active.bike.photoUrl && (
          <VehicleAvatar
            vehicle={active.bike}
            emphasis
            label={t("bike.photoOf", { name: active.bike.nickname })}
            className="aspect-[16/7] w-full rounded-2xl border border-border dark:border-border-dark"
          />
        )}

        {activeOrg && <OrgVehicleNotice orgName={activeOrg.orgName} />}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={t("dashboard.active")}>
          {TYPE_ORDER.map((type, i) => (
            <StatusChip key={type} type={type} bikeId={active.bike.id} item={active.items[type]} index={i} />
          ))}
        </section>

        <MaintenancePanel bikeId={active.bike.id} />

        <OfficialServicesCard />
      </motion.div>

      <div className="mb-safe mt-4 flex items-center justify-center">
        <Button asChild size="sm" variant="ghost" className="text-muted dark:text-muted-dark">
          <Link to="/bikes"><Settings2 className="h-3.5 w-3.5" /> {t("dashboard.manageBikes")}</Link>
        </Button>
      </div>
    </div>
  );
}

// ─── upcoming alerts card ─────────────────────────────────────────────────────

interface UpcomingItem {
  bikeId: string;
  bikeName: string;
  type: DatedItemType;
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

  // Escape used to only flip `editing` off, which fired the input's blur — so
  // "cancel" committed the very edit it was meant to discard. Cancelling now
  // restores the stored value first and suppresses the blur save.
  const cancelledRef = useRef(false);
  // `update.isPending` alone could not stop a double submit: Enter and the blur
  // it causes both run in the same tick, so the second call still reads the
  // render's stale `false` and fires a second PATCH. A ref flips synchronously.
  const savingRef = useRef(false);

  const save = async () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    if (savingRef.current || update.isPending) return;
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 0 && n !== currentKm) {
      savingRef.current = true;
      try {
        await update.mutateAsync({ currentKm: n } as any);
        pushToast({ variant: "success", title: t("bike.updated") });
      } catch (e) {
        pushToast({ variant: "danger", title: t("items.saveFailed"), description: friendlyError(e, t) });
      } finally {
        savingRef.current = false;
      }
    }
    setEditing(false);
  };

  const cancel = () => {
    cancelledRef.current = true;
    setValue(currentKm != null ? String(currentKm) : "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <Gauge className="h-3.5 w-3.5 shrink-0 text-muted dark:text-muted-dark" />
        {/* `FIELD_WIDTH.number` — the same 152px an odometer reading gets on the
            vehicle form, from the same table, rather than a `w-32` guessed here.
            It goes on a wrapper because NumberInput's own box is `w-full`; a
            width class on the control would be overridden by it.

            Height and the 16px-on-phones type come from the control (this was
            `h-7 ... text-sm`: a 28px box under the 44px target whose 14px text
            made iOS zoom the page the moment it took focus, on a field the app
            asks you to use after every ride). The unit moved inside as a suffix,
            so the trailing "km" span is gone.

            `type="text"` + inputMode="numeric" via NumberInput, not
            `type="number"`: a stray scroll over this focused field used to
            rewrite a recorded odometer reading, and on a Turkish keypad the
            separator key made WebKit report the whole value as empty. */}
        <div className={FIELD_WIDTH.number}>
          <NumberInput
            ref={inputRef}
            suffix="km"
            // No visible label — the Gauge glyph is the only marking, and a
            // glyph is not an accessible name.
            aria-label={t("dashboard.updateKm")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            enterKeyHint="done"
            disabled={update.isPending}
            autoFocus
          />
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setEditing(true); }}
      className="mt-2 flex min-h-[44px] items-center gap-1.5 text-sm text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark transition"
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
