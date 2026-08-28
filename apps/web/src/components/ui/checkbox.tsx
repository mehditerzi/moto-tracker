import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "@/components/ui/field";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  label: React.ReactNode;
  /** Second line under the label. */
  description?: string;
}

/**
 * Label + box, as one 44px-tall tap target.
 *
 * Both existing checkboxes in the app were wrong in opposite directions: the
 * fuel "full tank" control was a `<button>` painted to look like a checkbox
 * (no role, no `aria-checked`, invisible to assistive tech and to the keyboard
 * as a checkbox), and the fleet "include archived" one was a bare 16px native
 * box with a 16px tap target. This is a real `<input type="checkbox">` — so it
 * is announced, focusable and toggleable with Space — that is visually hidden
 * behind a drawn box the design system controls.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, disabled, ...props }, ref) => {
    const field = useFieldControl();
    return (
      <label
        className={cn(
          "group inline-flex min-h-[44px] cursor-pointer select-none items-center gap-2.5",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <input ref={ref} type="checkbox" className="peer sr-only" disabled={disabled} {...field} {...props} />
        <span
          aria-hidden
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-md border border-border text-transparent transition",
            "dark:border-border-dark",
            "peer-checked:border-accent peer-checked:bg-accent peer-checked:text-black",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg dark:peer-focus-visible:ring-offset-bg-dark",
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] leading-tight text-text dark:text-text-dark">{label}</span>
          {description && (
            <span className="text-[12px] leading-snug text-muted dark:text-muted-dark">
              {description}
            </span>
          )}
        </span>
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
