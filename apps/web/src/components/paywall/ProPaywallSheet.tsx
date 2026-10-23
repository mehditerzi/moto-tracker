import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Car,
  Check,
  Crown,
  FileSpreadsheet,
  FolderLock,
  Loader2,
  ScanLine,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRO_PRODUCTS, PRO_PRODUCT_IDS, type IapTier } from "@mototracker/shared";
import {
  isNativeIapAvailable,
  fetchProductCatalog,
  purchaseTier,
  restorePurchases,
  onEntitlementGranted,
  type ProductCatalog,
  type StoreKitProduct,
} from "@/lib/nativeIap";
import { ENTITLEMENT_KEY, useEntitlement } from "@/hooks/useEntitlement";
import { pushToast } from "@/hooks/useToast";
import { hapticSelection, hapticSuccess } from "@/lib/haptics";
import { track } from "@/lib/telemetry";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { PaywallSheet as PackPaywallSheet, iapMessage } from "@/components/PaywallSheet";
import type { PaywallReason } from "@/components/paywall/PaywallContext";

const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PRIVACY_URL = "https://mototracker.mehditerzi.com/privacy";
const APP_STORE_URL = "https://apps.apple.com/tr/app/id6783515081";

type Flow = { kind: "idle" } | { kind: "cancelled" } | { kind: "pending" } | { kind: "error"; message: string };

const BENEFITS: { key: string; icon: LucideIcon }[] = [
  { key: "vehicles", icon: Car },
  { key: "scans", icon: ScanLine },
  { key: "export", icon: FileSpreadsheet },
  { key: "glovebox", icon: FolderLock },
];

/** The benefit the user just reached for goes first. */
function orderedBenefits(reason: PaywallReason) {
  const lead = BENEFITS.find((b) => b.key === reason);
  return lead ? [lead, ...BENEFITS.filter((b) => b !== lead)] : BENEFITS;
}

/**
 * Garajım Pro. One subscription, two terms, a free trial on the way in.
 *
 * The sheet decides between three things it can honestly show:
 *   • Pro, when StoreKit hands back at least one pro.* product;
 *   • the legacy vehicle-pack sheet, when it does not (the Pro products are
 *     still in review, or this binary predates them) and the user hit the
 *     vehicle ceiling — the packs are still approved and purchasable;
 *   • on the web, what Pro is and where to get it.
 */
export function ProPaywallSheet({
  open,
  reason,
  onClose,
}: {
  open: boolean;
  reason: PaywallReason;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const native = isNativeIapAvailable();
  const ent = useEntitlement();
  const reduce = useReducedMotion();

  const [catalog, setCatalog] = useState<ProductCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(PRO_PRODUCTS[0]!.productId);
  const [busy, setBusy] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const [celebrate, setCelebrate] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (force = false) => {
    setCatalogError(null);
    try {
      setCatalog(await fetchProductCatalog([...PRO_PRODUCT_IDS], { force }));
    } catch (e) {
      setCatalog(null);
      setCatalogError((e as Error).message);
      track("iap_products_failed", { code: (e as Error).message, scope: "pro" });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setFlow({ kind: "idle" });
    setBusy(null);
    setCelebrate(false);
    track("paywall_shown", { reason, native });
    if (native) void load();
  }, [open, native, load, reason]);

  const products = useMemo(() => {
    const map = new Map((catalog?.products ?? []).map((p) => [p.id, p]));
    return PRO_PRODUCTS.flatMap((tier) => {
      const p = map.get(tier.productId);
      return p ? [{ tier, product: p }] : [];
    });
  }, [catalog]);

  const loaded = catalog !== null || catalogError !== null;
  const proAvailable = products.length > 0;

  const succeed = useCallback(() => {
    hapticSuccess();
    setCelebrate(true);
    track("pro_unlocked", { reason });
    pushToast({ variant: "success", title: t("pro.welcome") });
    setTimeout(onClose, reduce ? 300 : 1400);
  }, [onClose, reason, reduce, t]);

  // A deferred purchase (Ask to Buy) that lands while the sheet is open.
  useEffect(() => {
    if (!open) return;
    return onEntitlementGranted(() => {
      setFlow({ kind: "idle" });
      setBusy(null);
      succeed();
    });
  }, [open, succeed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function buy(productId: string) {
    setBusy(productId);
    setFlow({ kind: "idle" });
    track("pro_purchase_tapped", { productId, reason });
    try {
      const result = await purchaseTier(productId);
      if (result.status === "success") {
        qc.setQueryData(ENTITLEMENT_KEY, result.entitlement);
        track("iap_purchase_success", { productId });
        succeed();
        return;
      }
      if (result.status === "pending") {
        setFlow({ kind: "pending" });
        return;
      }
      track("iap_purchase_cancelled", { productId });
      setFlow({ kind: "cancelled" });
    } catch (e) {
      const code = (e as Error).message;
      if (code === "iap_cancelled") {
        setFlow({ kind: "cancelled" });
        return;
      }
      track("iap_purchase_failed", { productId, code });
      setFlow({ kind: "error", message: iapMessage(e, t) });
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setBusy("restore");
    setFlow({ kind: "idle" });
    try {
      const summary = await restorePurchases();
      qc.setQueryData(ENTITLEMENT_KEY, summary);
      if (summary.pro) succeed();
      else pushToast({ variant: "success", title: t("paywall.restoreSuccess") });
    } catch (e) {
      const code = (e as Error).message;
      setFlow({
        kind: "error",
        message: code === "no_purchases" ? t("paywall.restoreNone") : iapMessage(e, t),
      });
    } finally {
      setBusy(null);
    }
  }

  // Pro is not purchasable on this device yet (still in review, or an older
  // binary) — hand a vehicle-limit hit to the pack sheet, which still sells.
  if (open && native && loaded && !proAvailable && (reason === "vehicles" || reason === "generic")) {
    return <PackPaywallSheet open onClose={onClose} />;
  }

  const chosen = products.find((p) => p.tier.productId === selected) ?? products[0];
  const monthly = products.find((p) => p.tier.termKey === "monthly");
  const trial = chosen?.product.introOffer?.paymentMode === "freeTrial" && chosen.product.eligibleForIntro !== false
    ? chosen.product.introOffer
    : null;

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
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pro-title"
            tabIndex={-1}
            className="relative z-10 flex max-h-[94dvh] w-full max-w-md flex-col overflow-y-auto overscroll-contain rounded-t-[28px] bg-bg pb-safe ring-1 ring-border focus:outline-none dark:bg-bg-dark dark:ring-border-dark sm:rounded-[28px]"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            {/* ── hero ─────────────────────────────────────────────────── */}
            <div className="relative shrink-0 overflow-hidden px-6 pb-4 pt-6">
              <div
                aria-hidden
                className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[140%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,rgba(225,255,77,0.28),transparent)]"
              />
              <button
                onClick={onClose}
                aria-label={t("common.close")}
                className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-surface/70 text-muted backdrop-blur transition hover:text-text dark:bg-surface-elev-dark/70 dark:text-muted-dark"
              >
                <X className="h-4 w-4" />
              </button>
              <motion.div
                className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-accent text-black shadow-ignite"
                initial={reduce ? false : { scale: 0.7, rotate: -12, opacity: 0 }}
                animate={celebrate ? { scale: [1, 1.18, 1], rotate: [0, -8, 8, 0] } : { scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 16 }}
              >
                <Crown className="h-8 w-8" strokeWidth={2.2} />
              </motion.div>
              <h2 id="pro-title" className="relative mt-4 text-center text-[26px] font-semibold leading-tight tracking-tight">
                {t("pro.title")}
              </h2>
              <p className="relative mx-auto mt-1.5 max-w-[32ch] text-balance text-center text-[14px] leading-relaxed text-muted dark:text-muted-dark">
                {t(`pro.reason.${reason}`, {
                  used: ent.data?.scansUsed ?? 0,
                  limit: ent.data?.scanLimit ?? 0,
                })}
              </p>
            </div>

            {celebrate && <Confetti />}

            <div className="flex shrink-0 flex-col px-6 pb-6">
              {/* ── benefits ─────────────────────────────────────────────── */}
              <ul className="flex flex-col gap-2">
                {orderedBenefits(reason).map(({ key, icon: Icon }, i) => (
                  <motion.li
                    key={key}
                    className="flex items-center gap-3"
                    initial={reduce ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + i * 0.05, duration: 0.25 }}
                  >
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1",
                        i === 0 && reason !== "generic"
                          ? "bg-accent/15 text-accent-dim ring-accent/40 dark:text-accent"
                          : "bg-surface text-text ring-border dark:bg-surface-elev-dark dark:text-text-dark dark:ring-border-dark",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-semibold leading-tight">{t(`pro.benefit.${key}.title`)}</div>
                      <div className="text-[12.5px] leading-snug text-muted dark:text-muted-dark">
                        {t(`pro.benefit.${key}.body`)}
                      </div>
                    </div>
                  </motion.li>
                ))}
              </ul>

              {!native ? (
                <div className="mt-6 flex flex-col gap-3">
                  <p className="rounded-2xl bg-surface p-4 text-[13.5px] leading-relaxed text-muted ring-1 ring-border dark:bg-surface-elev-dark dark:text-muted-dark dark:ring-border-dark">
                    {t("pro.webNotice")}
                  </p>
                  <Button asChild size="lg" variant="accent" className="w-full">
                    <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
                      {t("pro.openAppStore")}
                    </a>
                  </Button>
                </div>
              ) : flow.kind === "pending" ? (
                <div className="mt-6 rounded-2xl bg-surface p-4 text-[14px] ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
                  <div className="font-semibold">{t("paywall.pendingTitle")}</div>
                  <p className="mt-1 text-[13px] text-muted dark:text-muted-dark">{t("paywall.pendingBody")}</p>
                  <Button className="mt-3 w-full" variant="outline" onClick={onClose}>
                    {t("common.close")}
                  </Button>
                </div>
              ) : !loaded ? (
                <div className="mt-6 flex flex-col gap-2.5" aria-busy>
                  <div className="h-[76px] animate-pulse rounded-2xl bg-surface dark:bg-surface-elev-dark" />
                  <div className="h-[76px] animate-pulse rounded-2xl bg-surface dark:bg-surface-elev-dark" />
                  <div className="h-12 animate-pulse rounded-xl bg-surface dark:bg-surface-elev-dark" />
                </div>
              ) : !proAvailable ? (
                <div className="mt-6 rounded-2xl bg-surface p-4 text-[13.5px] ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
                  <div className="font-semibold">{t("pro.unavailableTitle")}</div>
                  <p className="mt-1 text-muted dark:text-muted-dark">{t("pro.unavailableBody")}</p>
                  <Button className="mt-3 w-full" variant="outline" onClick={() => void load(true)}>
                    {t("paywall.retry")}
                  </Button>
                </div>
              ) : (
                <>
                  {/* ── plans ─────────────────────────────────────────────── */}
                  <div role="radiogroup" aria-label={t("pro.choosePlan")} className="mt-6 flex flex-col gap-2.5">
                    {products.map(({ tier, product }) => (
                      <PlanCard
                        key={tier.productId}
                        tier={tier}
                        product={product}
                        monthly={monthly?.product}
                        monthlyTier={monthly?.tier}
                        selected={chosen?.tier.productId === tier.productId}
                        onSelect={() => {
                          if (selected !== tier.productId) hapticSelection();
                          setSelected(tier.productId);
                        }}
                      />
                    ))}
                  </div>

                  {catalog && !catalog.canMakePayments && (
                    <Notice tone="warning">{t("paywall.paymentsDisabled")}</Notice>
                  )}

                  {/* Pinned: on a short phone the plans push the button below
                      the fold, and an offer you have to scroll to accept is a
                      worse offer. */}
                  <div className="sticky bottom-0 z-10 -mx-6 mt-2 bg-gradient-to-t from-bg via-bg to-bg/0 px-6 pb-1 pt-3 dark:from-bg-dark dark:via-bg-dark dark:to-bg-dark/0">
                  <Button
                    size="lg"
                    variant="accent"
                    className="h-14 w-full text-[16px]"
                    disabled={busy !== null || !chosen}
                    onClick={() => chosen && void buy(chosen.tier.productId)}
                  >
                    {busy === chosen?.tier.productId ? (
                      <>
                        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                        {t("paywall.processing")}
                      </>
                    ) : trial ? (
                      t("pro.startTrial", { count: trialDays(trial.period, trial.periodCount) })
                    ) : (
                      t("pro.subscribe")
                    )}
                  </Button>
                  <p className="mt-2 text-center text-[12px] text-muted dark:text-muted-dark">
                    {chosen &&
                      (trial
                        ? t("pro.trialThen", {
                            count: trialDays(trial.period, trial.periodCount),
                            price: chosen.product.displayPrice,
                            period: t(`pro.per.${chosen.tier.termKey}`),
                          })
                        : t("pro.renews", {
                            price: chosen.product.displayPrice,
                            period: t(`pro.per.${chosen.tier.termKey}`),
                          }))}
                  </p>
                  </div>
                </>
              )}

              {flow.kind === "error" && <Notice tone="danger">{flow.message}</Notice>}
              {flow.kind === "cancelled" && <Notice tone="muted">{t("paywall.cancelled")}</Notice>}

              {native && (
                <button
                  onClick={() => void restore()}
                  disabled={busy !== null}
                  className="mt-4 self-center rounded-lg px-3 py-2 text-[13px] text-muted underline underline-offset-4 disabled:opacity-50 dark:text-muted-dark"
                >
                  {busy === "restore" ? t("paywall.restoring") : t("paywall.restore")}
                </button>
              )}
              <p className="mt-2 text-center text-[11px] leading-relaxed text-muted/80 dark:text-muted-dark/80">
                {t("pro.legal")}
              </p>
              <p className="mt-2 flex items-center justify-center gap-3 text-[11px] text-muted/80 dark:text-muted-dark/80">
                <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="px-1 py-1 underline underline-offset-4">
                  {t("paywall.terms")}
                </a>
                <span aria-hidden>·</span>
                <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="px-1 py-1 underline underline-offset-4">
                  {t("paywall.privacy")}
                </a>
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function trialDays(period: { unit: string; value: number }, count: number): number {
  const per = period.unit === "week" ? 7 : period.unit === "month" ? 30 : period.unit === "year" ? 365 : 1;
  return per * period.value * Math.max(1, count);
}

/** Price as a number: StoreKit's when the binary reports it, else the catalogue's. */
function numericPrice(tier: IapTier, product?: StoreKitProduct): number {
  return product?.price ?? tier.displayPriceTry;
}

function PlanCard({
  tier,
  product,
  monthly,
  monthlyTier,
  selected,
  onSelect,
}: {
  tier: IapTier;
  product: StoreKitProduct;
  monthly?: StoreKitProduct;
  monthlyTier?: IapTier;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const yearly = tier.termKey === "yearly";
  const perMonth = numericPrice(tier, product) / tier.termMonths;
  const saving =
    yearly && monthlyTier
      ? Math.round((1 - numericPrice(tier, product) / (numericPrice(monthlyTier, monthly) * 12)) * 100)
      : 0;
  // Only state a per-month figure in lira when we know the price IS lira.
  const liraPerMonth = !product.currencyCode || product.currencyCode === "TRY";
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "relative flex items-center gap-3 rounded-2xl p-4 text-left ring-1 transition-colors",
        selected
          ? "bg-accent/10 ring-2 ring-accent"
          : "bg-surface ring-border hover:ring-text/20 dark:bg-surface-elev-dark dark:ring-border-dark",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-full ring-2 transition",
          selected ? "bg-accent ring-accent" : "ring-border dark:ring-border-dark",
        )}
      >
        {selected && <Check className="h-3.5 w-3.5 text-black" strokeWidth={3} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[15.5px] font-semibold">{t(`pro.plan.${tier.termKey}`)}</span>
          {saving > 0 && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-black">
              {t("pro.save", { percent: saving })}
            </span>
          )}
        </div>
        {yearly && liraPerMonth && (
          <div className="num mt-0.5 text-[12.5px] text-muted dark:text-muted-dark">
            {t("pro.perMonthEquivalent", { price: formatMoney(perMonth, 2) })}
          </div>
        )}
      </div>
      <div className="text-right">
        <div className="num text-[16px] font-semibold">{product.displayPrice}</div>
        <div className="text-[11.5px] text-muted dark:text-muted-dark">{t(`pro.per.${tier.termKey}`)}</div>
      </div>
    </motion.button>
  );
}

function Notice({ tone, children }: { tone: "warning" | "danger" | "muted"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px]",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "warning" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        tone === "muted" && "bg-surface text-muted dark:bg-surface-elev-dark dark:text-muted-dark",
      )}
    >
      {tone !== "muted" && <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

/** A short burst of lime confetti — the one moment the app is allowed to party. */
function Confetti() {
  const reduce = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 340,
        y: 120 + Math.random() * 260,
        r: (Math.random() - 0.5) * 540,
        d: Math.random() * 0.15,
        w: 6 + Math.random() * 6,
        c: ["#E1FF4D", "#ffffff", "#B8D63A", "#7dd3fc"][i % 4],
      })),
    [],
  );
  if (reduce) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-[2px]"
          style={{ width: p.w, height: p.w * 0.45, background: p.c }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{ x: p.x, y: p.y, rotate: p.r, opacity: 0 }}
          transition={{ duration: 1.1, delay: p.d, ease: [0.15, 0.6, 0.35, 1] }}
        />
      ))}
    </div>
  );
}
