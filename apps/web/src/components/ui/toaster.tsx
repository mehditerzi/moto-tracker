import { AnimatePresence, motion } from "framer-motion";
import { useToasts } from "@/hooks/useToast";
import { cn } from "@/lib/cn";

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center">
      <div className="flex w-full max-w-sm flex-col gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              className={cn(
                "pointer-events-auto rounded-xl border bg-surface p-3 shadow-md",
                "dark:bg-surface-dark dark:border-border-dark",
                t.variant === "danger" && "border-danger/40",
                t.variant === "success" && "border-success/40",
              )}
            >
              {t.title && <div className="text-sm font-medium">{t.title}</div>}
              {t.description && <div className="text-sm text-muted dark:text-muted-dark">{t.description}</div>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
