import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

/**
 * Wordmark: a compact monoline garage silhouette (peaked roof over an
 * up-and-over door) with a lime "light" in the gable — vehicle-agnostic, fitting
 * the name "Garajım" (my garage). The dot is the only colour, tying the mark to
 * the accent used for primary actions.
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
      aria-label="Garajım"
    >
      <svg
        width="26"
        height="20"
        viewBox="0 0 52 40"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        {/* Roof: left eave ↗ apex ↘ right eave */}
        <path
          d="M7 19 L26 6 L45 19"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Walls + floor */}
        <path
          d="M11 19 L11 34 L41 34 L41 19"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Up-and-over garage door with slats */}
        <path
          d="M16 34 L16 25 Q16 23 18 23 L34 23 Q36 23 36 25 L36 34"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M16 28 L36 28 M16 31 L36 31"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Gable light — only colour in the mark */}
        <circle cx="26" cy="14" r="2.4" fill="#E1FF4D" />
      </svg>
      {showWordmark && (
        <span className="text-[15px] font-semibold tracking-tight">
          Garaj<span className="text-muted dark:text-muted-dark">ım</span>
        </span>
      )}
    </motion.div>
  );
}
