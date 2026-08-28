import * as React from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "@/components/ui/field";
import { controlClasses, type ControlSize } from "@/components/ui/control";

/**
 * Strip everything that is not part of a number, and accept the decimal
 * separator a Turkish keyboard actually produces.
 *
 * This is the reason this component exists rather than `<Input type="number">`.
 * On a `tr` locale the numeric keypad's separator key emits `,`; WebKit's
 * number input rejects it and reports `value === ""`, so a user typing `52,4`
 * litres silently submitted nothing. `type="number"` also lets a stray scroll
 * over a focused field change a recorded odometer reading, and renders spinner
 * arrows that are useless on a phone and 12px wide on a desktop.
 */
export function sanitizeNumeric(raw: string, decimal: boolean): string {
  let s = raw.replace(/[\s ]/g, "");
  if (!decimal) return s.replace(/[^0-9]/g, "");
  s = s.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const first = s.indexOf(".");
  if (first === -1) return s;
  return s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, "");
}

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  controlSize?: ControlSize;
  /** Allow a decimal separator (litres, money). Default false — whole numbers. */
  decimal?: boolean;
  /** Unit shown inside the control on the left, e.g. "₺". */
  prefix?: string;
  /** Unit shown inside the control on the right, e.g. "km", "L". */
  suffix?: string;
}

/**
 * A numeric field that opens a numeric keypad, keeps its digits on the tabular
 * grid, and carries its unit inside the control instead of bolted onto the
 * label. Moving the unit here is what lets the label stay short — and short
 * labels are what let a 4-digit field be 4 digits wide.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    { className, controlSize = "md", decimal = false, prefix, suffix, onChange, ...props },
    ref,
  ) => {
    const field = useFieldControl();
    return (
      <div className="relative w-full">
        {prefix && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-muted dark:text-muted-dark"
          >
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          // Deliberately text: see sanitizeNumeric above.
          type="text"
          inputMode={decimal ? "decimal" : "numeric"}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            controlClasses(controlSize),
            "num",
            prefix && "pl-8",
            // Reserve only as much room as the unit needs — a "L" suffix must
            // not steal 48px from a field that is 108px wide by design.
            suffix && (suffix.length > 1 ? "pr-11" : "pr-8"),
            className,
          )}
          {...field}
          {...props}
          onChange={(e) => {
            const clean = sanitizeNumeric(e.target.value, decimal);
            // Rewriting the DOM value before delegating means an uncontrolled
            // consumer (react-hook-form's `register`) reads the sanitised text.
            if (clean !== e.target.value) e.target.value = clean;
            onChange?.(e);
          }}
        />
        {suffix && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-muted dark:text-muted-dark"
          >
            {suffix}
          </span>
        )}
      </div>
    );
  },
);
NumberInput.displayName = "NumberInput";

/** ₺ (or another currency) in the control, decimals on, numeric keypad. */
export const MoneyInput = React.forwardRef<
  HTMLInputElement,
  Omit<NumberInputProps, "decimal" | "prefix"> & { currency?: string }
>(({ currency = "₺", ...props }, ref) => (
  <NumberInput ref={ref} decimal prefix={currency} placeholder="0" {...props} />
));
MoneyInput.displayName = "MoneyInput";
