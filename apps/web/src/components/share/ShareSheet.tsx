import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The bottom sheet the sharing flows live in.
 *
 * Sharing has no routes of its own on purpose: every one of these flows starts
 * from a vehicle the user is already looking at ("share this car", "somebody is
 * asking about this car"), and a sheet keeps that context on screen. It also
 * means the feature adds nothing to the router, which is owned elsewhere.
 *
 * Modelled on `PaywallSheet` and `ConfirmSheet` so the app has one sheet
 * behaviour: portal to the body, dim the page, animate from the bottom edge,
 * close on Escape and on a backdrop tap, and respect the safe areas — a sheet
 * that ends under the iOS home indicator is a sheet whose primary button cannot
 * be tapped.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Move focus into the sheet so a keyboard or VoiceOver user is not left
    // behind on the page underneath.
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50 pb-safe pl-safe pr-safe"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className="max-h-[88vh] overflow-y-auto rounded-t-3xl bg-bg p-5 outline-none dark:bg-surface-dark"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex w-full max-w-md flex-col gap-4">
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[19px] font-semibold leading-tight tracking-tight">{title}</h2>
                  {description && (
                    <p className="mt-1 text-pretty text-[13px] leading-relaxed text-muted dark:text-muted-dark">
                      {description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("common.close")}
                  className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface dark:text-muted-dark dark:hover:bg-surface-elev-dark"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              {children}
              {footer}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * The role picker, and the most important control in the whole feature.
 *
 * It is a pair of full-width cards rather than a dropdown because the choice is
 * not a preference, it is a disclosure: one of these options shows another
 * person everywhere you have driven and every document you have scanned, and the
 * other does not. That has to be readable at a glance, before the tap.
 */
export function RolePicker({
  value,
  onChange,
}: {
  value: "member" | "guest";
  onChange: (v: "member" | "guest") => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t("share.roleLabel")} className="flex flex-col gap-2">
      {(["guest", "member"] as const).map((role) => (
        <button
          key={role}
          type="button"
          role="radio"
          aria-checked={value === role}
          onClick={() => onChange(role)}
          className={cn(
            "rounded-2xl border p-3.5 text-left transition",
            value === role
              ? "border-accent bg-accent/5"
              : "border-border hover:border-text/20 dark:border-border-dark dark:hover:border-text-dark/20",
          )}
        >
          <div className="text-[14px] font-semibold">{t(`share.role.${role}.title`)}</div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted dark:text-muted-dark">
            {t(`share.role.${role}.body`)}
          </div>
        </button>
      ))}
    </div>
  );
}
