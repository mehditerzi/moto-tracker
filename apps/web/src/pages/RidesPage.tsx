import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { CalendarPlus, ChevronRight, MapPin, Radio, Route as RouteIcon, Share2, Users } from "lucide-react";
import type { Bike, RideEvent, Trip } from "@mototracker/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { VehicleAvatar } from "@/components/VehicleAvatar";
import { ShareCardSheet } from "@/components/share/ShareCardSheet";
import { useRideEvents } from "@/hooks/useRideEvents";
import { useActiveRide } from "@/hooks/useRide";
import { useTrips } from "@/hooks/useTrips";
import { useBikes } from "@/hooks/useBikes";
import { useActiveBikeId } from "@/hooks/useActiveBike";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { durationText, summaryCard, tripCard, tripMinutes, weeklyBars } from "@/lib/rideCards";
import type { CardData } from "@/lib/shareCard";
import { pushToast } from "@/hooks/useToast";
import { FeedView } from "@/components/social/FeedView";
import { PostTripSheet } from "@/components/social/PostTripSheet";
import { useProfileGate } from "@/components/social/ProfileGate";
import { useNavigate } from "react-router-dom";

const VIEW_KEY = "garajim.ridesView";
function initialView(): "feed" | "mine" {
  try {
    return localStorage.getItem(VIEW_KEY) === "mine" ? "mine" : "feed";
  } catch {
    return "feed";
  }
}

/**
 * SÜRÜŞLER — the social tab. Everything you do with other people and
 * everything worth showing them, on one screen:
 *
 *  1. ride together now (the live map) or plan a ride for later;
 *  2. the rides you organise or were invited to;
 *  3. your month, as a card you can post;
 *  4. your latest trips, each one shareable.
 */
export function RidesPage() {
  const { t, i18n } = useTranslation();
  const events = useRideEvents();
  const live = useActiveRide();
  const trips = useTrips();
  const bikes = useBikes();
  const [activeBikeId] = useActiveBikeId();
  const [card, setCard] = useState<{ data: CardData; name: string; trip?: Trip } | null>(null);
  const [view, setView] = useState<"feed" | "mine">(initialView);
  const [postTrip, setPostTrip] = useState<Trip | null>(null);
  const gate = useProfileGate();
  const navigate = useNavigate();
  const switchView = (v: "feed" | "mine") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* per-device convenience only */
    }
  };
  /** From the empty feed: post the latest trip, or go turn tracking on. */
  const shareLatest = () => {
    const latest = trips.data?.[0];
    if (latest) setPostTrip(latest);
    else navigate("/trips");
  };

  const bikeById = useMemo(() => new Map<string, Bike>((bikes.data ?? []).map((b) => [b.id, b])), [bikes.data]);
  const activeBike = (activeBikeId && bikeById.get(activeBikeId)) || bikes.data?.[0] || null;

  const monthTrips = useMemo(() => {
    const now = new Date();
    return (trips.data ?? []).filter((x) => {
      const d = new Date(x.startedAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }, [trips.data]);

  const monthName = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(new Date());

  const shareMonth = () => {
    setCard({
      name: "garajim-ay",
      data: summaryCard(
        monthTrips,
        {
          eyebrow: t("shareCard.monthEyebrow"),
          title: monthName,
          vehicle: activeBike,
          bars: weeklyBars(trips.data ?? [], 6, i18n.language),
        },
        t,
        i18n.language,
      ),
    });
  };

  const shareTrip = async (trip: Trip) => {
    try {
      const full = trip.hasRoute ? await api<Trip>(`/api/trips/${trip.id}`) : trip;
      setCard({ name: "garajim-surus", data: tripCard(full, bikeById.get(trip.bikeId), t, i18n.language), trip });
    } catch {
      pushToast({ variant: "danger", title: t("shareCard.renderFailed") });
    }
  };

  const upcoming = events.data?.upcoming ?? [];
  const past = events.data?.past ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="label-micro text-muted dark:text-muted-dark">{t("rides.eyebrow")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{t("rides.title")}</h1>
      </header>

      {/* The two ways to ride with people. */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/map?tab=group"
          className={cn(
            "group relative flex min-h-[128px] flex-col justify-between overflow-hidden rounded-2xl p-4 transition active:scale-[0.98]",
            live.data
              ? "bg-accent text-black shadow-ignite"
              : "border border-border bg-surface dark:border-border-dark dark:bg-surface-dark",
          )}
        >
          <span className={cn("grid h-10 w-10 place-items-center rounded-xl", live.data ? "bg-black/10" : "bg-accent/15 text-accent-dim dark:text-accent")}>
            <Radio className="h-5 w-5" />
          </span>
          {live.data && (
            <span aria-hidden className="absolute right-4 top-4 h-2.5 w-2.5 animate-ping rounded-full bg-black/60" />
          )}
          <span>
            <span className="block text-[15px] font-semibold leading-tight">
              {live.data ? t("rides.backToLive") : t("rides.rideNow")}
            </span>
            <span className={cn("mt-0.5 block text-[12.5px]", live.data ? "text-black/70" : "text-muted dark:text-muted-dark")}>
              {live.data ? t("rides.liveMembers", { count: live.data.members.length }) : t("rides.rideNowSub")}
            </span>
          </span>
        </Link>
        <Link
          to="/rides/new"
          className="flex min-h-[128px] flex-col justify-between rounded-2xl border border-border bg-surface p-4 transition active:scale-[0.98] dark:border-border-dark dark:bg-surface-dark"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent-dim dark:text-accent">
            <CalendarPlus className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold leading-tight">{t("rides.plan")}</span>
            <span className="mt-0.5 block text-[12.5px] text-muted dark:text-muted-dark">{t("rides.planSub")}</span>
          </span>
        </Link>
      </div>

      <div role="tablist" aria-label={t("rides.title")} className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 dark:bg-surface-elev-dark">
        {(["feed", "mine"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => switchView(v)}
            className={cn(
              "min-h-[40px] rounded-lg text-[13.5px] font-medium transition",
              view === v ? "bg-bg text-text shadow-sm dark:bg-surface-dark dark:text-text-dark" : "text-muted dark:text-muted-dark",
            )}
          >
            {t(`rides.view.${v}`)}
          </button>
        ))}
      </div>

      {view === "feed" ? (
        <FeedView onShareTrip={shareLatest} />
      ) : (
      <>
      {/* Planned rides */}
      <section className="flex flex-col gap-2.5" aria-labelledby="rides-upcoming">
        <h2 id="rides-upcoming" className="text-[13px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
          {t("rides.upcoming")}
        </h2>
        {events.isLoading ? (
          <Skeleton className="h-[88px] rounded-2xl" />
        ) : events.isError ? (
          <ErrorState onRetry={() => void events.refetch()} />
        ) : upcoming.length === 0 ? (
          <Card className="flex items-center gap-4 p-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
              <Users className="h-5 w-5 text-muted dark:text-muted-dark" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold">{t("rides.emptyTitle")}</div>
              <p className="text-[13px] text-muted dark:text-muted-dark">{t("rides.emptySub")}</p>
            </div>
          </Card>
        ) : (
          upcoming.map((ev, i) => <EventRow key={ev.id} ev={ev} index={i} />)
        )}
      </section>

      {/* This month, shareable */}
      <section className="flex flex-col gap-2.5" aria-labelledby="rides-month">
        <div className="flex items-center justify-between">
          <h2 id="rides-month" className="text-[13px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
            {monthName}
          </h2>
        </div>
        {trips.isLoading ? (
          <Skeleton className="h-[132px] rounded-2xl" />
        ) : (
          <MonthCard trips={monthTrips} bike={activeBike} onShare={shareMonth} />
        )}
      </section>

      {/* Latest trips */}
      <section className="flex flex-col gap-2.5" aria-labelledby="rides-trips">
        <div className="flex items-center justify-between">
          <h2 id="rides-trips" className="text-[13px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
            {t("rides.latestTrips")}
          </h2>
          <Link to="/trips" className="text-[13px] font-medium text-accent-dim dark:text-accent">
            {t("rides.allTrips")}
          </Link>
        </div>
        {trips.isLoading ? (
          <Skeleton className="h-[76px] rounded-2xl" />
        ) : (trips.data?.length ?? 0) === 0 ? (
          <Card className="flex items-center gap-4 p-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
              <RouteIcon className="h-5 w-5 text-muted dark:text-muted-dark" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold">{t("trips.empty")}</div>
              <p className="text-[13px] text-muted dark:text-muted-dark">{t("rides.tripsEmptySub")}</p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/trips">{t("rides.turnOn")}</Link>
            </Button>
          </Card>
        ) : (
          trips.data!.slice(0, 3).map((trip) => {
            const bike = bikeById.get(trip.bikeId);
            const min = tripMinutes(trip);
            return (
              <Card key={trip.id} className="flex items-center gap-3 p-3">
                {bike ? (
                  <VehicleAvatar vehicle={bike} size="thumb" className="h-12 w-16 shrink-0 rounded-xl" />
                ) : (
                  <span className="h-12 w-16 shrink-0 rounded-xl bg-surface dark:bg-surface-elev-dark" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="num text-[17px] font-semibold leading-tight">
                    {formatNumber(trip.distanceKm, 1, i18n.language)} <span className="text-[12px] font-medium text-muted dark:text-muted-dark">km</span>
                  </div>
                  <div className="truncate text-[12.5px] text-muted dark:text-muted-dark">
                    {new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(trip.startedAt))}
                    {" · "}
                    {durationText(min, t)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label={t("shareCard.shareTrip")}
                  onClick={() => void shareTrip(trip)}
                >
                  <Share2 className="h-[18px] w-[18px]" />
                </Button>
              </Card>
            );
          })
        )}
      </section>

      {past.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-[13px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
            {t("rides.past", { count: past.length })}
            <ChevronRight className="h-4 w-4 transition group-open:rotate-90" />
          </summary>
          <div className="mt-2.5 flex flex-col gap-2.5">
            {past.map((ev, i) => (
              <EventRow key={ev.id} ev={ev} index={i} muted />
            ))}
          </div>
        </details>
      )}

      </>
      )}

      <ShareCardSheet
        open={!!card}
        onClose={() => setCard(null)}
        data={card?.data ?? null}
        fileName={card?.name ?? "garajim"}
        onPostToFeed={
          card?.trip
            ? () => {
                const trip = card.trip!;
                setCard(null);
                gate(() => setPostTrip(trip));
              }
            : undefined
        }
      />
      <PostTripSheet trip={postTrip} onClose={() => setPostTrip(null)} />
    </div>
  );
}

function MonthCard({ trips, bike, onShare }: { trips: Trip[]; bike: Bike | null; onShare: () => void }) {
  const { t, i18n } = useTranslation();
  const km = trips.reduce((s, x) => s + x.distanceKm, 0);
  const min = trips.reduce((s, x) => s + tripMinutes(x), 0);
  return (
    <Card className="relative overflow-hidden p-0">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_0%_0%,rgba(225,255,77,0.16),transparent_60%)]" />
      <div className="relative flex items-stretch gap-3 p-4">
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
          <div>
            <div className="num text-[34px] font-semibold leading-none tracking-tight">
              {formatNumber(km, 0, i18n.language)}
              <span className="ml-1 text-[14px] font-medium text-muted dark:text-muted-dark">km</span>
            </div>
            <div className="mt-1.5 text-[13px] text-muted dark:text-muted-dark">
              {t("rides.monthLine", { count: trips.length, time: durationText(min, t) })}
            </div>
          </div>
          <Button size="sm" variant="accent" className="self-start" onClick={onShare}>
            <Share2 className="h-3.5 w-3.5" /> {t("rides.shareMonth")}
          </Button>
        </div>
        {bike && <VehicleAvatar vehicle={bike} size="thumb" className="h-[88px] w-[124px] shrink-0 rounded-xl" />}
      </div>
    </Card>
  );
}

function EventRow({ ev, index, muted = false }: { ev: RideEvent; index: number; muted?: boolean }) {
  const { t, i18n } = useTranslation();
  const d = new Date(ev.startsAt);
  const status = ev.cancelled
    ? t("rides.status.cancelled")
    : ev.liveCode
      ? t("rides.status.live")
      : ev.isOwner
        ? t("rides.status.organiser")
        : ev.myStatus === "going"
          ? t("rides.status.going")
          : ev.myStatus === "maybe"
            ? t("rides.status.maybe")
            : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 6) * 0.04, duration: 0.24 }}
    >
      <Link to={`/rides/${ev.code}`} className="block">
        <Card className={cn("flex items-center gap-3.5 p-3.5 transition hover:border-text/20", muted && "opacity-70")}>
          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
            <span className="text-[11px] font-semibold uppercase text-accent-dim dark:text-accent">
              {new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(d)}
            </span>
            <span className="num text-[21px] font-semibold leading-none">{d.getDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn("truncate text-[15px] font-semibold", ev.cancelled && "line-through")}>{ev.title}</div>
            <div className="flex items-center gap-1 truncate text-[12.5px] text-muted dark:text-muted-dark">
              <span className="num">
                {new Intl.DateTimeFormat(i18n.language, { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(d)}
              </span>
              <span>·</span>
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{ev.meet.name}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1 text-muted dark:text-muted-dark">
                <Users className="h-3 w-3" /> {ev.goingCount}
              </span>
              {status && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    ev.liveCode
                      ? "bg-accent text-black"
                      : ev.cancelled
                        ? "bg-danger/15 text-danger"
                        : "bg-accent/15 text-accent-dim dark:text-accent",
                  )}
                >
                  {status}
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted dark:text-muted-dark" />
        </Card>
      </Link>
    </motion.div>
  );
}
