import { motion, useReducedMotion } from "framer-motion";

/**
 * The tick that draws itself when something is saved. Used inline in a button
 * or a sheet — never on its own, so it never needs to be read aloud.
 */
export function SuccessCheck({ size = 20, className }: { size?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      initial={reduce ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
    >
      <circle cx="12" cy="12" r="11" className="fill-accent" />
      <motion.path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke="black"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.32, delay: 0.08, ease: "easeOut" }}
      />
    </motion.svg>
  );
}
