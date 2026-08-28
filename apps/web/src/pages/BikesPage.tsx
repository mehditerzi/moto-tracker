import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Bike as BikeIcon, ChevronRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { AddVehicleButton } from "@/components/AddVehicleButton";
import { PaywallSheet } from "@/components/PaywallSheet";
import { useBikes } from "@/hooks/useBikes";
import { useEntitlement } from "@/hooks/useEntitlement";
import { VehicleAvatar } from "@/components/VehicleAvatar";
import { EmptyGroup, GroupFilterBar, useGroupFilter } from "@/components/groups/GroupFilterBar";
import { ClaimInbox } from "@/components/share/ClaimInbox";
import { ShareInviteAccept } from "@/components/share/ShareInviteAccept";
import { SharedVehicleBadge } from "@/components/share/SharedVehicleBadge";

/**
 * At-cap upsell: shown above the vehicle list whenever the garage is full so
 * the upgrade path is one visible tap — not buried behind a disabled button.
 */
function GarageFullBanner() {
  const { t } = useTranslation();
  const ent = useEntitlement();
  const [paywall, setPaywall] = useState(false);
  if (!ent.data || ent.data.canAddVehicle) return null;
  return (
    <>
      <Card className="flex items-center justify-between gap-3 border-accent/40 bg-accent/5 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Sparkles className="h-5 w-5 shrink-0 text-accent-dim" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold">
              {t("paywall.garageFull", { used: ent.data.activeVehicles, max: ent.data.maxVehicles })}
            </div>
            <div className="text-[13px] text-muted dark:text-muted-dark">
              {t("paywall.garageFullSub")}
            </div>
          </div>
        </div>
        <Button size="sm" variant="accent" onClick={() => setPaywall(true)}>
          {t("paywall.choosePack")}
        </Button>
      </Card>
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} />
    </>
  );
}

export function BikesPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useBikes();
  // Renders nothing at all until the user has made a group, so the garage is
  // unchanged for anyone not using the feature.
  const groups = useGroupFilter(data);
  const list = groups.filtered ?? [];

  // A skeleton in the shape of the list, not a centred "Loading…" — the text
  // version collapsed the page to one line and then shoved everything down.
  if (isLoading) {
    return (
      <div className="flex flex-col gap-5" aria-hidden>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-36" />
          </div>
          <Skeleton className="h-9 w-20 rounded-xl" />
        </div>
        <div className="grid gap-2.5">
          <Skeleton className="h-[76px] rounded-2xl" />
          <Skeleton className="h-[76px] rounded-2xl" />
        </div>
      </div>
    );
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  if (!data || data.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center"
      >
        {/* Mounted even here: somebody whose first act is following a share link
            arrives at an EMPTY garage, and without this there is nowhere to
            accept the invitation from. */}
        <ShareInviteAccept />
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

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label-micro text-muted dark:text-muted-dark">
            {t("nav.bikes")}
          </div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">
            {t("dashboard.myBikes")}
          </h1>
        </div>
        <AddVehicleButton size="sm" variant="accent">
          <Plus className="h-4 w-4" /> {t("dashboard.add")}
        </AddVehicleButton>
      </header>

      <GarageFullBanner />
      <ShareInviteAccept />
      {/* Somebody asking about one of these vehicles, or waiting on an answer
          about one of theirs. Above the list because a claim on a real asset
          must not be something you scroll past. */}
      <ClaimInbox />

      <GroupFilterBar
        groups={groups.groups}
        groupId={groups.groupId}
        onChange={groups.setGroupId}
        total={data.length}
      />

      {/* "You have no vehicles" and "this collection is empty" are different
          states. The `data.length === 0` branch above owns the first; showing
          it here — when a filter is simply excluding everything — is how a
          filter convinces someone their data has been deleted. */}
      {list.length === 0 && groups.groupId !== null ? (
        <EmptyGroup onClear={() => groups.setGroupId(null)} />
      ) : (
      <div className="grid gap-2.5">
        {list.map((b, i) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            // Capped so a large garage doesn't animate in for seconds — see the
            // same cap on the trips list.
            transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Link to={`/bikes/${b.id}/edit`} className="block">
              <Card className="flex items-center justify-between gap-4 p-4 transition hover:border-text/20 hover:shadow-card dark:hover:border-text-dark/20">
                <div className="flex min-w-0 items-center gap-3">
                  {/* `thumb`: a 44px square does not need the 1280px master.
                      One component for both states, so a row is the same height
                      whether the vehicle has a photo, is still loading one, or
                      never had one. */}
                  <VehicleAvatar
                    vehicle={b}
                    size="thumb"
                    className="h-11 w-11 shrink-0 rounded-xl ring-1 ring-border dark:ring-border-dark"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{b.nickname}</div>
                    <div className="truncate text-[13px] text-muted dark:text-muted-dark">
                      {[b.make, b.model, b.year].filter(Boolean).join(" · ") || "—"}
                    </div>
                    {b.plate && (
                      <div className="num mt-0.5 text-[11px] uppercase tracking-wider text-muted dark:text-muted-dark">
                        {b.plate}
                      </div>
                    )}
                    <SharedVehicleBadge bike={b} />
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted dark:text-muted-dark" />
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
      )}
    </div>
  );
}
