import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "@/components/ui/field";
import { controlClasses, type ControlSize } from "@/components/ui/control";

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** Control scale — see ui/control.ts. */
  controlSize?: ControlSize;
  /**
   * Rendered as an empty-valued first option. While it is the selection the
   * control reads as placeholder text rather than as a real answer, which is
   * the difference between "not chosen yet" and "chose the first item".
   */
  placeholder?: string;
  /** Classes for the positioning wrapper (width lives here, not on the select). */
  wrapperClassName?: string;
}

/**
 * The app's `<select>`.
 *
 * Every dropdown in the app used to be a bare native element styled at its call
 * site — nine variations across eight files, three different heights, no focus
 * ring on most of them, and no aria wiring. This is that control, once: native
 * (so iOS gives its wheel picker and Android its dialog, which is what people
 * expect and what works offline in the Capacitor WebView), with our chrome, our
 * focus ring, and the `<Field>` aria wiring picked up from context.
 *
 * The chevron is ours rather than the platform's so the control matches `Input`
 * and `Combobox` and so the arrow does not sit in a different place on every OS.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    { className, wrapperClassName, controlSize = "md", placeholder, children, ...props },
    ref,
  ) => {
    const field = useFieldControl();
    const showingPlaceholder =
      placeholder !== undefined && (props.value === "" || props.defaultValue === "");

    return (
      <div className={cn("relative w-full", wrapperClassName)}>
        <select
          ref={ref}
          className={cn(
            controlClasses(controlSize),
            // `block` + a normal line-height rather than the flex/leading-none
            // an <input> gets: Gecko vertically centres a select's text off its
            // line-height, so `leading-none` rides it high in the box there
            // while looking fine in WebKit.
            "block leading-normal",
            // Room for our chevron, and never let a long option name (a fleet
            // customer's full company name) blow the control's width out.
            "cursor-pointer appearance-none truncate pr-9",
            showingPlaceholder && "text-muted dark:text-muted-dark",
            className,
          )}
          {...field}
          {...props}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted dark:text-muted-dark"
        />
      </div>
    );
  },
);
Select.displayName = "Select";

/** Convenience for the common "list of {value,label}" case. */
export function SelectOptions({ options }: { options: { value: string; label: string }[] }) {
  return (
    <>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </>
  );
}
