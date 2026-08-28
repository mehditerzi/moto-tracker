import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2, AlertTriangle, FileText, X, Pencil, Check, Plus, RotateCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { MoneyInput, NumberInput } from "@/components/ui/number-input";
import { Field, FormRow } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { ApiError } from "@/lib/api";
import { fetchMakes, fetchModels } from "@/lib/catalog";
import { useDocument } from "@/hooks/useDocuments";
import { useBike, useBikes, useUpdateBike, useCreateBike } from "@/hooks/useBikes";
import { useCreateDatedItem } from "@/hooks/useDatedItems";
import { useCreateFuelLog } from "@/hooks/useFuelLogs";
import { pushToast } from "@/hooks/useToast";
import { friendlyError, isVehicleLimitError } from "@/lib/apiError";
import { PaywallSheet } from "@/components/PaywallSheet";
import { track } from "@/lib/telemetry";
import { ScanFrame } from "@/pages/DocumentCapturePage";
import { env } from "@/env";
import { cn } from "@/lib/cn";
import type { Bike, VehicleType } from "@mototracker/shared";

/**
 * How long we wait before escalating the "still reading" copy. OCR is a queued
 * job: the server's per-document ceiling is 120 s and only a couple run at a
 * time across all users, so a scan can legitimately sit pending for minutes and
 * we must not promise a duration we can't keep. Phase 1 acknowledges the wait;
 * phase 2 hands over the escapes, because by then waiting has stopped being
 * useful advice — the job is either queued behind other work or was lost to an
 * API restart. Leaving is genuinely safe: the worker writes (and auto-applies)
 * the result whether or not this screen is open.
 */
const SLOW_MS = 20_000;
const VERY_SLOW_MS = 75_000;

// ─── page shell ──────────────────────────────────────────────────────────────

export function DocumentReviewPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const doc = useDocument(id, { pollWhilePending: true });

  // Hooks must be unconditional — declared before any early return.
  const [waitPhase, setWaitPhase] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    if (doc.data?.ocrStatus !== "pending") {
      setWaitPhase(0);
      return;
    }
    const slow = setTimeout(() => setWaitPhase(1), SLOW_MS);
    const verySlow = setTimeout(() => setWaitPhase(2), VERY_SLOW_MS);
    return () => {
      clearTimeout(slow);
      clearTimeout(verySlow);
    };
  }, [doc.data?.ocrStatus]);

  // Fire one telemetry event when OCR resolves — the core "did the scan work,
  // how confident, how long" signal. Guarded so polling re-renders don't re-fire.
  const reportedRef = useRef(false);
  useEffect(() => {
    const status = doc.data?.ocrStatus;
    if (!status || status === "pending" || reportedRef.current) return;
    reportedRef.current = true;
    if (status === "done") {
      const ex = doc.data?.ocrExtracted;
      track("ocr_completed", {
        docType: ex?.docType,
        confidence: ex?.confidence,
        vehicleType: ex?.vehicleType ?? null,
      });
    } else if (status === "failed") {
      track("ocr_failed", {});
    }
  }, [doc.data?.ocrStatus, doc.data?.ocrExtracted]);

  if (!id) return null;
  // A skeleton in the shape of the card below, not a line of centred text that
  // the real screen then shoves off the top of the viewport.
  if (doc.isLoading) return <ReviewSkeleton />;
  // `!doc.data` used to be folded into the loading branch, so a failed fetch —
  // a 404 from a stale link, or two network failures with `retry: 1` — rendered
  // "Yükleniyor…" forever: no error, no retry, no way off the screen.
  if (doc.isError || !doc.data) {
    const gone = doc.error instanceof ApiError && doc.error.status === 404;
    return (
      <ErrorState
        onRetry={gone ? undefined : () => void doc.refetch()}
        title={gone ? t("common.notFound") : undefined}
        description={gone ? t("errors.not_found") : undefined}
      >
        <Button asChild variant={gone ? "accent" : "ghost"} className={gone ? "" : "text-muted dark:text-muted-dark"}>
          <Link to="/dashboard">{t("common.back")}</Link>
        </Button>
      </ErrorState>
    );
  }

  const d = doc.data;
  const fileUrl = `${env.VITE_API_URL}/api/documents/${d.id}/file`;
  // Where "do it by hand instead" leads. With a target vehicle the useful screen
  // is its renewal form; without one the scan was an add-vehicle attempt, so the
  // vehicle form is what the user was actually after.
  const manualEntryTo = d.bikeId ? `/bikes/${d.bikeId}/dated-items/new` : "/bikes/new";
  // Re-scanning keeps the same target vehicle — otherwise a retry silently turns
  // "scan for my Monster" into "create a second vehicle".
  const rescanTo = d.bikeId ? `/capture?bikeId=${d.bikeId}` : "/capture";

  if (d.ocrStatus === "pending") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{t("review.reading")}</CardTitle>
            <CardDescription>{t("review.readingSub")}</CardDescription>
          </CardHeader>
          {/* The sweep stops once we admit the job is queued rather than
              running (phase 2). `active` was hard-coded, so a document stuck
              behind other work repainted a full-width gradient at 60fps for
              minutes on end, for no information the copy below doesn't give. */}
          <CardContent><ScanFrame src={fileUrl} active={waitPhase < 2} /></CardContent>
        </Card>

        <div className="mt-4 flex flex-col gap-3">
          {waitPhase >= 1 && (
            <p className="text-center text-sm text-muted dark:text-muted-dark">
              {t("review.stillWorking")}
            </p>
          )}
          {waitPhase >= 2 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-border p-4 dark:border-border-dark">
              <p className="text-[13px] leading-relaxed text-muted dark:text-muted-dark">
                {t("review.backgroundHint")}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => void doc.refetch()}
                  disabled={doc.isFetching}
                >
                  <RotateCw className={cn("h-4 w-4", doc.isFetching && "animate-spin")} />
                  {t("review.checkAgain")}
                </Button>
                <Button asChild variant="accent" className="flex-1">
                  <Link to={manualEntryTo}>{t("review.manualEntry")}</Link>
                </Button>
              </div>
            </div>
          )}
          <Button asChild variant="ghost" className="self-center text-muted dark:text-muted-dark">
            <Link to="/dashboard">{t("common.back")}</Link>
          </Button>
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
            {/* `ocrError` is a raw English exception ("OCR pipeline timed out
                after 120000ms") — useless to the user and wrong for a Turkish
                app. Show what they can actually do about it instead. */}
            <p className="text-sm text-muted dark:text-muted-dark">{t("review.failedHint")}</p>
            <div className="flex gap-2">
              <Button asChild variant="accent" className="flex-1"><Link to={rescanTo}>{t("review.retry")}</Link></Button>
              <Button asChild variant="outline" className="flex-1">
                <Link to={manualEntryTo}>{t("review.manualEntry")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  const ex = d.ocrExtracted;
  // "done" with nothing extracted is a server-side edge case, but it used to
  // render a lone "Close" link with no explanation — treat it as a read failure
  // so the user still gets the retry / manual-entry pair.
  if (!ex)
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2 text-danger">
                <AlertTriangle className="h-5 w-5" /> {t("review.failedTitle")}
              </span>
            </CardTitle>
            <CardDescription>{t("review.failedHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button asChild variant="accent" className="flex-1"><Link to={rescanTo}>{t("review.retry")}</Link></Button>
              <Button asChild variant="outline" className="flex-1">
                <Link to={manualEntryTo}>{t("review.manualEntry")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );

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

      {ex.docType === "yakit" ? (
        <FuelReceiptReviewForm
          bikeId={d.bikeId ?? undefined}
          documentId={d.id}
          fuel={ex.fuel ?? null}
          plate={ex.plate}
          appliedFuelLogId={d.appliedFuelLogId ?? null}
          confidence={ex.confidence}
        />
      ) : isRuhsat ? (
        <RuhsatReviewForm
          bikeId={d.bikeId ?? undefined}
          documentId={d.id}
          vehicleType={ex.vehicleType ?? null}
          extracted={{
            plate: ex.plate ?? "",
            make: ex.make ?? "",
            model: ex.model ?? "",
            year: ex.year != null ? String(ex.year) : "",
            firstRegistrationDate: ex.firstRegistrationDate ?? "",
            color: ex.color ?? "",
            chassisNo: ex.chassisNo ?? "",
            engineNo: ex.engineNo ?? "",
            cylinderCc: ex.cylinderCc != null ? String(ex.cylinderCc) : "",
            fuelType: ex.fuelType ?? "",
          }}
          muayeneDate={ex.dates?.muayeneExpiresOn ?? null}
          confidence={ex.confidence}
        />
      ) : (
        <DateDocReviewForm
          bikeId={d.bikeId ?? undefined}
          documentId={d.id}
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

/** The review screen's shape while the document is still being fetched. */
function ReviewSkeleton() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3" aria-hidden>
      <Skeleton className="h-44 rounded-2xl" />
      <div className="flex flex-col gap-3 rounded-2xl border border-border p-5 dark:border-border-dark">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-11 rounded-xl" />
      </div>
    </div>
  );
}

// ─── types ────────────────────────────────────────────────────────────────────

interface ExtractedBikeFields {
  plate: string;
  make: string;
  model: string;
  year: string;
  firstRegistrationDate: string;
  color: string;
  chassisNo: string;
  engineNo: string;
  cylinderCc: string;
  fuelType: string;
}

type FieldKey = keyof ExtractedBikeFields;
// Ordered to match the printed Turkish ruhsat (araç tescil belgesi) field codes
// top-to-bottom: (A) plate, (D.1) make, (D.3) model, (D.4) year, (E) chassis,
// (P.1) cylinder_cc, (P.5) engine_no — so the review screen reads in the same
// sequence as the document the user is holding.
const FIELD_KEYS: FieldKey[] = ["plate", "make", "model", "year", "firstRegistrationDate", "color", "chassisNo", "cylinderCc", "fuelType", "engineNo"];

/** Below this OCR confidence, nudge the user to double-check every value. */
const LOW_CONFIDENCE = 0.7;

/**
 * Turkish writes decimals with a comma, and the iOS decimal keypad follows the
 * device locale — so the key next to "0" on a Turkish phone types ",".
 * `<input type="number">` reports `value === ""` for anything it cannot parse,
 * so "12,5" litres arrived here as an empty string: the digits appeared to
 * vanish and the save button stayed disabled with nothing explaining why. The
 * amount fields are therefore plain text with a decimal keypad, normalised on
 * read.
 */
function parseDecimal(s: string): number {
  return parseFloat(s.replace(",", "."));
}

/** Keeps a decimal text field to digits and separators as it is typed. */
function decimalOnly(s: string): string {
  return s.replace(/[^\d.,]/g, "");
}

function bikeToFields(bike: Bike): ExtractedBikeFields {
  return {
    plate: bike.plate ?? "",
    make: bike.make ?? "",
    model: bike.model ?? "",
    year: bike.year != null ? String(bike.year) : "",
    firstRegistrationDate: bike.firstRegistrationDate ?? "",
    color: bike.color ?? "",
    chassisNo: bike.chassisNo ?? "",
    engineNo: bike.engineNo ?? "",
    cylinderCc: bike.cylinderCc != null ? String(bike.cylinderCc) : "",
    fuelType: bike.fuelType ?? "",
  };
}

// ─── ruhsat form ──────────────────────────────────────────────────────────────

function RuhsatReviewForm({
  bikeId, documentId, vehicleType, extracted, muayeneDate, confidence,
}: {
  bikeId?: string;
  documentId: string;
  vehicleType: VehicleType | null;
  extracted: ExtractedBikeFields;
  muayeneDate: string | null;
  confidence: number;
}) {
  const { t } = useTranslation();
  const bike = useBike(bikeId);
  const update = useUpdateBike(bikeId ?? "");
  const create = useCreateBike();
  const [saved, setSaved] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [createdBikeId, setCreatedBikeId] = useState<string | null>(null);
  // Seeded from what OCR read, most specific first: "Ducati Monster" beats the
  // plate, which beats nothing. The field is visible from the start — it used to
  // stay hidden unless the seed came out empty, so a scan that found a plate
  // silently created a vehicle called "34 ABC 123" and that name then appeared
  // everywhere in the app.
  const [nickname, setNickname] = useState(
    [extracted.make, extracted.model].filter(Boolean).join(" ") || extracted.plate || "",
  );

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
      // `edited` = accepted fields the user changed from what OCR proposed — a
      // direct proxy for perceived OCR accuracy on this scan.
      const edited = FIELD_KEYS.filter(
        (k) => accepted[k] && values[k] !== "" && values[k] !== extracted[k],
      ).length;
      track("review_applied", { fields: Object.keys(patch).length, edited });
      // Name the outcome so the user knows exactly what changed, not just "saved".
      pushToast({
        variant: "success",
        title: t("review.fieldsUpdated", { count: Object.keys(patch).length }),
      });
    } catch (e) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: friendlyError(e, t) });
    }
  };

  const onCreateBike = async () => {
    if (!nickname.trim()) return;
    const patch = buildPatch();
    try {
      const newBike = await create.mutateAsync({
        nickname: nickname.trim(),
        // Persist the catalog-inferred type so a scanned car isn't saved as a
        // motorcycle (the server default). Omitted when ambiguous.
        vehicleType: vehicleType ?? undefined,
        plate:      (patch.plate      as string | undefined) || undefined,
        make:       (patch.make       as string | undefined) || undefined,
        model:      (patch.model      as string | undefined) || undefined,
        year:       (patch.year       as number | undefined) || undefined,
        firstRegistrationDate: (patch.firstRegistrationDate as string | undefined) || undefined,
        color:      (patch.color      as string | undefined) || undefined,
        chassisNo:  (patch.chassisNo  as string | undefined) || undefined,
        engineNo:   (patch.engineNo   as string | undefined) || undefined,
        cylinderCc: (patch.cylinderCc as number | undefined) || undefined,
        fuelType:   (patch.fuelType   as string | undefined) || undefined,
      });
      setCreatedBikeId(newBike.id);
      setSaved(true);
      track("bike_created_from_scan", { vehicleType: vehicleType ?? null });
      pushToast({ variant: "success", title: t("bike.added") });
    } catch (e) {
      if (isVehicleLimitError(e)) {
        setPaywall(true);
        return;
      }
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: friendlyError(e, t) });
    }
  };

  return (
    <>
    <PaywallSheet open={paywall} onClose={() => setPaywall(false)} />
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
                fieldKey={key}
                makeValue={values.make}
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
                  // Changing make invalidates the model field below it.
                  if (key === "make") {
                    setValues((s) => ({ ...s, model: "" }));
                    setAccepted((a) => ({ ...a, model: false }));
                  }
                }}
              />
            );
          })}
        </ul>
        <p className="text-xs text-muted dark:text-muted-dark">{t("review.missingHint")}</p>

        <p className="text-right text-xs text-muted dark:text-muted-dark">
          {t("review.confidence")}: {Math.round(confidence * 100)}%
        </p>

        {!bikeId && !saved && (
          <Field label={t("bike.nickname")} hint={t("bike.nicknameHint")}>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoCapitalize="words"
              placeholder={t("bike.nickname")}
            />
          </Field>
        )}

        <div className="flex gap-2">
          {saved ? (
            <Button asChild variant="accent" className="flex-1">
              <Link to="/dashboard"><CheckCircle2 className="mr-1 h-4 w-4" />{t("review.done")}</Link>
            </Button>
          ) : bikeId ? (
            <Button onClick={onApply} variant="accent" disabled={update.isPending || !hasAnyAccepted} className="flex-1">
              {t("review.applySelected")}
            </Button>
          ) : (
            <Button
              onClick={onCreateBike}
              variant="accent"
              disabled={create.isPending || !hasAnyAccepted || !nickname.trim()}
              className="flex-1"
            >
              <Plus className="mr-1 h-4 w-4" />{t("review.createBike")}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link
              to="/dashboard"
              onClick={() => { if (!saved) track("review_dismissed"); }}
            >
              <X className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>

      {effectiveBikeId && (
        <ReminderDatesPanel bikeId={effectiveBikeId} documentId={documentId} initialMuayene={muayeneDate} />
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
  documentId,
  initialMuayene,
}: {
  bikeId: string;
  documentId: string;
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
      // Link to the scan; muayene comes from the ruhsat itself, the others
      // are user-entered but still belong to this review.
      await create.mutateAsync({ type, expiresOn, sourceDocumentId: documentId });
      setSavedTypes((s) => ({ ...s, [type]: true }));
      pushToast({ variant: "success", title: t("review.dateAdded") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: friendlyError(e, t) });
    } finally {
      setPending(null);
    }
  };

  // A muayene date the OCR found is the ruhsat's most valuable field — call it
  // out so the user can't scroll past and silently lose it.
  const detectedMuayene = !!initialMuayene && !savedTypes.muayene;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2 text-base">
          <Plus className="h-4 w-4" /> {t("review.addDatesTitle")}
        </CardTitle>
        <CardDescription>{t("review.addDatesSub")}</CardDescription>
      </CardHeader>
      <CardContent className="gap-2">
        {detectedMuayene && (
          <div className="flex items-start gap-2 rounded-xl bg-accent/10 p-3 text-[13px] dark:bg-accent/15">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p>{t("review.muayeneDetected", { date: initialMuayene })}</p>
          </div>
        )}
        {REMINDER_TYPES.map((type) => {
          const done = savedTypes[type];
          const highlight = type === "muayene" && detectedMuayene;
          return (
            <div
              key={type}
              className={`flex items-center gap-2 rounded-xl border p-2.5 ${
                highlight
                  ? "border-accent/60 ring-1 ring-accent/30"
                  : "border-border dark:border-border-dark"
              }`}
            >
              <label
                htmlFor={`reminder-${type}`}
                className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted dark:text-muted-dark"
              >
                {t(`items.${type}`)}
              </label>
              {/* Was the only 36px control on a touch screen in the consumer
                  app, and had no label association at all. */}
              <DateInput
                id={`reminder-${type}`}
                className="min-w-0 flex-1"
                value={dates[type]}
                disabled={done}
                onChange={(e) => setDates((s) => ({ ...s, [type]: e.target.value }))}
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
  fieldKey, makeValue, label, ocrValue, existingValue, currentValue, accepted, hasComparison,
  onAcceptChange, onValueChange,
}: {
  fieldKey: FieldKey;
  makeValue: string;
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
  const isCatalog = fieldKey === "make" || fieldKey === "model";

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
          {/* Was a bare <button> painted like a checkbox: no role, no state
              exposed, invisible to assistive tech. */}
          <button
            type="button"
            role="checkbox"
            aria-checked={accepted}
            aria-label={label}
            onClick={() => onAcceptChange(!accepted)}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
              accepted ? "border-accent bg-accent text-black" : "border-border dark:border-border-dark"
            }`}
          >
            {accepted && <Check className="h-3 w-3" strokeWidth={3} />}
          </button>
          {isCatalog ? (
            <div className="min-w-0 flex-1">
              <Combobox
                controlSize="sm"
                value={displayVal}
                onChange={onValueChange}
                fetchOptions={
                  fieldKey === "make"
                    ? (q) => fetchMakes(q)
                    : (q) => fetchModels(makeValue || "", q)
                }
                placeholder={label}
              />
            </div>
          ) : (
            <Input
              controlSize="sm"
              value={displayVal}
              onChange={(e) => onValueChange(e.target.value)}
              placeholder={label}
              className="min-w-0 flex-1"
            />
          )}
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

          {/* The "use the scanned value" row. The edit field and the pencil are
              SIBLINGS of the select button, not children of it: a <button> may
              not contain another button or a text input (HTML content model —
              no interactive descendants), which made this row unreachable by
              keyboard and ambiguous to a screen reader. Nothing here needed
              stopPropagation once the nesting was gone. */}
          <div
            className={`flex items-center justify-between gap-1.5 rounded-lg pr-2.5 text-sm transition ${
              accepted ? "bg-accent/10 ring-1 ring-accent/50 dark:bg-accent/15" : "opacity-40"
            }`}
          >
            <button
              type="button"
              onClick={() => onAcceptChange(true)}
              aria-pressed={accepted}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
                {t("review.fromOcr")}
              </span>
              {!(editing && accepted) && (
                <span className="truncate font-medium">{currentValue}</span>
              )}
            </button>
            {editing && accepted && (
              <Input
                controlSize="sm"
                value={currentValue}
                onChange={(e) => onValueChange(e.target.value)}
                onBlur={() => setEditing(false)}
                autoFocus
                className="w-32 shrink-0 text-right"
              />
            )}
            {accepted && (
              <button
                type="button"
                aria-label={t("items.edit")}
                onClick={() => setEditing(true)}
                className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center"
              >
                <Pencil className="h-3 w-3 text-accent" />
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// ─── fuel receipt form ────────────────────────────────────────────────────────

/**
 * Review screen for a scanned pump receipt. When OCR was confident the fill is
 * already saved (appliedFuelLogId) and this just confirms it; otherwise the
 * detected values are pre-filled for a one-tap save. Odometer isn't printed on
 * receipts, so it's offered as an optional extra field here.
 */
function FuelReceiptReviewForm({
  bikeId, documentId, fuel, plate, appliedFuelLogId, confidence,
}: {
  bikeId?: string;
  documentId: string;
  fuel: { filledOn: string | null; liters: number | null; totalCost: number | null; unitPrice: number | null } | null;
  plate: string | null;
  appliedFuelLogId: string | null;
  confidence: number;
}) {
  const { t } = useTranslation();
  const bikes = useBikes();
  const create = useCreateFuelLog();
  const [selBike, setSelBike] = useState(bikeId ?? "");
  const [filledOn, setFilledOn] = useState(fuel?.filledOn ?? "");
  const [liters, setLiters] = useState(fuel?.liters != null ? String(fuel.liters) : "");
  const [cost, setCost] = useState(fuel?.totalCost != null ? String(fuel.totalCost) : "");
  const [odo, setOdo] = useState("");
  const [isFull, setIsFull] = useState(true);
  const [saved, setSaved] = useState(false);

  // Default the vehicle picker to the sole/first vehicle once loaded.
  useEffect(() => {
    if (!selBike && bikes.data && bikes.data.length > 0) setSelBike(bikes.data[0]!.id);
  }, [bikes.data, selBike]);

  if (appliedFuelLogId || saved) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" /> {t("review.fuelApplied")}
          </CardTitle>
          {plate && <CardDescription className="num">{plate}</CardDescription>}
        </CardHeader>
        <CardContent className="gap-3">
          <div className="flex gap-2">
            <Button asChild variant="accent" className="flex-1">
              <Link to="/fuel">{t("review.goToFuel")}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/dashboard"><X className="h-4 w-4" /></Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const save = async () => {
    const litersN = parseDecimal(liters);
    const costN = cost ? parseDecimal(cost) : null;
    if (!selBike || !filledOn || !(litersN > 0)) return;
    try {
      await create.mutateAsync({
        bikeId: selBike,
        filledOn,
        liters: litersN,
        totalCost: costN != null && !isNaN(costN) ? costN : null,
        odometerKm: odo ? parseInt(odo, 10) : null,
        isFull,
        sourceDocumentId: documentId,
      });
      track("fuel_logged_from_scan", { confidence });
      setSaved(true);
      pushToast({ variant: "success", title: t("fuel.added") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: friendlyError(e, t) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <FileText className="h-5 w-5" /> {t("review.fuelTitle")}
        </CardTitle>
        <CardDescription>{t("review.fuelSub")}</CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        {confidence < LOW_CONFIDENCE && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs">{t("review.lowConfidence")}</p>
          </div>
        )}

        {bikes.data && bikes.data.length > 1 && (
          <Field label={t("review.vehicle")}>
            <Select value={selBike} onChange={(e) => setSelBike(e.target.value)}>
              {bikes.data.map((b) => (
                <option key={b.id} value={b.id}>{b.nickname}</option>
              ))}
            </Select>
          </Field>
        )}

        {/* Same four fields, same order and same widths as the fuel page's own
            form — a receipt review and a manual entry should not feel like two
            different screens. */}
        <FormRow>
          <Field label={t("fuel.date")} width="grow">
            <DateInput value={filledOn} onChange={(e) => setFilledOn(e.target.value)} enterKeyHint="next" />
          </Field>
          <Field label={t("fuel.liters")} width="tiny">
            <NumberInput
              decimal
              suffix="L"
              value={liters}
              onChange={(e) => setLiters(decimalOnly(e.target.value))}
              enterKeyHint="next"
            />
          </Field>
        </FormRow>
        <FormRow>
          <Field label={t("fuel.cost")} width="grow">
            <MoneyInput value={cost} onChange={(e) => setCost(decimalOnly(e.target.value))} enterKeyHint="next" />
          </Field>
          <Field label={t("fuel.odometer")} optional width="short">
            <NumberInput
              suffix="km"
              value={odo}
              onChange={(e) => setOdo(e.target.value)}
              enterKeyHint="done"
            />
          </Field>
        </FormRow>

        {fuel?.unitPrice != null && (
          <p className="text-xs text-muted dark:text-muted-dark">
            {t("review.unitPrice")}: <span className="num">₺{fuel.unitPrice.toFixed(2)}/L</span>
          </p>
        )}

        <Checkbox
          checked={isFull}
          onChange={(e) => setIsFull(e.target.checked)}
          label={t("fuel.fullTank")}
          description={t("fuel.fullTankHint")}
          className="self-start"
        />

        <p className="text-right text-xs text-muted dark:text-muted-dark">
          {t("review.confidence")}: {Math.round(confidence * 100)}%
        </p>

        <div className="flex gap-2">
          <Button
            onClick={() => void save()}
            variant="accent"
            className="flex-1"
            disabled={create.isPending || !selBike || !filledOn || !(parseDecimal(liters) > 0)}
          >
            <Plus className="mr-1 h-4 w-4" /> {t("fuel.add")}
          </Button>
          <Button asChild variant="ghost">
            <Link to="/dashboard"><X className="h-4 w-4" /></Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── date-doc form ────────────────────────────────────────────────────────────

const ITEM_TYPES = ["sigorta", "kasko", "muayene"] as const;

function DateDocReviewForm({
  bikeId, documentId, docType, plate, dates, appliedDatedItemId, confidence,
}: {
  bikeId?: string;
  documentId: string;
  docType: "sigorta" | "kasko" | "muayene" | "unknown";
  plate: string | null;
  dates: { sigortaExpiresOn?: string | null; kaskoExpiresOn?: string | null; muayeneExpiresOn?: string | null } | null;
  appliedDatedItemId: string | null;
  confidence: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const bikes = useBikes();
  const applied = !!appliedDatedItemId;

  // OCR couldn't always match a plate to a vehicle. This screen used to answer
  // that with a button labelled "add manually" that just dropped the user on the
  // dashboard — the date they had just reviewed was thrown away. Let them say
  // which vehicle it belongs to and carry on.
  const [selBike, setSelBike] = useState(bikeId ?? "");
  useEffect(() => {
    if (!selBike && bikes.data && bikes.data.length > 0) setSelBike(bikes.data[0]!.id);
  }, [bikes.data, selBike]);
  const targetBikeId = bikeId ?? selBike;
  const hasNoVehicles = bikes.data != null && bikes.data.length === 0;

  const detectedDate =
    docType === "sigorta" ? (dates?.sigortaExpiresOn ?? null) :
    docType === "kasko"   ? (dates?.kaskoExpiresOn   ?? null) :
    docType === "muayene" ? (dates?.muayeneExpiresOn  ?? null) :
    (dates?.sigortaExpiresOn ?? dates?.kaskoExpiresOn ?? dates?.muayeneExpiresOn ?? null);

  // For a recognized doc the type is fixed; for `unknown` we must NOT silently
  // label it "sigorta" — let the user pick (defaulting to whichever date matched).
  const isUnknown = docType === "unknown";
  const defaultType =
    docType !== "unknown" ? docType
    : dates?.muayeneExpiresOn ? "muayene"
    : dates?.kaskoExpiresOn ? "kasko"
    : "sigorta";
  const [itemType, setItemType] = useState<(typeof ITEM_TYPES)[number]>(defaultType);
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
    if (!targetBikeId || !editedDate) return;
    // Carry documentId so the confirmed record links back to its scan (provenance).
    navigate(
      `/bikes/${targetBikeId}/dated-items/new?type=${itemType}&expiresOn=${editedDate}&documentId=${documentId}`,
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <Pencil className="h-5 w-5" /> {t("review.pendingTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        {/* Type: a fixed pill when recognized, a chooser when the doc is unknown
            so we never mislabel it. */}
        {isUnknown ? (
          <div className="flex flex-col gap-1.5">
            <span className="label-micro text-muted dark:text-muted-dark">{t("items.type")}</span>
            <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-surface-elev p-1 dark:bg-surface-elev-dark">
              {ITEM_TYPES.map((tt) => (
                <button
                  key={tt}
                  type="button"
                  onClick={() => setItemType(tt)}
                  className={`rounded-xl py-2 text-[13px] font-medium transition ${
                    itemType === tt
                      ? "bg-surface shadow-card text-text dark:bg-surface-dark dark:text-text-dark"
                      : "text-muted dark:text-muted-dark"
                  }`}
                >
                  {t(`items.${tt}`)}
                </button>
              ))}
            </div>
            {plate && <span className="num text-xs text-muted dark:text-muted-dark">{plate}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border px-3 py-1 text-[12px] font-semibold uppercase tracking-wider dark:border-border-dark">
              {t(`items.${itemType}`)}
            </span>
            {plate && (
              <span className="num text-xs text-muted dark:text-muted-dark">{plate}</span>
            )}
          </div>
        )}

        {/* Vehicle picker — only when the scan wasn't already tied to one. */}
        {!bikeId && bikes.data && bikes.data.length > 0 && (
          <Field label={t("review.pickVehicle")}>
            <Select value={selBike} onChange={(e) => setSelBike(e.target.value)}>
              {bikes.data.map((b) => (
                <option key={b.id} value={b.id}>{b.nickname}</option>
              ))}
            </Select>
          </Field>
        )}

        {/* Editable date — the main interaction. Shares its hero treatment with
            the dated-item form via ui/date-input rather than a second copy. */}
        <Field
          label={t("items.expiresOn")}
          labelClassName="label-micro text-muted dark:text-muted-dark"
          className="items-center py-1 text-center"
        >
          <DateInput
            variant="hero"
            value={editedDate}
            onChange={(e) => setEditedDate(e.target.value)}
          />
        </Field>

        <p className="text-right text-xs text-muted dark:text-muted-dark">
          {t("review.confidence")}: {Math.round(confidence * 100)}%
        </p>

        {hasNoVehicles && (
          <p className="text-[13px] text-muted dark:text-muted-dark">{t("review.noVehicleYet")}</p>
        )}

        <div className="flex gap-2">
          {hasNoVehicles ? (
            <Button asChild variant="accent" className="flex-1">
              <Link to="/bikes/new"><Plus className="mr-1 h-4 w-4" />{t("dashboard.addBike")}</Link>
            </Button>
          ) : (
            <Button
              onClick={onApply}
              variant="accent"
              className="flex-1"
              disabled={!editedDate || !targetBikeId}
            >
              {t("review.applySelected")}
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
