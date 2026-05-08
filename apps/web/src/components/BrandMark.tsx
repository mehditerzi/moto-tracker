import { motion } from "framer-motion";

export function BrandMark({ className }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}
    >
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
        <circle cx="10" cy="22" r="5" fill="none" stroke="currentColor" strokeWidth="2"/>
        <circle cx="22" cy="22" r="5" fill="none" stroke="currentColor" strokeWidth="2"/>
        <path d="M10 22 L16 12 L22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span>MotoTracker</span>
    </motion.div>
  );
}
