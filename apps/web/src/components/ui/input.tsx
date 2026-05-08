import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm",
        "placeholder:text-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-border-dark dark:bg-surface-dark dark:text-text-dark",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
