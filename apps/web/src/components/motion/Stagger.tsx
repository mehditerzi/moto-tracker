import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

/**
 * Lists that settle into place one row after another instead of popping in as
 * a block. 30ms apart, capped so a long list never makes the last row wait.
 */
export function StaggerItem({
  index,
  children,
  ...rest
}: { index: number } & HTMLMotionProps<"div">) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, x: -24, transition: { duration: 0.18 } }}
      transition={{ duration: 0.24, delay: Math.min(index, 10) * 0.03, ease: [0.2, 0.8, 0.2, 1] }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
