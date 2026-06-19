import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Share } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed-session";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

function isIosSafari() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const safari = /^((?!chrome|android|fxios|crios).)*safari/i.test(navigator.userAgent);
  return ios && safari;
}

export function InstallBanner() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || sessionStorage.getItem(DISMISSED_KEY)) return;

    if (isIosSafari()) {
      setIos(true);
      const tid = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(tid);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setShow(false);
    sessionStorage.setItem(DISMISSED_KEY, "1");
  };

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    setShow(false);
    if (outcome === "accepted") sessionStorage.setItem(DISMISSED_KEY, "1");
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 80 }}
          transition={{ type: "spring", damping: 22, stiffness: 280 }}
          className="pointer-events-auto fixed inset-x-4 bottom-6 z-50 mx-auto max-w-sm"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-xl dark:border-border-dark dark:bg-surface-dark">
            <img src="/favicon.svg" alt="" className="h-10 w-10 flex-shrink-0 rounded-xl" />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{t("install.title")}</p>
              <p className="mt-0.5 text-xs leading-tight text-muted dark:text-muted-dark">
                {ios ? t("install.iosHint") : t("install.subtitle")}
              </p>
            </div>

            {ios ? (
              <Share className="h-5 w-5 flex-shrink-0 text-accent" />
            ) : (
              <button
                onClick={install}
                className="flex-shrink-0 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-white active:opacity-80"
              >
                {t("install.add")}
              </button>
            )}

            <button
              onClick={dismiss}
              aria-label={t("common.dismiss")}
              className="flex-shrink-0 rounded-lg p-1 text-muted transition hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
