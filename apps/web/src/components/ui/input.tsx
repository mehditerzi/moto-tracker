import * as React from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "@/components/ui/field";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => {
    // id + aria-invalid/aria-describedby when rendered inside a <Field>.
    const field = useFieldControl();
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          // 16px on phones is deliberate: anything smaller makes iOS zoom the
          // page on focus, which is why the viewport used to be scale-locked.
          // The 15px design size comes back from `sm` up, where there's no zoom.
          "flex h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-base leading-none text-text shadow-card/0 transition sm:text-[15px]",
          "placeholder:text-muted dark:placeholder:text-muted-dark",
          "hover:border-border-strong dark:hover:border-border-strong-dark",
          "focus-visible:outline-none focus-visible:border-text/40 focus-visible:ring-2 focus-visible:ring-accent/40 dark:focus-visible:border-text-dark/40",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:border-border-dark dark:bg-surface-elev-dark dark:text-text-dark",
          className,
        )}
        {...field}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
