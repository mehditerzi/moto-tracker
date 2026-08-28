import * as React from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "@/components/ui/field";
import { CONTROL_CHROME, controlClasses, type ControlSize } from "@/components/ui/control";

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  controlSize?: ControlSize;
  /**
   * `hero` is the big centred date used on the two screens whose *only* real
   * question is a date — the dated-item form and the single-document review.
   * Both had hand-rolled copies of it that had already drifted apart (one wired
   * an error state, the other did not).
   */
  variant?: "default" | "hero";
}

/**
 * A native date control, so every platform gives its own picker and its own
 * locale ordering (GG.AA.YYYY in Turkish) for free.
 *
 * Tabular numerals matter more here than anywhere: without them the digits
 * shift horizontally as the value changes and a centred hero date visibly
 * twitches while you scroll the picker.
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ className, controlSize = "md", variant = "default", ...props }, ref) => {
    const field = useFieldControl();
    return (
      <input
        ref={ref}
        type="date"
        className={cn(
          "num",
          variant === "hero"
            ? cn(
                CONTROL_CHROME,
                "rounded-2xl px-4 py-4 text-center text-[22px] font-semibold tracking-tight",
                "aria-[invalid=true]:text-danger",
              )
            : controlClasses(controlSize),
          className,
        )}
        {...field}
        {...props}
      />
    );
  },
);
DateInput.displayName = "DateInput";
