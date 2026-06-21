import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }, []);

  // Close on Escape while open.
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {createPortal(
        <AnimatePresence>
          {opts && (
            <motion.div
              className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50 pb-safe pl-safe pr-safe"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => close(false)}
            >
              <motion.div
                role="alertdialog"
                aria-modal="true"
                aria-label={opts.title}
                className="mx-auto mb-2 w-full max-w-md overflow-hidden rounded-2xl"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="rounded-2xl bg-surface-elev p-4 text-center dark:bg-surface-elev-dark">
                  <p className="text-[15px] font-semibold">{opts.title}</p>
                  {opts.message && (
                    <p className="mt-1 text-[13px] text-muted dark:text-muted-dark">{opts.message}</p>
                  )}
                  <button
                    type="button"
                    autoFocus
                    onClick={() => close(true)}
                    className={`mt-4 min-h-[48px] w-full rounded-xl px-4 text-[15px] font-semibold transition ${
                      opts.destructive
                        ? "bg-danger/10 text-danger"
                        : "bg-accent text-black"
                    }`}
                  >
                    {opts.confirmLabel ?? t("common.confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => close(false)}
                    className="mt-2 min-h-[48px] w-full rounded-xl px-4 text-[15px] font-medium text-muted transition hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
                  >
                    {opts.cancelLabel ?? t("common.cancel")}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </ConfirmContext.Provider>
  );
}
