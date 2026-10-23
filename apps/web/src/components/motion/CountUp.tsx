import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

/**
 * A number that rolls to its value instead of snapping — the small "the app
 * just did the maths for you" moment on a total. Renders the final value
 * immediately for reduced-motion users and on the first paint of a value that
 * did not change.
 */
export function CountUp({
  value,
  format,
  duration = 0.7,
  className,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setShown(v),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, duration, reduce]);

  return <span className={className}>{format(shown)}</span>;
}
