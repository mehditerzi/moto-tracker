import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, RotateCw, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Live `navigator.onLine`. Re-renders when connectivity flips so the copy stops
 *  blaming the server once the user walks back into signal. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

interface Props {
  /** Omit to render an explanation with no action (rare — prefer giving one). */
  onRetry?: () => void;
  /** Overrides the generic "couldn't load" headline. */
  title?: string;
  /** Overrides the connectivity-derived explanation — for failures we can name
   *  precisely (a 404, say), where "the server hit a problem" would be wrong. */
  description?: string;
  /** Rendered under the retry button — a second way out (e.g. "back to garage"). */
  children?: React.ReactNode;
}

/**
 * The app's one "this screen couldn't load" treatment. Every list and detail
 * screen used to dead-end on a bare red sentence: on the dashboard — the app's
 * front door — a blipped request or a tunnel with no signal left the user with
 * nothing to do but force-quit. This always offers the next action, and names
 * the actual problem: being told to "try again" while the phone has no signal
 * is noise, so offline gets its own icon and copy.
 */
export function ErrorState({ onRetry, title, description, children }: Props) {
  const { t } = useTranslation();
  const online = useOnline();
  const Icon = online ? AlertTriangle : WifiOff;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center"
    >
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-danger/10 text-danger ring-1 ring-danger/25">
        <Icon className="h-6 w-6" strokeWidth={1.7} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-balance text-[18px] font-semibold tracking-tight">
          {title ?? t("dashboard.loadFailed")}
        </h2>
        <p className="text-pretty text-[14px] text-muted dark:text-muted-dark">
          {description ?? (online ? t("errors.server") : t("errors.network"))}
        </p>
      </div>
      {onRetry && (
        <Button variant="accent" onClick={onRetry}>
          <RotateCw className="h-4 w-4" /> {t("common.retry")}
        </Button>
      )}
      {children}
    </motion.div>
  );
}
