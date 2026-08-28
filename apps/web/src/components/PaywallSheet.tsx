import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Clock, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IAP_TIERS, IAP_PRODUCT_IDS, IAP_TERMS, discountFor, type IapTier } from "@mototracker/shared";
import {
  isNativeIapAvailable,
  fetchProductCatalog,
  purchaseTier,
  restorePurchases,
  onEntitlementGranted,
  type ProductCatalog,
} from "@/lib/nativeIap";
import { ENTITLEMENT_KEY, useEntitlement } from "@/hooks/useEntitlement";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { track } from "@/lib/telemetry";
import { cn } from "@/lib/cn";

/**
 * Functional links required alongside auto-renewable subscriptions (App Store
 * Guideline 3.1.2). Terms of Use uses Apple's standard EULA.
 *
 * `target="_blank"` is correct inside the Capacitor WKWebView: Capacitor's
 * WebViewDelegationHandler implements `webView(_:createWebViewWith:…)` and hands
 * the URL to `UIApplication.shared.open`, so the link opens in Safari instead of
 * silently doing nothing or replacing the app's own web view.
 */
const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PRIVACY_URL = "https://mototracker.mehditerzi.com/privacy";

/** Term shown first. One year is the volume-priced sweet spot and renews. */
const DEFAULT_TERM = "yearly";

/** How the current purchase attempt ended — each state gets its own honest UI. */
type Flow =
  | { kind: "idle" }
  | { kind: "cancelled" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

/**
 * The upgrade sheet shown when a user hits the free single-vehicle limit.
 *
 * The catalogue is 42 products (7 pack sizes × 6 terms). Showing that matrix is
 * a research task, not a purchase, so the sheet leads with ONE recommended pack
 * — the smallest that actually grows this user's garage, at the default term —
 * and hides the rest behind a single disclosure. Every option states what you
 * get (vehicles × duration) and a comparable ₺/vehicle/month figure, so the
 * volume discount is legible instead of implied.
 *
 * On web — where App Store IAP can't run — it explains that additional vehicles
 * are managed in the iOS app.
 */
export function PaywallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const native = isNativeIapAvailable();
  const ent = useEntitlement();

  const [catalog, setCatalog] = useState<ProductCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [termKey, setTermKey] = useState(DEFAULT_TERM);
  const [busy, setBusy] = useState<string | null>(null); // productId or "restore"
  const [flow, setFlow] = useState<Flow>({ kind: "idle" });

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = "paywall-title";
  const descId = "paywall-desc";

  // ── catalogue ──────────────────────────────────────────────────────────────
  const loadCatalog = useCallback(
    async (force = false) => {
      setLoadingCatalog(true);
      setCatalogError(null);
      try {
        const next = await fetchProductCatalog([...IAP_PRODUCT_IDS], { force });
        setCatalog(next);
        if (next.missing && next.missing.length > 0) {
          // The single most valuable production breadcrumb: which product ids
          // App Store Connect did not hand back.
          track("iap_products_missing", {
            missing: next.missing.length,
            storefront: next.storefront,
            sample: next.missing.slice(0, 5),
          });
        }
      } catch (e) {
        setCatalog(null);
        setCatalogError((e as Error).message);
        track("iap_products_failed", { code: (e as Error).message });
      } finally {
        setLoadingCatalog(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open || !native) return;
    void loadCatalog();
  }, [open, native, loadCatalog]);

  // Reset the transient flow state each time the sheet opens.
  useEffect(() => {
    if (open) {
      setFlow({ kind: "idle" });
      setBusy(null);
      setExpanded(false);
    }
  }, [open]);

  // A deferred purchase (Ask to Buy / bank approval) that completes while the
  // sheet is still open must flip "waiting" to "done" by itself.
  useEffect(() => {
    if (!open) return;
    return onEntitlementGranted(() => {
      setFlow({ kind: "idle" });
      setBusy(null);
      pushToast({ variant: "success", title: t("paywall.purchaseSuccess") });
      onClose();
    });
  }, [open, onClose, t]);

  // ── dialog behaviour: Escape + focus trap ──────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    node?.focus();

    function focusables(): HTMLElement[] {
      if (!node) return [];
      return Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !node?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  // ── what's actually purchasable ────────────────────────────────────────────
  const priceMap = useMemo(
    () => new Map((catalog?.products ?? []).map((p) => [p.id, p])),
    [catalog],
  );

  /**
   * StoreKit is the authority on what can be bought. Listing a tier it did not
   * resolve produces a button that can only ever fail, so we hide those — and
   * say how many are hidden rather than pretending the catalogue is complete.
   */
  const availableTiers = useMemo<IapTier[]>(() => {
    if (!catalog) return [];
    if (priceMap.size === 0) return [];
    return IAP_TIERS.filter((tier) => priceMap.has(tier.productId));
  }, [catalog, priceMap]);

  const availableTerms = useMemo(
    () => IAP_TERMS.filter((tm) => availableTiers.some((tier) => tier.termKey === tm.key)),
    [availableTiers],
  );

  // Keep the selected term valid when only some terms resolved.
  const effectiveTermKey =
    availableTerms.find((tm) => tm.key === termKey)?.key ?? availableTerms[0]?.key ?? termKey;
  const term = IAP_TERMS.find((x) => x.key === effectiveTermKey) ?? IAP_TERMS[1]!;

  const termTiers = useMemo(
    () => availableTiers.filter((tier) => tier.termKey === effectiveTermKey),
    [availableTiers, effectiveTermKey],
  );

  // Smallest pack that actually grows the user's garage — the obvious next step
  // should be one tap, not a study of seven options.
  const used = ent.data?.activeVehicles ?? 1;
  const ceiling = ent.data?.maxVehicles ?? 1;
  const needAtLeast = Math.max(used, ceiling) + 1;
  const recommended =
    termTiers.find((tier) => tier.maxVehicles >= needAtLeast) ?? termTiers[0] ?? null;

  const hiddenCount = catalog?.missing?.length ?? 0;

  // ── actions ────────────────────────────────────────────────────────────────
  async function onBuy(productId: string) {
    setBusy(productId);
    setFlow({ kind: "idle" });
    try {
      const result = await purchaseTier(productId);
      if (result.status === "success") {
        qc.setQueryData(ENTITLEMENT_KEY, result.entitlement);
        void qc.invalidateQueries({ queryKey: ["bikes"] });
        track("iap_purchase_success", { productId });
        pushToast({ variant: "success", title: t("paywall.purchaseSuccess") });
        onClose();
        return;
      }
      if (result.status === "pending") {
        // NOT a failure and NOT a cancellation: money has not moved, approval
        // is outstanding, and it may land minutes from now.
        track("iap_purchase_pending", { productId });
        setFlow({ kind: "pending" });
        return;
      }
      track(result.status === "unknown" ? "iap_purchase_indeterminate" : "iap_purchase_cancelled", {
        productId,
      });
      setFlow({ kind: "cancelled" });
    } catch (e) {
      const code = (e as Error).message;
      // StoreKit can also surface a cancellation as a thrown error; that is
      // still not a failure and must not be dressed up as one.
      if (code === "iap_cancelled") {
        track("iap_purchase_cancelled", { productId });
        setFlow({ kind: "cancelled" });
        return;
      }
      track("iap_purchase_failed", { productId, code });
      setFlow({ kind: "error", message: iapMessage(e, t) });
    } finally {
      setBusy(null);
    }
  }

  async function onRestore() {
    setBusy("restore");
    setFlow({ kind: "idle" });
    try {
      const summary = await restorePurchases();
      qc.setQueryData(ENTITLEMENT_KEY, summary);
      void qc.invalidateQueries({ queryKey: ["bikes"] });
      track("iap_restore_success", {});
      pushToast({ variant: "success", title: t("paywall.restoreSuccess") });
      onClose();
    } catch (e) {
      const code = (e as Error).message;
      track("iap_restore_failed", { code });
      setFlow({
        kind: "error",
        message: code === "no_purchases" ? t("paywall.restoreNone") : iapMessage(e, t),
      });
    } finally {
      setBusy(null);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  // Treat "not fetched yet" as loading too, so the sheet is never a dead panel
  // between opening and the effect firing.
  const pending = loadingCatalog || (catalog === null && catalogError === null);
  const showPacks = native && !pending && !catalogError && termTiers.length > 0;
  const showEmpty =
    native && !pending && !catalogError && catalog !== null && availableTiers.length === 0;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            aria-label={t("common.close")}
            tabIndex={-1}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            tabIndex={-1}
            className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col overflow-y-auto rounded-t-3xl bg-bg p-6 pb-8 ring-1 ring-border focus:outline-none dark:bg-bg-dark dark:ring-border-dark sm:rounded-3xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <button
              onClick={onClose}
              aria-label={t("common.close")}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 dark:text-muted-dark dark:hover:bg-surface-elev-dark"
            >
              <X className="h-4 w-4" />
            </button>

            <span className="label-micro text-muted dark:text-muted-dark">
              {t("paywall.garageState", { used, max: ceiling })}
            </span>
            <h2
              id={titleId}
              className="mt-1 pr-10 text-[22px] font-semibold leading-tight tracking-tight"
            >
              {t("paywall.title")}
            </h2>
            <p id={descId} className="mt-1.5 text-[14px] text-muted dark:text-muted-dark">
              {t("paywall.subtitle")}
            </p>

            {/* Every state change is announced, not just coloured. */}
            <div role="status" aria-live="polite" className="sr-only">
              {pending
                ? t("paywall.loading")
                : flow.kind === "pending"
                  ? t("paywall.pendingTitle")
                  : flow.kind === "error"
                    ? flow.message
                    : flow.kind === "cancelled"
                      ? t("paywall.cancelled")
                      : ""}
            </div>

            {!native ? (
              <div className="mt-6 rounded-2xl bg-surface p-4 text-[14px] text-muted ring-1 ring-border dark:bg-surface-elev-dark dark:text-muted-dark dark:ring-border-dark">
                {t("paywall.webNotice")}
              </div>
            ) : flow.kind === "pending" ? (
              <PendingPanel
                onDone={() => {
                  setFlow({ kind: "idle" });
                  onClose();
                }}
                t={t}
              />
            ) : (
              <>
                {catalog && !catalog.canMakePayments && (
                  <Notice tone="warning" icon={AlertTriangle}>
                    {t("paywall.paymentsDisabled")}
                  </Notice>
                )}

                {pending && <CatalogSkeleton label={t("paywall.loading")} />}

                {catalogError && (
                  <UnavailablePanel
                    title={t("paywall.unavailableTitle")}
                    body={iapMessage(new Error(catalogError), t)}
                    retryLabel={t("paywall.retry")}
                    onRetry={() => void loadCatalog(true)}
                  />
                )}

                {showEmpty && (
                  <UnavailablePanel
                    title={t("paywall.unavailableTitle")}
                    body={t("paywall.unavailableBody")}
                    retryLabel={t("paywall.retry")}
                    onRetry={() => void loadCatalog(true)}
                  />
                )}

                {showPacks && (
                  <>
                    {expanded && (
                      <TermPicker
                        terms={availableTerms}
                        value={effectiveTermKey}
                        onChange={setTermKey}
                        t={t}
                      />
                    )}

                    <div className={cn("grid gap-2.5", expanded ? "mt-3" : "mt-5")}>
                      {expanded
                        ? termTiers.map((tier) => (
                            <PackRow
                              key={tier.productId}
                              tier={tier}
                              price={priceMap.get(tier.productId)?.displayPrice}
                              recommended={tier.productId === recommended?.productId}
                              busy={busy === tier.productId}
                              disabled={busy !== null}
                              onBuy={() => void onBuy(tier.productId)}
                              t={t}
                            />
                          ))
                        : recommended && (
                            <HeroPack
                              tier={recommended}
                              price={priceMap.get(recommended.productId)?.displayPrice}
                              busy={busy === recommended.productId}
                              disabled={busy !== null}
                              onBuy={() => void onBuy(recommended.productId)}
                              t={t}
                            />
                          )}
                    </div>

                    <p className="mt-2 text-center text-[12px] text-muted dark:text-muted-dark">
                      {term.renewable
                        ? t("paywall.renewsHint")
                        : t("paywall.oneTimeHint", { years: term.months / 12 })}
                    </p>

                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      aria-expanded={expanded}
                      className="mt-3 inline-flex items-center justify-center gap-1.5 self-center rounded-xl px-3 py-2 text-[13px] font-medium text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 dark:text-muted-dark dark:hover:text-text-dark"
                    >
                      {expanded ? t("paywall.showLess") : t("paywall.seeAll")}
                      <ChevronDown
                        aria-hidden
                        className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
                      />
                    </button>

                    {hiddenCount > 0 && (
                      <p className="mt-2 text-center text-[11px] text-muted/80 dark:text-muted-dark/80">
                        {t("paywall.partialNotice", { count: hiddenCount })}
                      </p>
                    )}
                  </>
                )}

                {flow.kind === "error" && (
                  <Notice tone="danger" icon={AlertTriangle}>
                    {flow.message}
                  </Notice>
                )}
                {flow.kind === "cancelled" && (
                  <Notice tone="muted" icon={X}>
                    {t("paywall.cancelled")}
                  </Notice>
                )}

                <button
                  onClick={() => void onRestore()}
                  disabled={busy !== null}
                  className="mt-4 w-full rounded-xl py-2 text-center text-[13px] text-muted underline underline-offset-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 dark:text-muted-dark"
                >
                  {busy === "restore" ? t("paywall.restoring") : t("paywall.restore")}
                </button>
                <p className="mt-3 text-center text-[11px] leading-relaxed text-muted/80 dark:text-muted-dark/80">
                  {term.renewable ? t("paywall.legal") : t("paywall.legalOneTime")}
                </p>
                <p className="mt-2 flex items-center justify-center gap-3 text-[11px] text-muted/80 dark:text-muted-dark/80">
                  <a
                    href={TERMS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded px-1 py-1 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    {t("paywall.terms")}
                    <span className="sr-only"> · {t("paywall.opensExternally")}</span>
                  </a>
                  <span aria-hidden>·</span>
                  <a
                    href={PRIVACY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded px-1 py-1 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    {t("paywall.privacy")}
                    <span className="sr-only"> · {t("paywall.opensExternally")}</span>
                  </a>
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ─── pieces ───────────────────────────────────────────────────────────────────

type T = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The comparable figure across every pack × term: what one vehicle costs for one
 * month. Derived from the catalogue formula (which the App Store prices mirror),
 * so it stays comparable even when StoreKit's localized string can't be parsed.
 */
function perVehicleMonth(tier: IapTier): number {
  return tier.displayPriceTry / tier.maxVehicles / tier.termMonths;
}

function formatTry(value: number): string {
  const fraction = value < 10 ? 1 : 0;
  return `₺${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(value)}`;
}

function priceLabel(tier: IapTier, live: string | undefined): string {
  return live ?? `₺${tier.displayPriceTry}`;
}

/** The one-tap common case: biggest type, single accent CTA, value spelled out. */
function HeroPack({
  tier,
  price,
  busy,
  disabled,
  onBuy,
  t,
}: {
  tier: IapTier;
  price?: string;
  busy: boolean;
  disabled: boolean;
  onBuy: () => void;
  t: T;
}) {
  const discount = discountFor(tier.maxVehicles);
  return (
    <div className="rounded-2xl bg-surface p-5 ring-2 ring-accent dark:bg-surface-elev-dark">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden className="h-3.5 w-3.5 text-accent-dim" />
        <span className="label-micro text-accent-dim">{t("paywall.recommended")}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="num text-[40px] font-semibold leading-none tracking-tight">
          {tier.maxVehicles}
        </span>
        <span className="text-[15px] font-medium text-muted dark:text-muted-dark">
          {t("paywall.vehiclesWord")}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="num text-[17px] font-semibold">{priceLabel(tier, price)}</span>
        <span className="text-[13px] text-muted dark:text-muted-dark">
          / {t(`paywall.per_${tier.termKey}`)}
        </span>
        {discount > 0 && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-dim">
            {t("paywall.save", { percent: Math.round(discount * 100) })}
          </span>
        )}
      </div>
      <p className="num mt-1 text-[12px] text-muted dark:text-muted-dark">
        {t("paywall.perVehicleMonth", { price: formatTry(perVehicleMonth(tier)) })}
      </p>
      <Button
        size="lg"
        variant="accent"
        className="mt-4 w-full"
        disabled={disabled}
        onClick={onBuy}
      >
        {busy ? (
          <>
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            {t("paywall.processing")}
          </>
        ) : (
          t("paywall.unlock", { count: tier.maxVehicles })
        )}
      </Button>
    </div>
  );
}

/** A row in the expanded comparison list. */
function PackRow({
  tier,
  price,
  recommended,
  busy,
  disabled,
  onBuy,
  t,
}: {
  tier: IapTier;
  price?: string;
  recommended: boolean;
  busy: boolean;
  disabled: boolean;
  onBuy: () => void;
  t: T;
}) {
  const discount = discountFor(tier.maxVehicles);
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl bg-surface p-4 ring-1 dark:bg-surface-elev-dark",
        recommended ? "ring-2 ring-accent" : "ring-border dark:ring-border-dark",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold">
          <span className="num">{tier.maxVehicles}</span>
          <span>{t("paywall.vehiclesWord")}</span>
          {recommended && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-black">
              {t("paywall.recommended")}
            </span>
          )}
          {discount > 0 && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-dim">
              {t("paywall.save", { percent: Math.round(discount * 100) })}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[13px] text-muted dark:text-muted-dark">
          <span className="num font-medium text-text dark:text-text-dark">
            {priceLabel(tier, price)}
          </span>{" "}
          / {t(`paywall.per_${tier.termKey}`)}
        </div>
        <div className="num mt-0.5 text-[11px] text-muted/80 dark:text-muted-dark/80">
          {t("paywall.perVehicleMonth", { price: formatTry(perVehicleMonth(tier)) })}
        </div>
      </div>
      <Button
        size="sm"
        variant={recommended ? "accent" : "outline"}
        disabled={disabled}
        onClick={onBuy}
        aria-label={t("paywall.unlock", { count: tier.maxVehicles })}
      >
        {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : t("paywall.choose")}
      </Button>
    </div>
  );
}

/** Duration selector, exposed as a real radiogroup rather than styled buttons. */
function TermPicker({
  terms,
  value,
  onChange,
  t,
}: {
  terms: readonly { key: string; renewable: boolean }[];
  value: string;
  onChange: (key: string) => void;
  t: T;
}) {
  return (
    <div className="mt-4">
      <span className="label-micro text-muted dark:text-muted-dark">{t("paywall.termLabel")}</span>
      <div
        role="radiogroup"
        aria-label={t("paywall.termLabel")}
        className="mt-1.5 flex flex-wrap gap-1.5 rounded-2xl bg-surface-elev p-1 dark:bg-surface-elev-dark"
      >
        {terms.map((tm) => {
          const selected = tm.key === value;
          return (
            <button
              key={tm.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(tm.key)}
              className={cn(
                "flex-1 whitespace-nowrap rounded-xl px-2 py-2 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                selected
                  ? "bg-surface text-text shadow-card dark:bg-surface-dark dark:text-text-dark"
                  : "text-muted dark:text-muted-dark",
              )}
            >
              {t(`paywall.term_${tm.key}`)}
              <span className="sr-only">
                {" "}
                · {tm.renewable ? t("paywall.termRenews") : t("paywall.termOneTime")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Deferred purchase. Its own screen, because the single worst thing this sheet
 * used to do was call this "cancelled" — the money may yet be taken and the user
 * would have had no idea why nothing happened.
 */
function PendingPanel({ onDone, t }: { onDone: () => void; t: T }) {
  return (
    <div className="mt-6 rounded-2xl bg-surface p-5 ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
      <div className="flex items-center gap-2 text-warning">
        <Clock aria-hidden className="h-4 w-4" />
        <span className="label-micro">{t("paywall.pendingTitle")}</span>
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-text dark:text-text-dark">
        {t("paywall.pendingBody")}
      </p>
      <p className="mt-2 text-[13px] text-muted dark:text-muted-dark">
        {t("paywall.pendingNoCharge")}
      </p>
      <Button variant="outline" className="mt-4 w-full" onClick={onDone}>
        {t("paywall.pendingClose")}
      </Button>
    </div>
  );
}

function UnavailablePanel({
  title,
  body,
  retryLabel,
  onRetry,
}: {
  title: string;
  body: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="mt-6 rounded-2xl bg-surface p-5 ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
      <div className="flex items-center gap-2 text-muted dark:text-muted-dark">
        <AlertTriangle aria-hidden className="h-4 w-4" />
        <span className="label-micro">{title}</span>
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-text dark:text-text-dark">{body}</p>
      <Button variant="outline" className="mt-4 w-full" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

function CatalogSkeleton({ label }: { label: string }) {
  return (
    <div className="mt-5 grid gap-2.5" aria-hidden>
      <span className="sr-only">{label}</span>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-2xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark"
        />
      ))}
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: "danger" | "warning" | "muted";
  icon: typeof AlertTriangle;
  children: ReactNode;
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger ring-danger/30"
      : tone === "warning"
        ? "text-warning ring-warning/30"
        : "text-muted ring-border dark:text-muted-dark dark:ring-border-dark";
  return (
    <div
      className={cn(
        "mt-4 flex items-start gap-2 rounded-2xl bg-surface p-3 text-[13px] ring-1 dark:bg-surface-elev-dark",
        toneClass,
      )}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/**
 * Bridge errors carry stable `iap_*` codes with their own copy; anything else
 * (an API failure during verification, a network drop) goes through the shared
 * translator.
 */
function iapMessage(e: unknown, t: T): string {
  const code = e instanceof Error ? e.message : "";
  if (/^(iap_[a-z_]+|no_purchases)$/.test(code)) {
    const msg = t(`errors.${code}`, { defaultValue: "" });
    if (msg) return msg;
  }
  return friendlyError(e, t);
}
