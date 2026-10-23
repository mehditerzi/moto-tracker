import { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { MapPin, MessageCircle, Navigation2, Pencil, Phone, Plus, Star, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/share/ShareSheet";
import { BackLink } from "@/components/BackLink";
import { ErrorState } from "@/components/ErrorState";
import { StaggerItem } from "@/components/motion/Stagger";
import { useConfirm } from "@/components/ConfirmSheet";
import { useDeleteMechanic, useMechanics, useSaveMechanic } from "@/hooks/useAssistant";
import { mapsHref, telHref, whatsappHref } from "@/lib/contact";
import { hapticSelection, hapticTap } from "@/lib/haptics";
import { friendlyError } from "@/lib/apiError";
import { pushToast } from "@/hooks/useToast";
import { track } from "@/lib/telemetry";
import { cn } from "@/lib/cn";
import { MECHANIC_SPECIALTIES, type Mechanic, type MechanicSpecialty } from "@mototracker/shared";

/** Prefill handed over from the nearby map ("save this garage"). */
export interface MechanicDraft {
  name: string;
  phone?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  specialty?: MechanicSpecialty;
}

export function MechanicsPage() {
  const { t } = useTranslation();
  const list = useMechanics();
  const [editing, setEditing] = useState<{ mechanic?: Mechanic } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <BackLink to="/assistant" />
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label-micro text-muted dark:text-muted-dark">{t("nav.assistant")}</div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{t("mechanics.title")}</h1>
        </div>
        <Button size="sm" variant="accent" onClick={() => setEditing({})}>
          <Plus className="h-4 w-4" /> {t("common.add")}
        </Button>
      </header>
      <p className="-mt-1 text-[13.5px] leading-relaxed text-muted dark:text-muted-dark">{t("mechanics.subtitle")}</p>

      {list.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : (list.data?.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center dark:border-border-dark">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-surface dark:bg-surface-elev-dark">
            <Wrench className="h-6 w-6 text-muted dark:text-muted-dark" />
          </div>
          <div className="text-[15px] font-semibold">{t("mechanics.empty")}</div>
          <p className="max-w-[34ch] text-[13px] text-muted dark:text-muted-dark">{t("mechanics.emptySub")}</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button variant="accent" onClick={() => setEditing({})}>
              <Plus className="h-4 w-4" /> {t("mechanics.add")}
            </Button>
            <Button asChild variant="outline">
              <Link to="/nearby?c=service">
                <MapPin className="h-4 w-4" /> {t("mechanics.findNearby")}
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {list.data!.map((m, i) => (
              <StaggerItem key={m.id} index={i}>
                <MechanicCard mechanic={m} onEdit={() => setEditing({ mechanic: m })} />
              </StaggerItem>
            ))}
          </AnimatePresence>
        </div>
      )}

      <MechanicSheet
        open={!!editing}
        mechanic={editing?.mechanic}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("tr"))
    .join("");
}

function MechanicCard({ mechanic: m, onEdit }: { mechanic: Mechanic; onEdit: () => void }) {
  const { t } = useTranslation();
  const save = useSaveMechanic();
  const wa = m.phone ? whatsappHref(m.phone, t("mechanics.waGreeting")) : null;
  const hasPlace = (m.lat != null && m.lng != null) || !!m.address;
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-[14px] font-bold text-accent-dim dark:text-accent">
          {initials(m.name) || <Wrench className="h-5 w-5" />}
        </div>
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[15.5px] font-semibold">{m.name}</div>
          <div className="mt-0.5 text-[12.5px] text-muted dark:text-muted-dark">
            {t(`mechanics.specialty.${m.specialty}`)}
            {m.address ? ` · ${m.address}` : ""}
          </div>
        </button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.8 }}
          aria-pressed={m.favorite}
          aria-label={t("mechanics.favorite")}
          onClick={() => {
            hapticTap();
            save.mutate({ id: m.id, favorite: !m.favorite });
          }}
          className="-mr-1 -mt-1 grid h-9 w-9 place-items-center rounded-full"
        >
          <Star className={cn("h-5 w-5 transition", m.favorite ? "fill-amber-400 text-amber-400" : "text-muted dark:text-muted-dark")} />
        </motion.button>
      </div>
      <div className="mt-3 flex gap-2">
        {m.phone && (
          <Button asChild size="sm" variant="accent" className="flex-1">
            <a href={telHref(m.phone)} onClick={() => track("mechanic_called", {})}>
              <Phone className="h-4 w-4" /> {t("common.call")}
            </a>
          </Button>
        )}
        {wa && (
          <Button asChild size="sm" variant="outline" className="flex-1">
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          </Button>
        )}
        {hasPlace && (
          <Button asChild size="sm" variant="outline" className="flex-1">
            <a
              href={mapsHref({ lat: m.lat, lng: m.lng, query: m.address ?? m.name, directions: true })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Navigation2 className="h-4 w-4" /> {t("common.directions")}
            </a>
          </Button>
        )}
        {!m.phone && !hasPlace && (
          <Button size="sm" variant="outline" className="flex-1" onClick={onEdit}>
            <Pencil className="h-4 w-4" /> {t("mechanics.addPhone")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function MechanicSheet({
  open,
  mechanic,
  draft,
  onClose,
}: {
  open: boolean;
  mechanic?: Mechanic;
  draft?: MechanicDraft;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose} title={mechanic ? t("mechanics.edit") : t("mechanics.add")}>
      {open && <MechanicForm key={mechanic?.id ?? draft?.name ?? "new"} mechanic={mechanic} draft={draft} onDone={onClose} />}
    </Sheet>
  );
}

function MechanicForm({ mechanic, draft, onDone }: { mechanic?: Mechanic; draft?: MechanicDraft; onDone: () => void }) {
  const { t } = useTranslation();
  const save = useSaveMechanic();
  const del = useDeleteMechanic();
  const confirm = useConfirm();
  const src = mechanic ?? draft;
  const [name, setName] = useState(src?.name ?? "");
  const [phone, setPhone] = useState(src?.phone ?? "");
  const [address, setAddress] = useState(src?.address ?? "");
  const [notes, setNotes] = useState(mechanic?.notes ?? "");
  const [specialty, setSpecialty] = useState<MechanicSpecialty>(src?.specialty ?? "general");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        try {
          await save.mutateAsync({
            id: mechanic?.id,
            name: name.trim(),
            specialty,
            phone: phone.trim() || null,
            address: address.trim() || null,
            notes: notes.trim() || null,
            lat: src?.lat ?? null,
            lng: src?.lng ?? null,
          });
          track(mechanic ? "mechanic_updated" : "mechanic_added", { fromMap: !!draft });
          pushToast({ variant: "success", title: t("mechanics.saved") });
          onDone();
        } catch (err) {
          pushToast({ variant: "danger", title: friendlyError(err, t) });
        }
      }}
    >
      <Field label={t("mechanics.name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t("mechanics.namePh")} autoFocus={!src} />
      </Field>
      <div role="radiogroup" aria-label={t("mechanics.specialtyLabel")} className="flex flex-wrap gap-1.5">
        {MECHANIC_SPECIALTIES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === specialty}
            onClick={() => {
              if (s !== specialty) hapticSelection();
              setSpecialty(s);
            }}
            className={cn(
              "rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 transition",
              s === specialty
                ? "bg-accent text-black ring-accent"
                : "bg-surface ring-border dark:bg-surface-elev-dark dark:ring-border-dark",
            )}
          >
            {t(`mechanics.specialty.${s}`)}
          </button>
        ))}
      </div>
      <Field label={t("mechanics.phone")} optional>
        <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0532 123 45 67" />
      </Field>
      <Field label={t("mechanics.address")} optional>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
      </Field>
      <Field label={t("mechanics.notes")} optional>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder={t("mechanics.notesPh")} />
      </Field>
      <div className="flex gap-2">
        {mechanic && (
          <Button
            type="button"
            variant="outline"
            className="text-danger"
            disabled={del.isPending}
            onClick={async () => {
              const ok = await confirm({ title: t("mechanics.deleteConfirm"), confirmLabel: t("common.delete"), destructive: true });
              if (!ok) return;
              await del.mutateAsync(mechanic.id);
              onDone();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        <Button type="submit" size="lg" variant="accent" className="flex-1" disabled={!name.trim() || save.isPending}>
          {save.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
