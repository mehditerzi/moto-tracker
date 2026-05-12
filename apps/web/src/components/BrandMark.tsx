import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

/**
 * Wordmark: a compact monoline motorcycle silhouette with a lime "ignition dot"
 * on top of the front wheel, paired with the wordmark in tight tracking. The
 * dot is the only colour — it ties the brand mark to the accent used for
 * primary actions.
 */
export function BrandMark({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn("flex items-center gap-2.5", className)}
      aria-label="MotoTracker"
    >
      <svg
        width="26"
        height="20"
        viewBox="0 0 52 40"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        {/* Rear & front wheels */}
        <circle cx="12" cy="28" r="8" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="40" cy="28" r="8" stroke="currentColor" strokeWidth="2.5" />
        {/* Frame: rear wheel ↗ saddle ↘ front wheel */}
        <path
          d="M12 28 L22 14 L34 14 L40 28"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Handlebar stub */}
        <path
          d="M34 14 L36 10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Ignition dot — only colour in the mark */}
        <circle cx="40" cy="6" r="3" fill="#E1FF4D" />
      </svg>
      {showWordmark && (
        <span className="text-[15px] font-semibold tracking-tight">
          Moto<span className="text-muted dark:text-muted-dark">Tracker</span>
        </span>
      )}
    </motion.div>
  );
}
