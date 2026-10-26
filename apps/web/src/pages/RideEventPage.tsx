import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  CalendarClock,
  Check,
  Flag,
  Gauge,
  Image as ImageIcon,
  MapPin,
  Navigation2,
  Pencil,
  Radio,
  Route as RouteIcon,
  Send,
  UserMinus,
  Users,
  XCircle,
} from "lucide-react";
import type { Bike, RideEvent, RsvpStatus } from "@mototracker/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/BackLink";
import { ErrorState } from "@/components/ErrorState";
import { VehicleAvatar } from "@/components/VehicleAvatar";
import { ShareCardSheet } from "@/components/share/ShareCardSheet";
import { useConfirm } from "@/components/ConfirmSheet";
import {
  inviteUrl,
  useCancelRideEvent,
  useDeleteRideEvent,
  useRemoveRider,
  useReportRideEvent,
  useRideEvent,
  useRsvp,
  useStartLiveRide,
} from "@/hooks/useRideEvents";
import { useBikes } from "@/hooks/useBikes";
import { useActiveBikeId } from "@/hooks/useActiveBike";
import { useMe } from "@/hooks/useMe";
import { pushToast } from "@/hooks/useToast";
import { ApiError } from "@/lib/api";
import { friendlyError } from "@/lib/apiError";
import { mapsHref } from "@/lib/contact";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { hapticSelection, hapticSuccess } from "@/lib/haptics";
import { rideEventCard, rideWhen } from "@/lib/rideCards";
import { shareLink } from "@/lib/shareImage";
import { track } from "@/lib/telemetry";

/** The organiser may open the live room from this long before the start. */
const LIVE_WINDOW_MS = 3 * 3_600_000;

export function RideEventPage() {
  const { code = "" } = useParams();
  const { t } = useTranslation();
  const ev = useRideEvent(code);

  if (ev.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }
  if (ev.isError || !ev.data) {
    const missing = ev.error instanceof ApiError && ev.error.status === 404;
    return (
      <div className="flex flex-col gap-5">
        <BackLink to="/rides" />
        {missing ? (
          <Card className="p-6 text-center">
            <div className="text-[17px] font-semibold">{t("rides.notFound")}</div>
            <p className="mt-1 text-[13.5px] text-muted dark:text-muted-dark">{t("rides.notFoundSub")}</p>
          </Card>
        ) : (
          <ErrorState onRetry={() => void ev.refetch()} />
        )}
      </div>
    );
  }
  return <RideEventView ev={ev.data} />;
}

function RideEventView({ ev }: { ev: RideEvent }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const me = useMe();
  const bikes = useBikes();
  const [activeBikeId] = useActiveBikeId();
  const [params, setParams] = useSearchParams();
  const justCreated = params.get("created") === "1";
  const [cardOpen, setCardOpen] = useState(false);

  const rsvp = useRsvp(ev.code);
  const start = useStartLiveRide(ev.id);
  const cancel = useCancelRideEvent(ev.id);
  const del = useDeleteRideEvent(ev.id);
  const remove = useRemoveRider(ev.id);
  const report = useReportRideEvent(ev.code);

  const myBikes = useMemo(() => (bikes.data ?? []).filter((b) => !b.archived), [bikes.data]);
  const defaultBike = myBikes.find((b) => b.id === activeBikeId) ?? myBikes[0] ?? null;
  const startsAt = new Date(ev.startsAt);
  const canGoLive = ev.isOwner && !ev.cancelled && startsAt.getTime() - Date.now() < LIVE_WINDOW_MS;
  const full = !!ev.maxRiders && ev.goingCount >= ev.maxRiders && ev.myStatus !== "going";

  const setStatus = (status: RsvpStatus | null, bikeId?: string | null) => {
    hapticSelection();
    rsvp.mutate(
      { status, bikeId: status === "going" ? bikeId ?? defaultBike?.id ?? null : undefined },
      {
        onSuccess: () => {
          if (status === "going") {
            hapticSuccess();
            track("ride_rsvp", { status });
          }
        },
        onError: (e) => pushToast({ variant: "danger", title: rsvpError(e, t) }),
      },
    );
  };

  const invite = async () => {
    const out = await shareLink({
      title: ev.title,
      text: t("rides.inviteText", { title: ev.title, when: rideWhen(ev.startsAt, i18n.language), meet: ev.meet.name }),
      url: inviteUrl(ev.code),
    });
    if (out === "copied") pushToast({ variant: "success", title: t("rides.linkCopied") });
    if (out !== "dismissed") track("ride_invite_shared");
    if (justCreated) setParams({}, { replace: true });
  };

  const goLive = () =>
    start.mutate(undefined, {
      onSuccess: () => {
        hapticSuccess();
        track("ride_live_from_plan");
        navigate("/map?tab=group");
      },
      onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }),
    });

  const onCancel = async () => {
    if (!(await confirm({ title: t("rides.cancelConfirm"), message: t("rides.cancelConfirmSub"), confirmLabel: t("rides.cancelRide"), destructive: true }))) return;
    cancel.mutate(undefined, { onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }) });
  };
  const onDelete = async () => {
    if (!(await confirm({ title: t("rides.deleteConfirm"), confirmLabel: t("common.delete"), destructive: true }))) return;
    del.mutate(undefined, {
      onSuccess: () => navigate("/rides", { replace: true }),
      onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }),
    });
  };
  const onRemove = async (userId: string, name: string) => {
    if (!(await confirm({ title: t("rides.removeConfirm", { name }), confirmLabel: t("rides.remove"), destructive: true }))) return;
    remove.mutate(userId, { onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }) });
  };
  const onReport = async () => {
    if (!(await confirm({ title: t("rides.reportConfirm"), message: t("rides.reportConfirmSub"), confirmLabel: t("rides.report"), destructive: true }))) return;
    report.mutate("inappropriate", {
      onSuccess: () => {
        pushToast({ variant: "success", title: t("rides.reported") });
        navigate("/rides", { replace: true });
      },
      onError: (e) => pushToast({ variant: "danger", title: friendlyError(e, t) }),
    });
  };

  const facts: { icon: typeof MapPin; label: string; value: string; href?: string }[] = [
    { icon: CalendarClock, label: t("rides.form.when"), value: rideWhen(ev.startsAt, i18n.language) },
    {
      icon: MapPin,
      label: t("rides.form.meet"),
      value: ev.meet.name,
      href: mapsHref({ lat: ev.meet.lat, lng: ev.meet.lng, query: ev.meet.name, directions: true }),
    },
    ...(ev.destination
      ? [
          {
            icon: Flag,
            label: t("rides.form.destination"),
            value: ev.destination.name,
            href: mapsHref({ lat: ev.destination.lat, lng: ev.destination.lng, query: ev.destination.name, directions: true }),
          },
        ]
      : []),
    ...(ev.distanceKm ? [{ icon: RouteIcon, label: t("rides.form.distance"), value: `${formatNumber(ev.distanceKm, 0, i18n.language)} km` }] : []),
    { icon: Gauge, label: t("rides.form.pace"), value: `${t(`rides.pace.${ev.pace}`)} · ${t(`rides.kind.${ev.vehicleKind}`)}` },
  ];

  return (
    <div className="flex flex-col gap-5">
      <BackLink to="/rides" />

      {/* Hero */}
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-[#0B0B0E] p-5 text-white"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_80%_at_0%_0%,rgba(225,255,77,0.22),transparent_60%)]" />
        <div className="relative flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <span className="text-[11px] font-semibold uppercase text-accent">
              {new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(startsAt)}
            </span>
            <span className="num text-[26px] font-semibold leading-none">{startsAt.getDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-accent">
              {ev.cancelled ? t("rides.status.cancelled") : ev.liveCode ? t("rides.status.live") : t("rides.cardEyebrow")}
            </div>
            <h1 className={cn("mt-1 text-[24px] font-semibold leading-tight tracking-tight", ev.cancelled && "line-through opacity-70")}>
              {ev.title}
            </h1>
            <div className="mt-1 text-[13px] text-white/60">
              {t("rides.organisedBy", { name: ev.isOwner ? t("rides.you") : ev.ownerName })}
            </div>
          </div>
        </div>
        <div className="relative mt-4 flex items-center gap-2 text-[13px] text-white/80">
          <Users className="h-4 w-4" />
          {t("rides.goingCount", { count: ev.goingCount })}
          {ev.maybeCount > 0 && <span className="text-white/50">· {t("rides.maybeCount", { count: ev.maybeCount })}</span>}
          {ev.maxRiders && <span className="text-white/50">· {t("rides.capacity", { max: ev.maxRiders })}</span>}
        </div>
      </motion.header>

      {justCreated && !ev.cancelled && (
        <Card className="flex items-center gap-3 border-accent/40 bg-accent/10 p-4">
          <Check className="h-5 w-5 shrink-0 text-accent-dim dark:text-accent" />
          <div className="min-w-0 flex-1 text-[13.5px]">
            <div className="font-semibold">{t("rides.createdTitle")}</div>
            <div className="text-muted dark:text-muted-dark">{t("rides.createdSub")}</div>
          </div>
        </Card>
      )}

      {/* Primary action */}
      {!ev.cancelled &&
        (ev.liveCode ? (
          <Button asChild variant="accent" size="lg" className="w-full">
            <Link to={ev.isOwner ? "/map?tab=group" : `/map?join=${ev.liveCode}`}>
              <Radio className="h-4 w-4" /> {ev.isOwner ? t("rides.openLive") : t("rides.joinLive")}
            </Link>
          </Button>
        ) : ev.isOwner ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant={canGoLive ? "outline" : "accent"} size="lg" onClick={() => void invite()}>
              <Send className="h-4 w-4" /> {t("rides.invite")}
            </Button>
            {canGoLive ? (
              <Button variant="accent" size="lg" onClick={goLive} disabled={start.isPending}>
                <Radio className="h-4 w-4" /> {t("rides.startLive")}
              </Button>
            ) : (
              <Button variant="outline" size="lg" onClick={() => setCardOpen(true)}>
                <ImageIcon className="h-4 w-4" /> {t("rides.shareStory")}
              </Button>
            )}
          </div>
        ) : (
          <RsvpControl ev={ev} busy={rsvp.isPending} full={full} onSet={setStatus} />
        ))}

      {/* Which vehicle you are bringing */}
      {!ev.cancelled && ev.myStatus === "going" && !ev.isOwner && myBikes.length > 1 && (
        <BikePicker
          bikes={myBikes}
          selectedName={ev.riders.find((r) => r.userId === me.data?.user.id)?.vehicle ?? null}
          onPick={(b) => setStatus("going", b.id)}
        />
      )}

      {/* Facts */}
      <Card className="divide-y divide-border p-0 dark:divide-border-dark">
        {facts.map((f) => {
          const Icon = f.icon;
          const body = (
            <>
              <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted dark:text-muted-dark" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-muted dark:text-muted-dark">{f.label}</div>
                <div className="text-[15px] font-medium first-letter:uppercase">{f.value}</div>
              </div>
              {f.href && <Navigation2 className="mt-1 h-4 w-4 shrink-0 text-accent-dim dark:text-accent" />}
            </>
          );
          return f.href ? (
            <a key={f.label} href={f.href} target="_blank" rel="noreferrer" className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-surface dark:hover:bg-surface-elev-dark">
              {body}
            </a>
          ) : (
            <div key={f.label} className="flex items-start gap-3 px-4 py-3.5">
              {body}
            </div>
          );
        })}
        {ev.note && <p className="whitespace-pre-line px-4 py-3.5 text-[14px] leading-relaxed">{ev.note}</p>}
      </Card>

      {/* Who is coming */}
      <section className="flex flex-col gap-2.5" aria-labelledby="ride-riders">
        <h2 id="ride-riders" className="text-[13px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
          {t("rides.riders")}
        </h2>
        <Card className="divide-y divide-border p-0 dark:divide-border-dark">
          {ev.riders.map((r) => (
            <div key={r.userId} className="flex items-center gap-3 px-4 py-3">
              <span
                aria-hidden
                className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-full text-[15px] font-semibold",
                  r.isOwner ? "bg-accent text-black" : "bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark",
                )}
              >
                {r.name.slice(0, 1).toLocaleUpperCase(i18n.language)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-medium">
                  {r.userId === me.data?.user.id ? t("rides.you") : r.name}
                  {r.isOwner && <span className="ml-1.5 text-[11.5px] font-semibold text-accent-dim dark:text-accent">{t("rides.status.organiser")}</span>}
                </div>
                <div className="truncate text-[12.5px] text-muted dark:text-muted-dark">
                  {[r.status === "maybe" ? t("rides.status.maybe") : null, r.vehicle].filter(Boolean).join(" · ") || t("rides.status.going")}
                </div>
              </div>
              {ev.isOwner && !r.isOwner && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted dark:text-muted-dark"
                  aria-label={t("rides.removeRider", { name: r.name })}
                  onClick={() => void onRemove(r.userId, r.name)}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </Card>
      </section>

      {/* Sharing */}
      {!ev.cancelled && (
        <div className="grid grid-cols-2 gap-2">
          {!ev.isOwner || ev.liveCode || canGoLive ? (
            <Button variant="outline" onClick={() => void invite()}>
              <Send className="h-4 w-4" /> {t("rides.invite")}
            </Button>
          ) : null}
          {(!ev.isOwner || ev.liveCode || canGoLive) && (
            <Button variant="outline" onClick={() => setCardOpen(true)}>
              <ImageIcon className="h-4 w-4" /> {t("rides.shareStory")}
            </Button>
          )}
        </div>
      )}

      {/* Management */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-2 text-[13.5px]">
        {ev.isOwner && !ev.cancelled && (
          <>
            <Link to={`/rides/${ev.code}/edit`} className="inline-flex items-center gap-1.5 font-medium text-text dark:text-text-dark">
              <Pencil className="h-3.5 w-3.5" /> {t("common.edit")}
            </Link>
            <button type="button" onClick={() => void onCancel()} className="inline-flex items-center gap-1.5 font-medium text-danger">
              <XCircle className="h-3.5 w-3.5" /> {t("rides.cancelRide")}
            </button>
          </>
        )}
        {ev.isOwner && ev.cancelled && (
          <button type="button" onClick={() => void onDelete()} className="font-medium text-danger">
            {t("rides.deleteRide")}
          </button>
        )}
        {!ev.isOwner && ev.myStatus && !ev.cancelled && (
          <button type="button" onClick={() => setStatus(null)} className="font-medium text-muted dark:text-muted-dark">
            {t("rides.leave")}
          </button>
        )}
        {!ev.isOwner && (
          <button type="button" onClick={() => void onReport()} className="inline-flex items-center gap-1.5 text-muted dark:text-muted-dark">
            <Flag className="h-3.5 w-3.5" /> {t("rides.report")}
          </button>
        )}
      </div>

      <ShareCardSheet
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        data={cardOpen ? rideEventCard(ev, defaultBike, t, i18n.language) : null}
        fileName={`garajim-${ev.code}`}
        url={inviteUrl(ev.code)}
      />
    </div>
  );
}

function rsvpError(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    const code = (e.body as { error?: string } | undefined)?.error;
    if (code === "ride_full") return t("rides.full");
    if (code === "ride_cancelled") return t("rides.status.cancelled");
  }
  return t("errors.generic");
}

function RsvpControl({
  ev,
  busy,
  full,
  onSet,
}: {
  ev: RideEvent;
  busy: boolean;
  full: boolean;
  onSet: (s: RsvpStatus) => void;
}) {
  const { t } = useTranslation();
  const opt = (s: RsvpStatus, label: string) => {
    const on = ev.myStatus === s;
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={busy || (s === "going" && full)}
        onClick={() => onSet(s)}
        className={cn(
          "flex min-h-[52px] items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50",
          on
            ? s === "going"
              ? "bg-accent text-black shadow-ignite"
              : "bg-text text-bg dark:bg-text-dark dark:text-bg-dark"
            : "border border-border bg-surface dark:border-border-dark dark:bg-surface-dark",
        )}
      >
        {on && <Check className="h-4 w-4" />} {label}
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[2fr_1fr] gap-2">
        {opt("going", ev.myStatus === "going" ? t("rides.rsvp.goingOn") : t("rides.rsvp.going"))}
        {opt("maybe", t("rides.rsvp.maybe"))}
      </div>
      {full && <p className="text-center text-[12.5px] text-muted dark:text-muted-dark">{t("rides.full")}</p>}
    </div>
  );
}

function BikePicker({
  bikes,
  selectedName,
  onPick,
}: {
  bikes: Bike[];
  selectedName: string | null;
  onPick: (b: Bike) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">{t("rides.bringing")}</span>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {bikes.map((b) => {
          const label = [b.make, b.model].filter(Boolean).join(" ") || b.nickname;
          const on = selectedName === label;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onPick(b)}
              aria-pressed={on}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl border p-1.5 pr-3 text-[13px] font-medium transition",
                on ? "border-accent bg-accent/10" : "border-border dark:border-border-dark",
              )}
            >
              <VehicleAvatar vehicle={b} size="thumb" className="h-9 w-12 rounded-lg" />
              {b.nickname}
            </button>
          );
        })}
      </div>
    </div>
  );
}
