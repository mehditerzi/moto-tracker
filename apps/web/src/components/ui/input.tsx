import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-[15px] leading-none text-text shadow-card/0 transition",
        "placeholder:text-muted dark:placeholder:text-muted-dark",
        "hover:border-border-strong dark:hover:border-border-strong-dark",
        "focus-visible:outline-none focus-visible:border-text/40 focus-visible:ring-2 focus-visible:ring-accent/40 dark:focus-visible:border-text-dark/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-border-dark dark:bg-surface-elev-dark dark:text-text-dark",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
