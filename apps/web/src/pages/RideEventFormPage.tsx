import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import {
  RIDE_EVENT_KINDS,
  RIDE_PACES,
  type RideEventInput,
  type RideEventKind,
  type RideEventPlace,
  type RidePace,
  type RideEvent,
} from "@mototracker/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/BackLink";
import { PlaceField } from "@/components/ride/PlaceField";
import { useCreateRideEvent, useRideEvent, useUpdateRideEvent } from "@/hooks/useRideEvents";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { hapticSuccess } from "@/lib/haptics";
import { track } from "@/lib/telemetry";
import { cn } from "@/lib/cn";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Today, tomorrow and the coming weekend — where most rides land. */
function quickDays(lang: string): { label: string; date: string }[] {
  const out: { label: string; date: string }[] = [];
  const today = new Date();
  const add = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d;
  };
  out.push({ label: "today", date: ymd(today) });
  out.push({ label: "tomorrow", date: ymd(add(1)) });
  for (const target of [6, 0]) {
    const n = (target - today.getDay() + 7) % 7;
    if (n > 1) {
      out.push({
        label: new Intl.DateTimeFormat(lang, { weekday: "long" }).format(add(n)),
        date: ymd(add(n)),
      });
    }
  }
  return out;
}

/**
 * Plan a ride: what, when, where to meet. Everything else is optional and
 * folded away — a ride is planned in four taps and a name.
 */
export function RideEventFormPage() {
  const { code } = useParams();
  const editing = !!code;
  const existing = useRideEvent(code);
  if (editing && existing.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  return <RideForm key={existing.data?.id ?? "new"} initial={editing ? existing.data ?? null : null} />;
}

function RideForm({ initial }: { initial: RideEvent | null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateRideEvent();
  const update = useUpdateRideEvent(initial?.id ?? "");

  const start = initial ? new Date(initial.startsAt) : (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  })();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(ymd(start));
  const [time, setTime] = useState(hm(start));
  const [meet, setMeet] = useState<RideEventPlace | null>(initial?.meet ?? null);
  const [dest, setDest] = useState<RideEventPlace | null>(initial?.destination ?? null);
  const [pace, setPace] = useState<RidePace>(initial?.pace ?? "relaxed");
  const [kind, setKind] = useState<RideEventKind>(initial?.vehicleKind ?? "any");
  const [more, setMore] = useState(!!(initial?.note || initial?.distanceKm || initial?.maxRiders));
  const [note, setNote] = useState(initial?.note ?? "");
  const [distance, setDistance] = useState(initial?.distanceKm ? String(initial.distanceKm) : "");
  const [maxRiders, setMaxRiders] = useState(initial?.maxRiders ? String(initial.maxRiders) : "");
  const [tried, setTried] = useState(false);

  const days = useMemo(() => quickDays(i18n.language), [i18n.language]);
  const suggestions = t("rides.form.suggestions", { returnObjects: true }) as string[];

  const when = new Date(`${date}T${time || "09:00"}`);
  const inPast = when.getTime() < Date.now() - 5 * 60_000 && (!initial || when.toISOString() !== new Date(initial.startsAt).toISOString());
  const errors = {
    title: title.trim().length < 2 ? t("rides.form.titleRequired") : undefined,
    meet: !meet || meet.name.trim().length < 2 ? t("rides.form.meetRequired") : undefined,
    when: !date || !time || Number.isNaN(when.getTime()) ? t("rides.form.whenRequired") : inPast ? t("rides.form.inPast") : undefined,
  };
  const valid = !errors.title && !errors.meet && !errors.when;
  const busy = create.isPending || update.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid) return;
    const input: RideEventInput = {
      title: title.trim(),
      note: note.trim() || null,
      startsAt: when.toISOString(),
      meet: meet!,
      destination: dest,
      distanceKm: distance ? Number(distance.replace(",", ".")) || null : null,
      pace,
      vehicleKind: kind,
      maxRiders: maxRiders ? Math.max(2, Number(maxRiders) || 0) || null : null,
    };
    try {
      const ev = initial ? await update.mutateAsync(input) : await create.mutateAsync(input);
      hapticSuccess();
      if (!initial) track("ride_planned");
      if (ev) navigate(`/rides/${ev.code}${initial ? "" : "?created=1"}`, { replace: true });
    } catch (err) {
      pushToast({ variant: "danger", title: friendlyError(err, t) });
    }
  };

  const chip = (active: boolean) =>
    cn(
      "min-h-[40px] rounded-full border px-3.5 text-[13.5px] font-medium transition active:scale-95",
      active
        ? "border-transparent bg-text text-bg dark:bg-text-dark dark:text-bg-dark"
        : "border-border text-text hover:bg-surface dark:border-border-dark dark:text-text-dark dark:hover:bg-surface-elev-dark",
    );

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" noValidate>
      <BackLink to={initial ? `/rides/${initial.code}` : "/rides"} />
      <header>
        <div className="label-micro text-muted dark:text-muted-dark">{t("rides.eyebrow")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">
          {initial ? t("rides.form.editTitle") : t("rides.form.newTitle")}
        </h1>
      </header>

      <Field label={t("rides.form.title")} error={tried ? errors.title : undefined}>
        <Input
          value={title}
          maxLength={80}
          placeholder={suggestions[0]}
          enterKeyHint="next"
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      {!initial && !title && (
        <div className="-mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" className={chip(false)} onClick={() => setTitle(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">{t("rides.form.when")}</span>
        <div className="flex flex-wrap gap-2">
          {days.map((d) => (
            <button key={d.date} type="button" className={chip(date === d.date)} onClick={() => setDate(d.date)}>
              {d.label === "today" ? t("rides.form.today") : d.label === "tomorrow" ? t("rides.form.tomorrow") : d.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input type="date" className="num" value={date} min={ymd(new Date())} onChange={(e) => setDate(e.target.value)} aria-label={t("rides.form.date")} />
          <Input type="time" className="num w-[120px]" value={time} step={300} onChange={(e) => setTime(e.target.value)} aria-label={t("rides.form.time")} />
        </div>
        {tried && errors.when && <p className="text-[12.5px] text-danger">{errors.when}</p>}
      </div>

      <Field label={t("rides.form.meet")} error={tried ? errors.meet : undefined}>
        <PlaceField value={meet} onChange={setMeet} placeholder={t("rides.form.meetPlaceholder")} />
      </Field>

      <Field label={t("rides.form.destination")} optional>
        <PlaceField value={dest} onChange={setDest} placeholder={t("rides.form.destinationPlaceholder")} allowLocate={false} />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">{t("rides.form.pace")}</span>
        <div className="flex flex-wrap gap-2">
          {RIDE_PACES.map((p) => (
            <button key={p} type="button" className={chip(pace === p)} onClick={() => setPace(p)}>
              {t(`rides.pace.${p}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">{t("rides.form.who")}</span>
        <div className="flex flex-wrap gap-2">
          {RIDE_EVENT_KINDS.map((k) => (
            <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>
              {t(`rides.kind.${k}`)}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        className="flex items-center gap-1.5 self-start text-[13.5px] font-medium text-muted dark:text-muted-dark"
        aria-expanded={more}
      >
        <ChevronDown className={cn("h-4 w-4 transition", more && "rotate-180")} /> {t("rides.form.more")}
      </button>
      {more && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("rides.form.distance")} optional>
              <Input inputMode="decimal" className="num" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="120" />
            </Field>
            <Field label={t("rides.form.maxRiders")} optional>
              <Input inputMode="numeric" className="num" value={maxRiders} onChange={(e) => setMaxRiders(e.target.value.replace(/\D/g, ""))} placeholder="—" />
            </Field>
          </div>
          <Field label={t("rides.form.note")} optional>
            <Textarea value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} placeholder={t("rides.form.notePlaceholder")} />
          </Field>
        </div>
      )}

      <div className="sticky bottom-[var(--tabbar-h)] z-10 -mx-1 flex gap-2 bg-gradient-to-t from-bg via-bg/95 to-transparent px-1 pb-2 pt-4 dark:from-bg-dark dark:via-bg-dark/95 md:bottom-4">
        <Button asChild variant="outline" size="lg" className="flex-1">
          <Link to={initial ? `/rides/${initial.code}` : "/rides"}>{t("common.cancel")}</Link>
        </Button>
        <Button type="submit" variant="accent" size="lg" className="flex-[2]" disabled={busy}>
          {busy ? t("common.saving") : initial ? t("common.save") : t("rides.form.create")}
        </Button>
      </div>
    </form>
  );
}
