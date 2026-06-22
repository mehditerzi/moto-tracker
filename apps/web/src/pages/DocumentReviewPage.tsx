import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2, AlertTriangle, FileText, X, Pencil, Check, Plus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDocument } from "@/hooks/useDocuments";
import { useBike, useUpdateBike, useCreateBike } from "@/hooks/useBikes";
import { useCreateDatedItem } from "@/hooks/useDatedItems";
import { pushToast } from "@/hooks/useToast";
import { ScanFrame } from "@/pages/DocumentCapturePage";
import { env } from "@/env";
import type { Bike } from "@mototracker/shared";

// ─── page shell ──────────────────────────────────────────────────────────────

export function DocumentReviewPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const doc = useDocument(id, { pollWhilePending: true });

  // Slow-network hint: after 20 s of pending, show a "taking longer" message.
  // Hooks must be unconditional — declared before any early return.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (doc.data?.ocrStatus !== "pending") {
      setSlow(false);
      return;
    }
    const timerId = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timerId);
  }, [doc.data?.ocrStatus]);

  if (!id) return null;
  if (doc.isLoading || !doc.data)
    return <p className="text-center text-muted dark:text-muted-dark">{t("common.loading")}</p>;

  const d = doc.data;
  const fileUrl = `${env.VITE_API_URL}/api/documents/${d.id}/file`;

  if (d.ocrStatus === "pending") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{t("review.reading")}</CardTitle>
            <CardDescription>{t("review.readingSub")}</CardDescription>
          </CardHeader>
          <CardContent><ScanFrame src={fileUrl} active /></CardContent>
        </Card>
        <div className="mt-4 flex flex-col items-center gap-3 text-center">
          <Link to="/dashboard" className="text-sm text-muted underline dark:text-muted-dark">
            {t("common.back")}
          </Link>
          {slow && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-muted dark:text-muted-dark">{t("review.stillWorking")}</p>
              <Link to="/capture" className="text-sm underline text-accent">
                {t("review.retry")}
              </Link>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  if (d.ocrStatus === "failed") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2 text-danger">
                <AlertTriangle className="h-5 w-5" /> {t("review.failedTitle")}
              </span>
            </CardTitle>
            <CardDescription>{t("review.failedSub")}</CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <p className="text-sm text-muted dark:text-muted-dark">{d.ocrError ?? t("common.error")}</p>
            <div className="flex gap-2">
              <Button asChild variant="accent" className="flex-1"><Link to="/capture">{t("review.retry")}</Link></Button>
              <Button asChild variant="outline" className="flex-1"><Link to="/dashboard">{t("review.manualEntry")}</Link></Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  const ex = d.ocrExtracted;
  if (!ex) return <Link to="/dashboard" className="block text-center text-sm underline">{t("review.close")}</Link>;

  const isRuhsat = ex.docType === "ruhsat";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col gap-3"
    >
      <div className="overflow-hidden rounded-2xl border border-border dark:border-border-dark">
        <img src={fileUrl} alt="" className="block h-44 w-full object-cover" />
      </div>

      {isRuhsat ? (
        <RuhsatReviewForm
          bikeId={d.bikeId ?? undefined}
          extracted={{
            plate: ex.plate ?? "",
            make: ex.make ?? "",
            model: ex.model ?? "",
            year: ex.year != null ? String(ex.year) : "",
            chassisNo: ex.chassisNo ?? "",
            engineNo: ex.engineNo ?? "",
            cylinderCc: ex.cylinderCc != null ? String(ex.cylinderCc) : "",
          }}
          muayeneDate={ex.dates?.muayeneExpiresOn ?? null}
          confidence={ex.confidence}
        />
      ) : (
        <DateDocReviewForm
          bikeId={d.bikeId ?? undefined}
          docType={ex.docType as "sigorta" | "kasko" | "muayene" | "unknown"}
          plate={ex.plate}
          dates={ex.dates}
          appliedDatedItemId={d.appliedDatedItemId ?? null}
          confidence={ex.confidence}
        />
      )}
    </motion.div>
  );
}

// ─── types ────────────────────────────────────────────────────────────────────

interface ExtractedBikeFields {
  plate: string;
  make: string;
  model: string;
  year: string;
  chassisNo: string;
  engineNo: string;
  cylinderCc: string;
}

type FieldKey = keyof ExtractedBikeFields;
const FIELD_KEYS: FieldKey[] = ["plate", "make", "model", "year", "chassisNo", "engineNo", "cylinderCc"];

/** Below this OCR confidence, nudge the user to double-check every value. */
const LOW_CONFIDENCE = 0.7;

function bikeToFields(bike: Bike): ExtractedBikeFields {
  return {
    plate: bike.plate ?? "",
    make: bike.make ?? "",
    model: bike.model ?? "",
    year: bike.year != null ? String(bike.year) : "",
    chassisNo: bike.chassisNo ?? "",
    engineNo: bike.engineNo ?? "",
    cylinderCc: bike.cylinderCc != null ? String(bike.cylinderCc) : "",
  };
}

// ─── ruhsat form ──────────────────────────────────────────────────────────────

function RuhsatReviewForm({
  bikeId, extracted, muayeneDate, confidence,
}: {
  bikeId?: string;
  extracted: ExtractedBikeFields;
  muayeneDate: string | null;
  confidence: number;
}) {
  const { t } = useTranslation();
  const bike = useBike(bikeId);
  const update = useUpdateBike(bikeId ?? "");
  const create = useCreateBike();
  const [saved, setSaved] = useState(false);
  const [createdBikeId, setCreatedBikeId] = useState<string | null>(null);
  const [nickname, setNickname] = useState(extracted.plate || extracted.make || "");
  const [showNicknameInput, setShowNicknameInput] = useState(false);

  const [values, setValues] = useState<ExtractedBikeFields>(extracted);
  const [accepted, setAccepted] = useState<Record<FieldKey, boolean>>(() => {
    const init = {} as Record<FieldKey, boolean>;
    for (const k of FIELD_KEYS) init[k] = extracted[k] !== "";
    return init;
  });

  const existingBike = bike.data;
  const hasComparison = !!existingBike;
  const hasAnyAccepted = FIELD_KEYS.some((k) => accepted[k] && values[k] !== "");
  const effectiveBikeId = bikeId ?? createdBikeId ?? undefined;

  const buildPatch = () => {
    const patch: Record<string, unknown> = {};
    for (const k of FIELD_KEYS) {
      if (!accepted[k] || values[k] === "") continue;
      const v = k === "year" || k === "cylinderCc" ? Number(values[k]) || null : values[k] || null;
      if (v != null) patch[k] = v;
    }
    return patch;
  };

  const onApply = async () => {
    if (!bikeId) return;
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      pushToast({ variant: "default", title: t("review.nothingToApply") });
      return;
    }
    try {
      await update.mutateAsync(patch as any);
      setSaved(true);
      pushToast({ variant: "success", title: t("bike.updated") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: String(e) });
    }
  };

  const onCreateBike = async () => {
    if (!nickname.trim()) { setShowNicknameInput(true); return; }
    const patch = buildPatch();
    try {
      const newBike = await create.mutateAsync({
        nickname: nickname.trim(),
        plate:      (patch.plate      as string | undefined) || undefined,
        make:       (patch.make       as string | undefined) || undefined,
        model:      (patch.model      as string | undefined) || undefined,
        year:       (patch.year       as number | undefined) || undefined,
        chassisNo:  (patch.chassisNo  as string | undefined) || undefined,
        engineNo:   (patch.engineNo   as string | undefined) || undefined,
        cylinderCc: (patch.cylinderCc as number | undefined) || undefined,
      });
      setCreatedBikeId(newBike.id);
      setSaved(true);
      pushToast({ variant: "success", title: t("bike.added") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: String(e) });
    }
  };

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <FileText className="h-5 w-5" />
          {hasComparison ? t("review.compareTitle") : t("review.ruhsatTitle")}
        </CardTitle>
        <CardDescription>
          {hasComparison ? t("review.compareSub") : t("review.ruhsatSub")}
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        {bike.isLoading && bikeId && (
          <p className="text-center text-sm text-muted dark:text-muted-dark">{t("common.loading")}</p>
        )}

        {confidence < LOW_CONFIDENCE && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs">{t("review.lowConfidence")}</p>
          </div>
        )}

        <ul className="grid gap-2">
          {FIELD_KEYS.map((key) => {
            const ocrVal = extracted[key];
            const existingVal = existingBike ? bikeToFields(existingBike)[key] : null;
            // Show every field, even empty ones, so the user can fill in
            // anything OCR couldn't read.
            return (
              <CompareFieldRow
                key={key}
                label={t(`review.${key}` as any)}
                ocrValue={ocrVal}
                existingValue={existingVal}
                currentValue={values[key]}
                accepted={accepted[key]}
                hasComparison={hasComparison}
                onAcceptChange={(v) => setAccepted((s) => ({ ...s, [key]: v }))}
                onValueChange={(v) => {
                  setValues((s) => ({ ...s, [key]: v }));
                  if (v.trim() !== "") setAccepted((a) => ({ ...a, [key]: true }));
                }}
              />
            );
          })}
        </ul>
        <p className="text-xs text-muted dark:text-muted-dark">{t("review.missingHint")}</p>

        <p className="text-right text-xs text-muted dark:text-muted-dark">
          {t("review.confidence")}: {Math.round(confidence * 100)}%
        </p>

        {!bikeId && !saved && showNicknameInput && (
          <Input
            placeholder={t("bike.nickname")}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoFocus
          />
        )}

        <div className="flex gap-2">
          {saved ? (
            <Button asChild variant="accent" className="flex-1">
              <Link to="/dashboard"><CheckCircle2 className="mr-1 h-4 w-4" />{t("common.save")}</Link>
            </Button>
          ) : bikeId ? (
            <Button onClick={onApply} variant="accent" disabled={update.isPending || !hasAnyAccepted} className="flex-1">
              {t("review.applySelected")}
            </Button>
          ) : (
            <Button onClick={onCreateBike} variant="accent" disabled={create.isPending || !hasAnyAccepted} className="flex-1">
              <Plus className="mr-1 h-4 w-4" />{t("review.createBike")}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link to="/dashboard"><X className="h-4 w-4" /></Link>
          </Button>
        </div>
      </CardContent>
    </Card>

      {effectiveBikeId && (
        <ReminderDatesPanel bikeId={effectiveBikeId} initialMuayene={muayeneDate} />
      )}
    </>
  );
}

// ─── reminder dates panel ─────────────────────────────────────────────────────

const REMINDER_TYPES = ["muayene", "sigorta", "kasko"] as const;
type ReminderType = (typeof REMINDER_TYPES)[number];

/**
 * Post-scan prompt for the expiry dates a ruhsat doesn't reliably carry. The
 * inspection date is pre-filled when OCR found it; sigorta/kasko start empty so
 * the user can add what wasn't on the document. Each saves independently.
 */
function ReminderDatesPanel({
  bikeId,
  initialMuayene,
}: {
  bikeId: string;
  initialMuayene: string | null;
}) {
  const { t } = useTranslation();
  const create = useCreateDatedItem(bikeId);
  const [dates, setDates] = useState<Record<ReminderType, string>>({
    muayene: initialMuayene ?? "",
    sigorta: "",
    kasko: "",
  });
  const [savedTypes, setSavedTypes] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<ReminderType | null>(null);

  const add = async (type: ReminderType) => {
    const expiresOn = dates[type];
    if (!expiresOn) return;
    setPending(type);
    try {
      await create.mutateAsync({ type, expiresOn });
      setSavedTypes((s) => ({ ...s, [type]: true }));
      pushToast({ variant: "success", title: t("review.dateAdded") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: String(e) });
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2 text-base">
          <Plus className="h-4 w-4" /> {t("review.addDatesTitle")}
        </CardTitle>
        <CardDescription>{t("review.addDatesSub")}</CardDescription>
      </CardHeader>
      <CardContent className="gap-2">
        {REMINDER_TYPES.map((type) => {
          const done = savedTypes[type];
          return (
            <div
              key={type}
              className="flex items-center gap-2 rounded-xl border border-border p-2.5 dark:border-border-dark"
            >
              <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted dark:text-muted-dark">
                {t(`items.${type}`)}
              </span>
              <input
                type="date"
                value={dates[type]}
                disabled={done}
                onChange={(e) => setDates((s) => ({ ...s, [type]: e.target.value }))}
                className="h-9 flex-1 rounded-lg border border-border bg-surface px-2 text-sm text-text transition focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60 dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
              {done ? (
                <span className="inline-flex items-center gap-1 px-2 text-xs text-success">
                  <Check className="h-4 w-4" /> {t("review.dateAdded")}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!dates[type] || pending === type}
                  onClick={() => void add(type)}
                >
                  {t("review.addDate")}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── compare field row ────────────────────────────────────────────────────────

function CompareFieldRow({
  label, ocrValue, existingValue, currentValue, accepted, hasComparison,
  onAcceptChange, onValueChange,
}: {
  label: string;
  ocrValue: string;
  existingValue: string | null;
  currentValue: string;
  accepted: boolean;
  hasComparison: boolean;
  onAcceptChange: (v: boolean) => void;
  onValueChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const isMatch  = hasComparison && !!existingValue && !!ocrValue && existingValue === ocrValue;
  const isDiff   = hasComparison && !!existingValue && !!ocrValue && existingValue !== ocrValue;
  // Anything that isn't a confident match/diff gets a plain, always-editable
  // input — including fields OCR left blank, so they can be filled in here.
  const isSimple = !isMatch && !isDiff;
  const displayVal = currentValue !== "" ? currentValue : existingValue ?? "";

  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-border p-3 text-sm dark:border-border-dark">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted dark:text-muted-dark">
        {label}
      </span>

      {isMatch && (
        <div className="flex items-center justify-between">
          <span className="font-medium">{ocrValue}</span>
          <Check className="h-4 w-4 text-success" />
        </div>
      )}

      {isSimple && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onAcceptChange(!accepted)}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
              accepted ? "border-accent bg-accent text-white" : "border-border dark:border-border-dark"
            }`}
          >
            {accepted && <Check className="h-3 w-3" />}
          </button>
          <Input
            value={displayVal}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={label}
            className="h-8 flex-1 text-sm"
          />
        </div>
      )}

      {isDiff && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => onAcceptChange(false)}
            className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
              !accepted ? "bg-surface-elev ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark" : "opacity-40"
            }`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
              {t("review.existing")}
            </span>
            <span className="font-medium">{existingValue}</span>
          </button>

          <button
            type="button"
            onClick={() => onAcceptChange(true)}
            className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
              accepted ? "bg-accent/10 ring-1 ring-accent/50 dark:bg-accent/15" : "opacity-40"
            }`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
              {t("review.fromOcr")}
            </span>
            <div className="flex items-center gap-1.5">
              {editing && accepted ? (
                <Input
                  value={currentValue}
                  onChange={(e) => { e.stopPropagation(); onValueChange(e.target.value); }}
                  onBlur={() => setEditing(false)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="h-7 w-28 text-right text-sm"
                />
              ) : (
                <span className="font-medium">{currentValue}</span>
              )}
              {accepted && (
                <button
                  type="button"
                  aria-label={t("items.edit")}
                  onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                  className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center"
                >
                  <Pencil className="h-3 w-3 text-accent" />
                </button>
              )}
            </div>
          </button>
        </div>
      )}
    </li>
  );
}

// ─── date-doc form ────────────────────────────────────────────────────────────

function DateDocReviewForm({
  bikeId, docType, plate, dates, appliedDatedItemId, confidence,
}: {
  bikeId?: string;
  docType: "sigorta" | "kasko" | "muayene" | "unknown";
  plate: string | null;
  dates: { sigortaExpiresOn?: string | null; kaskoExpiresOn?: string | null; muayeneExpiresOn?: string | null } | null;
  appliedDatedItemId: string | null;
  confidence: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const applied = !!appliedDatedItemId;

  const detectedDate =
    docType === "sigorta" ? (dates?.sigortaExpiresOn ?? null) :
    docType === "kasko"   ? (dates?.kaskoExpiresOn   ?? null) :
    docType === "muayene" ? (dates?.muayeneExpiresOn  ?? null) :
    (dates?.sigortaExpiresOn ?? dates?.kaskoExpiresOn ?? dates?.muayeneExpiresOn ?? null);

  const itemType = docType !== "unknown" ? docType : "sigorta";
  const [editedDate, setEditedDate] = useState(detectedDate ?? "");

  if (applied && appliedDatedItemId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" /> {t("review.appliedTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <div className="flex gap-2">
            <Button asChild variant="accent" className="flex-1">
              <Link to={`/dated-items/${appliedDatedItemId}`}>{t("review.goToRecord")}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/dashboard"><X className="h-4 w-4" /></Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const onApply = () => {
    if (!bikeId || !editedDate) return;
    navigate(`/bikes/${bikeId}/dated-items/new?type=${itemType}&expiresOn=${editedDate}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <Pencil className="h-5 w-5" /> {t("review.pendingTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        {/* Type pill */}
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border px-3 py-1 text-[12px] font-semibold uppercase tracking-wider dark:border-border-dark">
            {t(`items.${itemType}`)}
          </span>
          {plate && (
            <span className="num text-xs text-muted dark:text-muted-dark">{plate}</span>
          )}
        </div>

        {/* Editable date — the main interaction */}
        <div className="flex flex-col items-center gap-2 py-2">
          <label className="label-micro text-muted dark:text-muted-dark" htmlFor="doc-date">
            {t("items.expiresOn")}
          </label>
          <input
            id="doc-date"
            type="date"
            value={editedDate}
            onChange={(e) => setEditedDate(e.target.value)}
            className="w-full rounded-2xl border border-border bg-surface px-4 py-4 text-center text-[22px] font-semibold tracking-tight transition
              focus:outline-none focus:ring-2 focus:ring-accent/50
              dark:border-border-dark dark:bg-surface-dark dark:text-text-dark text-text"
          />
        </div>

        <p className="text-right text-xs text-muted dark:text-muted-dark">
          {t("review.confidence")}: {Math.round(confidence * 100)}%
        </p>

        <div className="flex gap-2">
          {bikeId ? (
            <Button onClick={onApply} variant="accent" className="flex-1" disabled={!editedDate}>
              {t("review.applySelected")}
            </Button>
          ) : (
            <Button asChild variant="accent" className="flex-1">
              <Link to="/dashboard">{t("items.manualAdd")}</Link>
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link to="/dashboard"><X className="h-4 w-4" /></Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm dark:border-border-dark">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted dark:text-muted-dark">
        {label}
      </span>
      <span>{value ?? <em className="opacity-60">—</em>}</span>
    </li>
  );
}
