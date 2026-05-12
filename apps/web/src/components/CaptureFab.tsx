import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Camera } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  bikeId?: string;
}

/**
 * The capture FAB is the only object that uses the full lime accent. It sits
 * over the bottom-right safe area like a kill-switch / start button — softly
 * "always on" with a glow, weighty press feedback, and a quick spring on hover.
 */
export function CaptureFab({ bikeId }: Props) {
  const { t } = useTranslation();
  const to = bikeId ? `/capture?bikeId=${bikeId}` : "/capture";
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 440, damping: 22 }}
      className="fixed right-5 z-40"
      style={{ bottom: "max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))" }}
    >
      <Link
        to={to}
        aria-label={t("capture.title")}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black shadow-ignite ring-1 ring-black/10 transition hover:bg-accent/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg dark:focus-visible:ring-offset-bg-dark"
      >
        {/* Faint outer ring — sells the "instrument" feeling */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[-6px] rounded-full border border-accent/30"
        />
        <Camera className="h-6 w-6" strokeWidth={2.25} />
      </Link>
    </motion.div>
  );
}
