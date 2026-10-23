import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Copy,
  Flame,
  Loader2,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  Share2,
  ShieldAlert,
  Siren,
  Trash2,
  Truck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormRow } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { BackLink } from "@/components/BackLink";
import { useConfirm } from "@/components/ConfirmSheet";
import { useAddSosContact, useDeleteSosContact, useMechanics, useSosContacts } from "@/hooks/useAssistant";
import { getCurrentFix, type Fix } from "@/lib/currentPosition";
import { locationShareUrl, smsHref, telHref, whatsappHref } from "@/lib/contact";
import { hapticHeavy, hapticSuccess, hapticTap } from "@/lib/haptics";
import { friendlyError } from "@/lib/apiError";
import { pushToast } from "@/hooks/useToast";
import { track } from "@/lib/telemetry";
import { cn } from "@/lib/cn";
import { MAX_SOS_CONTACTS } from "@mototracker/shared";

/** Turkey: 112 is the single emergency number; the others still connect. */
const EMERGENCY: { number: string; key: string; icon: LucideIcon; primary?: boolean }[] = [
  { number: "112", key: "emergency", icon: Siren, primary: true },
  { number: "155", key: "police", icon: ShieldAlert },
  { number: "156", key: "gendarmerie", icon: ShieldAlert },
  { number: "110", key: "fire", icon: Flame },
];

/**
 * When something goes wrong on the road: call for help, tell your people
 * exactly where you are, and know what to do next. Built to be usable with
 * shaking hands — big targets, one decision per tap.
 */
export function SosPage() {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const contacts = useSosContacts();
  const mechanics = useMechanics();
  const tow = (mechanics.data ?? []).filter((m) => m.phone && m.specialty === "tow").slice(0, 2);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const locate = async () => {
    hapticHeavy();
    setLocating(true);
    setLocError(null);
    try {
      const f = await getCurrentFix();
      setFix(f);
      hapticSuccess();
      track("sos_located", { accuracy: Math.round(f.accuracy) });
    } catch (e) {
      setLocError(t(`sos.locError.${(e as Error).message}`, { defaultValue: t("sos.locError.unavailable") }));
    } finally {
      setLocating(false);
    }
  };

  const message = fix ? t("sos.message", { url: locationShareUrl(fix.lat, fix.lng) }) : "";
  const phones = (contacts.data ?? []).map((c) => c.phone);

  return (
    <div className="flex flex-col gap-5">
      <BackLink to="/assistant" />
      <header>
        <div className="label-micro text-red-500">{t("sos.eyebrow")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{t("sos.title")}</h1>
      </header>

      {/* ── share my location ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl bg-red-600 p-5 text-white shadow-[0_12px_40px_-12px_rgba(220,38,38,0.6)]">
        {!reduce && !fix && (
          <motion.span
            aria-hidden
            className="absolute right-6 top-6 h-14 w-14 rounded-full bg-white/25"
            animate={{ scale: [1, 1.9], opacity: [0.6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div className="text-[19px] font-semibold leading-tight">{t("sos.shareTitle")}</div>
            <p className="mt-1 max-w-[30ch] text-[13px] text-white/85">{t("sos.shareSub")}</p>
          </div>
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white text-red-600">
            <MapPin className="h-7 w-7" />
          </span>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {!fix ? (
            <motion.div key="get" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Button
                size="lg"
                className="relative mt-4 h-14 w-full bg-white text-[16px] font-semibold text-red-600 hover:bg-white/90"
                onClick={() => void locate()}
                disabled={locating}
              >
                {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <MapPin className="h-5 w-5" />}
                {locating ? t("sos.locating") : t("sos.getLocation")}
              </Button>
              {locError && <p className="mt-2 text-[12.5px] text-white">{locError}</p>}
            </motion.div>
          ) : (
            <motion.div
              key="share"
              className="relative mt-4 flex flex-col gap-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="num rounded-xl bg-white/15 px-3 py-2 text-[12.5px]">
                {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} · ±{Math.round(fix.accuracy)} m
              </div>
              {phones.length > 0 && (
                <Button asChild size="lg" className="h-12 w-full bg-white font-semibold text-red-600 hover:bg-white/90">
                  <a href={smsHref(phones, message)} onClick={() => track("sos_sms", { n: phones.length })}>
                    <MessageSquare className="h-5 w-5" /> {t("sos.smsContacts", { count: phones.length })}
                  </a>
                </Button>
              )}
              <div className="grid grid-cols-3 gap-2">
                <ShareAction
                  icon={Share2}
                  label={t("common.share")}
                  onClick={async () => {
                    hapticTap();
                    if (navigator.share) {
                      try {
                        await navigator.share({ text: message });
                      } catch {
                        /* dismissed */
                      }
                    } else await copy(message, t);
                  }}
                />
                {phones[0] && whatsappHref(phones[0]) ? (
                  <ShareAction icon={MessageCircle} label="WhatsApp" href={whatsappHref(phones[0], message)!} />
                ) : (
                  <ShareAction icon={MessageCircle} label="WhatsApp" href={`https://wa.me/?text=${encodeURIComponent(message)}`} />
                )}
                <ShareAction icon={Copy} label={t("sos.copy")} onClick={() => void copy(message, t)} />
              </div>
              <button type="button" onClick={() => void locate()} className="mt-1 self-center text-[12.5px] text-white/80 underline underline-offset-4">
                {t("sos.refresh")}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── call ──────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="label-micro text-muted dark:text-muted-dark">{t("sos.call")}</h2>
        <div className="grid grid-cols-2 gap-2">
          {EMERGENCY.map(({ number, key, icon: Icon, primary }) => (
            <motion.a
              key={number}
              href={telHref(number)}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                hapticHeavy();
                track("sos_call", { number });
              }}
              className={cn(
                "flex items-center gap-3 rounded-2xl p-3.5 ring-1",
                primary
                  ? "col-span-2 bg-red-500/10 text-red-600 ring-red-500/40 dark:text-red-400"
                  : "bg-surface ring-border dark:bg-surface-elev-dark dark:ring-border-dark",
              )}
            >
              <span className={cn("grid h-11 w-11 place-items-center rounded-xl", primary ? "bg-red-600 text-white" : "bg-bg dark:bg-bg-dark")}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="num text-[20px] font-bold leading-none">{number}</div>
                <div className="mt-1 text-[12.5px] opacity-80">{t(`sos.numbers.${key}`)}</div>
              </div>
              <Phone className="h-4 w-4 opacity-60" />
            </motion.a>
          ))}
          {tow.map((m) => (
            <a
              key={m.id}
              href={telHref(m.phone!)}
              className="col-span-2 flex items-center gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-accent-dim dark:text-accent">
                <Truck className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{m.name}</div>
                <div className="text-[12.5px] text-muted dark:text-muted-dark">{t(`mechanics.specialty.${m.specialty}`)}</div>
              </div>
              <Phone className="h-4 w-4 text-muted" />
            </a>
          ))}
        </div>
      </section>

      <ContactsCard />
      <AccidentChecklist />
    </div>
  );
}

async function copy(text: string, t: (k: string) => string) {
  try {
    await navigator.clipboard.writeText(text);
    pushToast({ variant: "success", title: t("sos.copied") });
  } catch {
    /* clipboard unavailable — nothing sensible to do */
  }
}

function ShareAction({ icon: Icon, label, onClick, href }: { icon: LucideIcon; label: string; onClick?: () => void; href?: string }) {
  const cls = "flex flex-col items-center gap-1 rounded-xl bg-white/15 py-2.5 text-[12px] font-medium text-white active:scale-95 transition";
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      <Icon className="h-5 w-5" /> {label}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      <Icon className="h-5 w-5" /> {label}
    </button>
  );
}

function ContactsCard() {
  const { t } = useTranslation();
  const contacts = useSosContacts();
  const add = useAddSosContact();
  const del = useDeleteSosContact();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const list = contacts.data ?? [];

  return (
    <Card>
      <CardContent className="gap-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[15px] font-semibold">{t("sos.contacts")}</div>
            <div className="text-[12.5px] text-muted dark:text-muted-dark">{t("sos.contactsSub")}</div>
          </div>
          {list.length < MAX_SOS_CONTACTS && !adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" />
            </Button>
          )}
        </div>
        {list.map((c) => (
          <div key={c.id} className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-surface text-[13px] font-semibold dark:bg-surface-elev-dark">
              {c.name.slice(0, 1).toLocaleUpperCase("tr")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium">{c.name}</div>
              <div className="num text-[12px] text-muted dark:text-muted-dark">{c.phone}</div>
            </div>
            <a href={telHref(c.phone)} aria-label={t("common.call")} className="grid h-9 w-9 place-items-center rounded-full bg-accent text-black">
              <Phone className="h-4 w-4" />
            </a>
            <button
              type="button"
              aria-label={t("common.delete")}
              onClick={async () => {
                if (await confirm({ title: t("sos.removeConfirm", { name: c.name }), confirmLabel: t("common.delete"), destructive: true }))
                  del.mutate(c.id);
              }}
              className="grid h-9 w-9 place-items-center rounded-full text-muted dark:text-muted-dark"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {list.length === 0 && !adding && (
          <Button variant="accent" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("sos.addContact")}
          </Button>
        )}
        {adding && (
          <form
            className="flex flex-col gap-3 rounded-2xl bg-surface p-3 dark:bg-surface-elev-dark"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await add.mutateAsync({ name: name.trim(), phone: phone.trim() });
                setName("");
                setPhone("");
                setAdding(false);
              } catch (err) {
                pushToast({ variant: "danger", title: friendlyError(err, t) });
              }
            }}
          >
            <FormRow>
              <Field label={t("sos.contactName")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
              </Field>
              <Field label={t("mechanics.phone")}>
                <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </FormRow>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="accent" className="flex-1" disabled={!name.trim() || phone.trim().length < 3 || add.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function AccidentChecklist() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const steps = t("sos.accident.steps", { returnObjects: true }) as string[];
  return (
    <Card>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 p-5 text-left">
        <div>
          <div className="text-[15px] font-semibold">{t("sos.accident.title")}</div>
          <div className="text-[12.5px] text-muted dark:text-muted-dark">{t("sos.accident.sub")}</div>
        </div>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden px-5"
          >
            {Array.isArray(steps) &&
              steps.map((s, i) => (
                <li key={i} className="flex gap-3 pb-3 text-[13.5px] leading-relaxed">
                  <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[12px] font-bold text-black">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </Card>
  );
}
