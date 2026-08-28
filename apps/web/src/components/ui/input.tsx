import * as React from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "@/components/ui/field";
import { controlClasses, type ControlSize } from "@/components/ui/control";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Control scale — see ui/control.ts. `md` (44px) unless a dense fleet toolbar. */
  controlSize?: ControlSize;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", controlSize = "md", ...props }, ref) => {
    // id + aria-invalid/aria-describedby when rendered inside a <Field>.
    const field = useFieldControl();
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          controlClasses(controlSize),
          // Dates and times are figures: tabular numerals stop the digits
          // shuffling sideways as the value changes.
          (type === "date" || type === "time" || type === "datetime-local") && "num",
          className,
        )}
        {...field}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
