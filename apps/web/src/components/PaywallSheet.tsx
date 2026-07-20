import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IAP_TIERS, IAP_PRODUCT_IDS, discountFor, type IapPeriod } from "@mototracker/shared";
import {
  isNativeIapAvailable,
  fetchProducts,
  purchaseTier,
  restorePurchases,
  type StoreKitProduct,
} from "@/lib/nativeIap";
import { ENTITLEMENT_KEY, useEntitlement } from "@/hooks/useEntitlement";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { track } from "@/lib/telemetry";

/** Client-side error codes thrown by the StoreKit bridge, mapped to errors.* copy. */
const BRIDGE_ERRORS = new Set(["iap_plugin_missing", "iap_unavailable"]);

/**
 * The upgrade sheet shown when a user hits the free single-vehicle limit.
 *
 * On iOS it lists the auto-renewable tiers (with live StoreKit prices) and runs
 * the native purchase flow. On web — where App Store IAP can't run — it explains
 * that additional vehicles are managed in the iOS app.
 */
export function PaywallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const native = isNativeIapAvailable();
  const [prices, setPrices] = useState<Record<string, StoreKitProduct>>({});
  const [busy, setBusy] = useState<string | null>(null); // productId or "restore"
  const [period, setPeriod] = useState<IapPeriod>("yearly");
  const ent = useEntitlement();
  // Smallest pack that actually grows the user's garage — highlighted so the
  // obvious next step is one tap, not a study of seven options.
  const needAtLeast = Math.max(ent.data?.activeVehicles ?? 1, ent.data?.maxVehicles ?? 1) + 1;
  const recommended = IAP_TIERS.find((x) => x.period === period && x.maxVehicles >= needAtLeast)?.productId;

  useEffect(() => {
    if (!open || !native) return;
    let cancelled = false;
    fetchProducts([...IAP_PRODUCT_IDS])
      .then((products) => {
        if (cancelled) return;
        setPrices(Object.fromEntries(products.map((p) => [p.id, p])));
      })
      .catch(() => {
        /* fall back to displayPriceTry below */
      });
    return () => {
      cancelled = true;
    };
  }, [open, native]);

  async function onBuy(productId: string) {
    setBusy(productId);
    try {
      const summary = await purchaseTier(productId);
      qc.setQueryData(ENTITLEMENT_KEY, summary);
      qc.invalidateQueries({ queryKey: ["bikes"] });
      track("iap_purchase_success", { productId });
      pushToast({ variant: "success", title: t("paywall.purchaseSuccess") });
      onClose();
    } catch (e) {
      const code = (e as Error).message;
      if (code === "purchase_cancelled") {
        track("iap_purchase_cancelled", { productId });
        return;
      }
      track("iap_purchase_failed", { productId, code });
      pushToast({
        variant: "danger",
        title: BRIDGE_ERRORS.has(code) ? t(`errors.${code}`) : friendlyError(e, t),
      });
    } finally {
      setBusy(null);
    }
  }

  async function onRestore() {
    setBusy("restore");
    try {
      const summary = await restorePurchases();
      qc.setQueryData(ENTITLEMENT_KEY, summary);
      qc.invalidateQueries({ queryKey: ["bikes"] });
      pushToast({ variant: "success", title: t("paywall.restoreSuccess") });
      onClose();
    } catch (e) {
      const code = (e as Error).message;
      pushToast({
        variant: "danger",
        title: code === "no_purchases" ? t("paywall.restoreNone") : friendlyError(e, t),
      });
    } finally {
      setBusy(null);
    }
  }

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
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-md rounded-t-3xl bg-bg p-6 pb-8 ring-1 ring-border dark:bg-bg-dark dark:ring-border-dark sm:rounded-3xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <button
              onClick={onClose}
              aria-label={t("common.close")}
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface dark:text-muted-dark dark:hover:bg-surface-elev-dark"
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="text-[22px] font-semibold leading-tight tracking-tight">
              {t("paywall.title")}
            </h2>
            <p className="mt-1.5 text-[14px] text-muted dark:text-muted-dark">
              {t("paywall.subtitle")}
            </p>

            {!native ? (
              <div className="mt-6 rounded-2xl bg-surface p-4 text-[14px] text-muted ring-1 ring-border dark:bg-surface-elev-dark dark:text-muted-dark dark:ring-border-dark">
                {t("paywall.webNotice")}
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-2xl bg-surface-elev p-1 dark:bg-surface-elev-dark">
                  {(["yearly", "monthly"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={`rounded-xl py-2 text-[13px] font-medium transition ${
                        period === p
                          ? "bg-surface shadow-card text-text dark:bg-surface-dark dark:text-text-dark"
                          : "text-muted dark:text-muted-dark"
                      }`}
                    >
                      {t(`paywall.${p}`)}
                    </button>
                  ))}
                </div>

                <p className="mt-2 text-center text-[12px] text-muted dark:text-muted-dark">
                  {period === "yearly" ? t("paywall.yearlyHint") : t("paywall.monthlyHint")}
                </p>

                <div className="mt-3 grid max-h-[45vh] gap-2.5 overflow-y-auto">
                  {IAP_TIERS.filter((tier) => tier.period === period).map((tier) => {
                    const live = prices[tier.productId];
                    const price = live?.displayPrice ?? `₺${tier.displayPriceTry}`;
                    const isBusy = busy === tier.productId;
                    const discount = discountFor(tier.maxVehicles);
                    const isRecommended = tier.productId === recommended;
                    return (
                      <div
                        key={tier.productId}
                        className={`flex items-center justify-between gap-3 rounded-2xl bg-surface p-4 ring-1 dark:bg-surface-elev-dark ${
                          isRecommended
                            ? "ring-2 ring-accent"
                            : "ring-border dark:ring-border-dark"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[15px] font-semibold">
                            <Check className="h-4 w-4 shrink-0 text-accent" />
                            {t("paywall.tierVehicles", { count: tier.maxVehicles })}
                            {isRecommended && (
                              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-black">
                                {t("paywall.recommended")}
                              </span>
                            )}
                            {discount > 0 && (
                              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-dim">
                                {t("paywall.discount", { percent: Math.round(discount * 100) })}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[13px] text-muted dark:text-muted-dark">
                            {t(period === "yearly" ? "paywall.perYear" : "paywall.perMonth", { price })}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="accent"
                          disabled={busy !== null}
                          onClick={() => onBuy(tier.productId)}
                        >
                          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("paywall.choose")}
                        </Button>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={onRestore}
                  disabled={busy !== null}
                  className="mt-4 w-full text-center text-[13px] text-muted underline underline-offset-4 disabled:opacity-50 dark:text-muted-dark"
                >
                  {busy === "restore" ? t("paywall.restoring") : t("paywall.restore")}
                </button>
                <p className="mt-3 text-center text-[11px] leading-relaxed text-muted/80 dark:text-muted-dark/80">
                  {t("paywall.legal")}
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
