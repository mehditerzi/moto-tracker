import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  RotateCw,
  X,
  Maximize2,
  CheckCircle2,
  Trash2,
  Pencil,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormRow } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import { NumberInput } from "@/components/ui/number-input";
import type { FieldWidth } from "@/components/ui/control";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { PaywallSheet } from "@/components/PaywallSheet";
import { useConfirm } from "@/components/ConfirmSheet";
import { fetchMakes, fetchModels } from "@/lib/catalog";
import { useBikes } from "@/hooks/useBikes";
import {
  useApplyBatch,
  useBatch,
  useDiscardBatch,
  useRescanDocument,
  useSaveDecision,
} from "@/hooks/useDocuments";
import { pushToast } from "@/hooks/useToast";
import { friendlyError, isVehicleLimitError } from "@/lib/apiError";
import { ApiError } from "@/lib/api";
import { track } from "@/lib/telemetry";
import { env } from "@/env";
import { cn } from "@/lib/cn";
import {
  RUHSAT_FIELDS,
  DATE_TYPES,
  attentionFields,
  batchStats,
  canConfirm,
  duplicateWithinBatch,
  fieldsFromDocument,
  issuesByField,
  isOneTap,
  nextUndecidedIndex,
  outcomeOf,
  seedDecision,
  suggestNickname,
  type DateType,
  type FieldKey,
} from "./batchModel";
import type { Bike, Document, ReviewDecision } from "@mototracker/shared";

/**
 * The batch review pass.
 *
 * The design brief is one sentence: make "yes, that's right" cost one tap, and
 * make everything else impossible to walk past. Three decisions follow from it:
 *
 *   1. THE IMAGE IS ALWAYS ON SCREEN, beside the values, and one tap from
 *      full-screen. Checking a plate should be a glance across, never a
 *      navigation.
 *   2. ONLY THE DOUBTFUL FIELDS ARE OPEN. Ten inputs per document, twenty times
 *      over, is slower than typing the whole thing. The fields OCR was sure
 *      about collapse into one line the user can expand if they want to; the
 *      ones the validators flagged are already open with the cursor near them.
 *   3. THE CURSOR NEVER LEAVES. Confirm advances to the next undecided
 *      document, wrapping — so the eight easy ones can be cleared first and the
 *      two hard ones picked up on the way round, with no navigation at all.
 *
 * Every decision is written to the server as it is made, so leaving costs
 * nothing. The worker keeps reading regardless.
 */

const SLOW_MS = 20_000;

export function BatchReviewPage({ batchId }: { batchId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const batch = useBatch(batchId);
  const bikes = useBikes();
  const save = useSaveDecision();
  const apply = useApplyBatch();
  const rescan = useRescanDocument();
  const discard = useDiscardBatch();
  const confirm = useConfirm();

  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ needed: number; available: number } | null>(null);
  const [applied, setApplied] = useState<{ created: number; updated: number; datedItems: number } | null>(
    null,
  );
  const [waited, setWaited] = useState(false);

  const docs = useMemo(() => batch.data?.documents ?? [], [batch.data]);
  const stats = useMemo(() => batchStats(docs), [docs]);
  const dupes = useMemo(() => duplicateWithinBatch(docs), [docs]);

  // The reading-is-slow admission. Same lesson the single review screen learned:
  // OCR is queued work that can legitimately take minutes, so never promise a
  // duration — acknowledge the wait and make clear it continues without us.
  useEffect(() => {
    if (stats.reading === 0) {
      setWaited(false);
      return;
    }
    const timer = setTimeout(() => setWaited(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [stats.reading]);

  // Clamp the cursor when documents disappear (a deleted shot, a reload).
  useEffect(() => {
    if (docs.length > 0 && index >= docs.length) setIndex(docs.length - 1);
  }, [docs.length, index]);

  const current = docs[index];
  /** True when this document has an outcome the user can actually confirm. */
  const decidable = !!current && (outcomeOf(current) === "create" || outcomeOf(current) === "update");

  // ── the draft decision for the document under the cursor ───────────────────
  const orgId = batch.data?.batch.orgId ?? null;
  /** Vehicles this batch may update — the batch's garage, never both. */
  const garage = useMemo(
    () => (bikes.data ?? []).filter((b) => (orgId ? b.orgId === orgId : b.orgId == null)),
    [bikes.data, orgId],
  );
  const targetBike = useMemo(
    () => garage.find((b) => b.id === current?.suggestedBikeId),
    [garage, current?.suggestedBikeId],
  );

  const [draft, setDraft] = useState<ReviewDecision | null>(null);
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    // Reseed only when the cursor actually moves, so a poll landing mid-edit
    // cannot wipe what the user is typing.
    if (seededFor.current === current.id) return;
    seededFor.current = current.id;
    setDraft(current.reviewDecision ?? seedDecision(current, targetBike));
  }, [current, targetBike]);

  const goTo = useCallback((i: number) => {
    setIndex(i);
    setZoom(false);
    // Bring the header back into view — on a phone the user may be scrolled
    // down among the fields of the document they just finished.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const advance = useCallback(() => {
    const next = nextUndecidedIndex(docs, index);
    if (next === null || next === index) {
      // Nothing left to decide — the footer's apply button is the next act.
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return;
    }
    goTo(next);
  }, [docs, index, goTo]);

  const persist = useCallback(
    async (state: "confirmed" | "skipped" | "pending", decision?: ReviewDecision) => {
      if (!current) return false;
      try {
        await save.mutateAsync({ documentId: current.id, batchId, state, decision });
        return true;
      } catch (e) {
        pushToast({
          variant: "danger",
          title: t("batch.saveFailed"),
          description: friendlyError(e, t),
        });
        return false;
      }
    },
    [current, batchId, save, t],
  );

  const confirmAndNext = useCallback(async () => {
    if (!current || !draft) return;
    if (!canConfirm(draft)) return;
    const edited = RUHSAT_FIELDS.filter(
      (k) => (draft.fields[k] ?? "") !== fieldsFromDocument(current)[k],
    ).length;
    track("batch_document_confirmed", { action: draft.action, edited, oneTap: isOneTap(current) });
    if (await persist("confirmed", draft)) advance();
  }, [current, draft, persist, advance]);

  const skipAndNext = useCallback(async () => {
    track("batch_document_skipped", { outcome: current ? outcomeOf(current) : null });
    if (await persist("skipped")) advance();
  }, [persist, advance, current]);

  // Keyboard: the desktop half of "flows like water". A fleet manager reviewing
  // twenty documents at a desk should never have to reach for the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (e.key === "ArrowRight" && !typing) goTo(Math.min(index + 1, docs.length - 1));
      if (e.key === "ArrowLeft" && !typing) goTo(Math.max(index - 1, 0));
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void confirmAndNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, docs.length, goTo, confirmAndNext]);

  const onApply = async () => {
    try {
      const res = await apply.mutateAsync(batchId);
      track("batch_applied", { created: res.created, updated: res.updated });
      setApplied({ created: res.created, updated: res.updated, datedItems: res.datedItems });
    } catch (e) {
      if (isVehicleLimitError(e)) {
        const body = (e as ApiError).body as { needed?: number; available?: number } | undefined;
        setLimitInfo({ needed: body?.needed ?? 0, available: body?.available ?? 0 });
        // An organization's allowance is not something a member buys in the
        // app (App Store guideline 3.1.1 — it is sold offline), so the consumer
        // paywall must never open on a fleet batch. The count message above is
        // the whole answer there.
        if (!orgId) setPaywall(true);
        return;
      }
      if (e instanceof ApiError && e.status === 409) {
        // Someone (or a retried request) already applied it. Show the result
        // rather than an error — the work is done.
        void batch.refetch();
        pushToast({ variant: "default", title: t("batch.alreadyApplied") });
        return;
      }
      pushToast({
        variant: "danger",
        title: t("batch.applyFailed"),
        description: friendlyError(e, t),
      });
    }
  };

  // ── page-level states ──────────────────────────────────────────────────────

  if (batch.isLoading) return <ReviewSkeleton />;
  if (batch.isError || !batch.data) {
    const gone = batch.error instanceof ApiError && batch.error.status === 404;
    return (
      <ErrorState
        onRetry={gone ? undefined : () => void batch.refetch()}
        title={gone ? t("common.notFound") : undefined}
        description={gone ? t("batch.gone") : undefined}
      >
        <Button asChild variant="accent">
          <Link to="/capture">{t("batch.startNew")}</Link>
        </Button>
      </ErrorState>
    );
  }

  if (applied || batch.data.batch.status === "applied") {
    return (
      <AppliedSummary
        created={applied?.created ?? 0}
        updated={applied?.updated ?? 0}
        datedItems={applied?.datedItems ?? 0}
        known={!!applied}
      />
    );
  }

  if (docs.length === 0) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>{t("batch.emptyTitle")}</CardTitle>
          <CardDescription>{t("batch.emptySub")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="accent">
            <Link to={`/capture?batch=${batchId}`}>{t("batch.shootMore")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 pb-28">
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} />

      {/* ── progress header ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-bg/90 px-4 py-2 backdrop-blur dark:border-border-dark dark:bg-bg-dark/90">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("batch.previous")}
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
              className="min-h-[44px] min-w-[44px]"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="num text-sm font-semibold tabular-nums">
              {index + 1} / {docs.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("batch.next")}
              disabled={index >= docs.length - 1}
              onClick={() => goTo(index + 1)}
              className="min-h-[44px] min-w-[44px]"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-right text-[13px] text-muted dark:text-muted-dark" aria-live="polite">
            {t("batch.readProgress", {
              done: stats.total - stats.reading,
              total: stats.total,
            })}
          </p>
        </div>
        {/* A strip of chips, one per document: where you are, what is done, what
            still needs you. Shape and text carry the meaning, not colour alone. */}
        <ul className="mt-2 flex gap-1 overflow-x-auto pb-1">
          {docs.map((d, i) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-current={i === index ? "true" : undefined}
                aria-label={t("batch.goToDocument", {
                  index: i + 1,
                  state: t(`batch.state.${chipState(d)}`),
                })}
                className={cn(
                  "flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-[11px] font-semibold tabular-nums transition",
                  i === index
                    ? "bg-text text-bg dark:bg-text-dark dark:text-bg-dark"
                    : "bg-surface-elev text-muted dark:bg-surface-elev-dark dark:text-muted-dark",
                )}
              >
                {chipState(d) === "confirmed" ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : chipState(d) === "skipped" ? (
                  <X className="h-3.5 w-3.5" aria-hidden />
                ) : chipState(d) === "failed" ? (
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                ) : chipState(d) === "reading" ? (
                  <span
                    aria-hidden
                    className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                  />
                ) : (
                  i + 1
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {stats.reading > 0 && waited && (
        <p className="rounded-xl bg-surface-elev p-3 text-[13px] leading-relaxed text-muted dark:bg-surface-elev-dark dark:text-muted-dark">
          {t("batch.stillReading")}
        </p>
      )}

      {/* ── the document ────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current!.id}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.15 }}
          className="flex flex-col gap-3 md:flex-row md:items-start"
        >
          {/* Source image, side by side with the values from `md` up. */}
          <div className="md:sticky md:top-28 md:w-2/5 md:shrink-0">
            <button
              type="button"
              onClick={() => setZoom(true)}
              className="relative block w-full overflow-hidden rounded-2xl border border-border dark:border-border-dark"
              aria-label={t("batch.expandImage")}
            >
              <img
                src={`${env.VITE_API_URL}/api/documents/${current!.id}/file`}
                alt=""
                className="block h-44 w-full object-cover md:h-auto md:max-h-[60vh] md:object-contain"
              />
              <span className="absolute bottom-2 right-2 rounded-full bg-black/60 p-2 text-white">
                <Maximize2 className="h-4 w-4" />
              </span>
            </button>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <DocumentPane
              doc={current!}
              draft={draft}
              onDraft={setDraft}
              garage={garage}
              duplicateOf={dupes.get(current!.id)}
              duplicateIndex={
                dupes.has(current!.id)
                  ? docs.findIndex((d) => d.id === dupes.get(current!.id)) + 1
                  : undefined
              }
              onRescan={() => {
                rescan.mutate(
                  { documentId: current!.id, batchId },
                  {
                    onSuccess: () => {
                      seededFor.current = null;
                      pushToast({ variant: "default", title: t("batch.rescanQueued") });
                    },
                    onError: (e) =>
                      pushToast({
                        variant: "danger",
                        title: t("batch.rescanFailed"),
                        description: friendlyError(e, t),
                      }),
                  },
                );
              }}
              rescanning={rescan.isPending}
            />
          </div>
        </motion.div>
      </AnimatePresence>

      {limitInfo && (
        <p className="rounded-xl bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-300">
          {t("batch.limitDetail", limitInfo)}
        </p>
      )}

      {/* ── per-document actions ────────────────────────────────────────── */}
      {current!.ocrStatus !== "pending" && (
        <div className="flex gap-2">
          <Button
            variant={decidable ? "outline" : "accent"}
            className="min-h-[44px] flex-1"
            onClick={() => void skipAndNext()}
            disabled={save.isPending}
          >
            {decidable ? t("batch.skip") : t("batch.skipAndNext")}
          </Button>
          {/* Confirm is offered only where there is something to confirm. On an
              unreadable scan, a company plate or a document that is not a
              registration, the honest options are inside the pane (read again,
              enter by hand) plus "skip" — a confirm button there would promise
              an outcome we cannot deliver. */}
          {decidable && (
            <Button
              variant="accent"
              className="min-h-[44px] flex-[2]"
              onClick={() => void confirmAndNext()}
              disabled={save.isPending || !draft || !canConfirm(draft)}
            >
              <Check className="mr-1 h-4 w-4" />
              {current!.reviewState === "confirmed"
                ? t("batch.confirmedNext")
                : t("batch.confirmNext")}
            </Button>
          )}
        </div>
      )}

      {/* ── the batch footer ────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 px-4 pb-safe pt-3 backdrop-blur dark:border-border-dark dark:bg-bg-dark/95">
        <div className="mx-auto flex max-w-2xl items-center gap-2 pb-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted dark:text-muted-dark"
            onClick={() => {
              void confirm({
                title: t("batch.discard"),
                message: t("batch.discardConfirm"),
                destructive: true,
              }).then((ok) => {
                if (!ok) return;
                discard.mutate(batchId, {
                  onSuccess: () => navigate("/capture", { replace: true }),
                });
              });
            }}
            aria-label={t("batch.discard")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="accent"
            className="min-h-[44px] flex-1"
            onClick={() => void onApply()}
            disabled={!stats.ready || apply.isPending}
          >
            {stats.ready
              ? t("batch.applyAll", { count: stats.creates + stats.updates })
              : stats.reading > 0
                ? t("batch.waitingOnReads", { count: stats.reading })
                : t("batch.decideRemaining", { count: stats.awaiting })}
          </Button>
        </div>
      </div>

      {/* Full-screen source image. */}
      {zoom && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex justify-end p-4 pt-safe">
            <button
              type="button"
              onClick={() => setZoom(false)}
              aria-label={t("common.close")}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <img
            src={`${env.VITE_API_URL}/api/documents/${current!.id}/file`}
            alt=""
            className="min-h-0 flex-1 object-contain"
          />
        </div>
      )}
    </div>
  );
}

/** The one-word state a document chip announces. */
function chipState(d: Document): "reading" | "failed" | "confirmed" | "skipped" | "pending" {
  if (d.ocrStatus === "pending") return "reading";
  const state = d.reviewState ?? "pending";
  if (state === "confirmed" || state === "applied") return "confirmed";
  if (state === "skipped") return "skipped";
  if (d.ocrStatus === "failed") return "failed";
  return "pending";
}

// ─── one document ─────────────────────────────────────────────────────────────

function DocumentPane({
  doc,
  draft,
  onDraft,
  garage,
  duplicateOf,
  duplicateIndex,
  onRescan,
  rescanning,
}: {
  doc: Document;
  draft: ReviewDecision | null;
  onDraft: (d: ReviewDecision) => void;
  garage: Bike[];
  duplicateOf?: string;
  duplicateIndex?: number;
  onRescan: () => void;
  rescanning: boolean;
}) {
  const { t } = useTranslation();
  const outcome = outcomeOf(doc);
  const attention = useMemo(() => attentionFields(doc), [doc]);
  const issues = useMemo(() => issuesByField(doc), [doc]);
  const [showAll, setShowAll] = useState(false);

  if (doc.ocrStatus === "pending") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("batch.readingTitle")}</CardTitle>
          {/* Never "a few seconds": bulk work queues behind every interactive
              scan and can honestly take minutes. */}
          <CardDescription>{t("batch.readingSub")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  if (outcome === "unreadable") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base text-danger">
            <AlertTriangle className="h-5 w-5" /> {t("batch.unreadableTitle")}
          </CardTitle>
          <CardDescription>{t("batch.unreadableSub")}</CardDescription>
        </CardHeader>
        <CardContent className="gap-2">
          {/* Three ways out, never zero. */}
          <Button variant="accent" onClick={onRescan} disabled={rescanning} className="min-h-[44px]">
            <RotateCw className={cn("mr-1 h-4 w-4", rescanning && "animate-spin")} />
            {t("batch.rescan")}
          </Button>
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link to="/bikes/new">{t("batch.enterManually")}</Link>
          </Button>
          <p className="text-xs text-muted dark:text-muted-dark">{t("batch.unreadableHint")}</p>
        </CardContent>
      </Card>
    );
  }

  if (outcome === "org_conflict") {
    const company = garage.find((b) => b.id === doc.suggestedBikeId);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> {t("batch.orgConflictTitle")}
          </CardTitle>
          <CardDescription>
            {t("batch.orgConflictSub", { name: company?.nickname ?? doc.ocrExtracted?.plate ?? "" })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-muted dark:text-muted-dark">{t("batch.orgConflictHint")}</p>
        </CardContent>
      </Card>
    );
  }

  if (outcome === "not_a_ruhsat") {
    const type = doc.ocrExtracted?.docType ?? "unknown";
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("batch.notRuhsatTitle")}</CardTitle>
          <CardDescription>
            {t("batch.notRuhsatSub", { type: t(`items.${type}`, { defaultValue: type }) })}
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-2">
          <p className="text-[13px] text-muted dark:text-muted-dark">{t("batch.notRuhsatHint")}</p>
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link to={`/documents/${doc.id}/review`}>{t("batch.openSingleReview")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!draft) return <Skeleton className="h-64 rounded-2xl" />;

  const setFields = (patch: Partial<Record<FieldKey, string>>) =>
    onDraft({ ...draft, fields: { ...draft.fields, ...patch } });
  const setDate = (type: DateType, value: string) =>
    onDraft({ ...draft, dates: { ...draft.dates, [type]: value } });

  const needsLook = RUHSAT_FIELDS.filter((k) => attention.has(k));
  const settled = RUHSAT_FIELDS.filter((k) => !attention.has(k));
  const target = garage.find((b) => b.id === draft.targetBikeId);
  const confidence = doc.ocrExtracted?.confidence ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2 text-base">
          {draft.action === "update" ? t("batch.updateTitle") : t("batch.createTitle")}
        </CardTitle>
        <CardDescription>
          {draft.action === "update"
            ? t("batch.updateSub", { name: target?.nickname ?? "" })
            : t("batch.createSub")}
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        {/* The duplicate-plate answer, stated before anything is typed. */}
        {duplicateOf && (
          <p className="rounded-xl bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-300">
            {t("batch.duplicateInBatch", { index: duplicateIndex })}
          </p>
        )}

        {/* Create vs update. The server proposes; the user decides. */}
        <div
          role="radiogroup"
          aria-label={t("batch.actionLabel")}
          className="grid grid-cols-2 gap-1.5 rounded-2xl bg-surface-elev p-1 dark:bg-surface-elev-dark"
        >
          {(["create", "update"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={draft.action === a}
              disabled={a === "update" && garage.length === 0}
              onClick={() =>
                onDraft({
                  ...draft,
                  action: a,
                  targetBikeId:
                    a === "update"
                      ? (draft.targetBikeId ?? doc.suggestedBikeId ?? garage[0]?.id ?? null)
                      : null,
                })
              }
              className={cn(
                "min-h-[44px] rounded-xl px-2 text-[13px] font-medium transition disabled:opacity-40",
                draft.action === a
                  ? "bg-surface text-text shadow-card dark:bg-surface-dark dark:text-text-dark"
                  : "text-muted dark:text-muted-dark",
              )}
            >
              {t(`batch.action.${a}`)}
            </button>
          ))}
        </div>

        {draft.action === "update" && (
          <Field label={t("batch.targetVehicle")}>
            <Select
              value={draft.targetBikeId ?? ""}
              onChange={(e) => onDraft({ ...draft, targetBikeId: e.target.value })}
            >
              {garage.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nickname}
                  {b.plate ? ` · ${b.plate}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {draft.action === "create" && (
          <Field label={t("bike.nickname")} hint={t("bike.nicknameHint")}>
            <Input
              value={draft.nickname ?? ""}
              onChange={(e) => onDraft({ ...draft, nickname: e.target.value })}
              onFocus={(e) => {
                if (!e.target.value) {
                  onDraft({
                    ...draft,
                    nickname: suggestNickname(draft.fields as Record<FieldKey, string>),
                  });
                }
              }}
              autoCapitalize="words"
              placeholder={t("bike.nickname")}
            />
          </Field>
        )}

        {/* ── the fields that need a human ─────────────────────────────── */}
        {needsLook.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="inline-flex items-center gap-2 text-[13px] font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {t("batch.checkTheseCount", { count: needsLook.length })}
            </p>
            <FormRow>
            {needsLook.map((key) => (
              <ReviewField
                key={key}
                fieldKey={key}
                value={draft.fields[key] ?? ""}
                makeValue={draft.fields.make ?? ""}
                issue={issues.get(key)?.kind === "suspect" ? issues.get(key)!.message : undefined}
                onChange={(v) => setFields(key === "make" ? { make: v, model: "" } : { [key]: v })}
              />
            ))}
            </FormRow>
          </div>
        ) : (
          <p className="inline-flex items-center gap-2 rounded-xl bg-success/10 p-3 text-[13px] text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            {t("batch.allClear")}
          </p>
        )}

        {/* Everything OCR was sure about, one line — expandable, never in the way. */}
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="inline-flex min-h-[44px] items-center gap-2 self-start text-[13px] text-muted underline-offset-2 hover:underline dark:text-muted-dark"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          {showAll ? t("batch.hideOther") : t("batch.showOther", { count: settled.length })}
        </button>
        {showAll && (
          <FormRow>
            {settled.map((key) => (
              <ReviewField
                key={key}
                fieldKey={key}
                value={draft.fields[key] ?? ""}
                makeValue={draft.fields.make ?? ""}
                issue={
                  issues.get(key)?.kind === "corrected"
                    ? t("batch.correctedNote", { message: issues.get(key)!.message })
                    : undefined
                }
                corrected={issues.get(key)?.kind === "corrected"}
                onChange={(v) => setFields(key === "make" ? { make: v, model: "" } : { [key]: v })}
              />
            ))}
          </FormRow>
        )}

        {/* Renewal dates. Pre-filled from the ruhsat when it carried one. */}
        <div className="flex flex-col gap-2">
          <span className="label-micro text-muted dark:text-muted-dark">{t("review.addDatesTitle")}</span>
          {DATE_TYPES.map((type) => (
            <div key={type} className="flex items-center gap-2">
              <label
                htmlFor={`date-${doc.id}-${type}`}
                className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted dark:text-muted-dark"
              >
                {t(`items.${type}`)}
              </label>
              <DateInput
                id={`date-${doc.id}-${type}`}
                className="min-w-0 flex-1"
                value={draft.dates[type] ?? ""}
                onChange={(e) => setDate(type, e.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onRescan}
            disabled={rescanning}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-[13px] text-muted dark:text-muted-dark"
          >
            <RotateCw className={cn("h-3.5 w-3.5", rescanning && "animate-spin")} aria-hidden />
            {t("batch.rescan")}
          </button>
          <span className="text-xs text-muted dark:text-muted-dark">
            {t("review.confidence")}: {Math.round(confidence * 100)}%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── one field ────────────────────────────────────────────────────────────────

function ReviewField({
  fieldKey,
  value,
  makeValue,
  issue,
  corrected,
  onChange,
}: {
  fieldKey: FieldKey;
  value: string;
  makeValue: string;
  /** Why this field is here — becomes the field's description, wired by <Field>. */
  issue?: string;
  corrected?: boolean;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`review.${fieldKey}` as "review.plate");
  const isNumeric = fieldKey === "year" || fieldKey === "cylinderCc";

  // `error` is what wires aria-invalid/aria-describedby, so a suspect field is
  // announced with its reason rather than just its name. A `corrected` note is
  // information, not a fault, so it goes in the hint slot instead.
  return (
    <Field
      label={label}
      width={FIELD_WIDTH_BY_KEY[fieldKey]}
      error={corrected ? undefined : issue}
      hint={corrected ? t("batch.corrected") : undefined}
    >
      {fieldKey === "make" || fieldKey === "model" ? (
        <Combobox
          value={value}
          onChange={onChange}
          fetchOptions={
            fieldKey === "make" ? (q) => fetchMakes(q) : (q) => fetchModels(makeValue || "", q)
          }
          placeholder={label}
        />
      ) : fieldKey === "firstRegistrationDate" ? (
        <DateInput value={value} onChange={(e) => onChange(e.target.value)} />
      ) : isNumeric ? (
        <NumberInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={label}
          suffix={fieldKey === "cylinderCc" ? "cc" : undefined}
          enterKeyHint="next"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={label}
          // Plates and the chassis/engine codes are transcribed character by
          // character off a document; autocorrect "helping" is pure damage.
          autoCapitalize={UPPERCASE_KEYS.has(fieldKey) ? "characters" : "words"}
          autoCorrect={UPPERCASE_KEYS.has(fieldKey) ? "off" : undefined}
          spellCheck={UPPERCASE_KEYS.has(fieldKey) ? false : undefined}
          autoComplete="off"
          enterKeyHint="next"
          className={UPPERCASE_KEYS.has(fieldKey) ? "num uppercase" : undefined}
        />
      )}
    </Field>
  );
}

/** Codes copied off the ruhsat verbatim. */
const UPPERCASE_KEYS = new Set<FieldKey>(["plate", "chassisNo", "engineNo"]);

/**
 * A field is as wide as its content. A 4-digit year rendered at the same width
 * as a 17-character chassis number is the single loudest source of "the form
 * looks wrong" — the eye reads column edges before it reads labels.
 */
const FIELD_WIDTH_BY_KEY: Record<FieldKey, FieldWidth> = {
  plate: "grow",
  make: "grow",
  model: "grow",
  year: "tiny",
  firstRegistrationDate: "date",
  color: "grow",
  chassisNo: "full",
  cylinderCc: "short",
  fuelType: "grow",
  engineNo: "full",
};

// ─── after ────────────────────────────────────────────────────────────────────

function AppliedSummary({
  created,
  updated,
  datedItems,
  known,
}: {
  created: number;
  updated: number;
  datedItems: number;
  known: boolean;
}) {
  const { t } = useTranslation();
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" /> {t("batch.appliedTitle")}
          </CardTitle>
          <CardDescription>
            {known
              ? t("batch.appliedSub", { created, updated, dates: datedItems })
              : t("batch.appliedAlready")}
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-2">
          <Button asChild variant="accent" className="min-h-[44px]">
            <Link to="/bikes">{t("batch.goToGarage")}</Link>
          </Button>
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link to="/capture">{t("batch.startNew")}</Link>
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3" aria-hidden>
      <Skeleton className="h-10 rounded-xl" />
      <Skeleton className="h-44 rounded-2xl" />
      <div className="flex flex-col gap-3 rounded-2xl border border-border p-5 dark:border-border-dark">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-11 rounded-xl" />
      </div>
    </div>
  );
}
