import * as React from "react";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/label";
import { FIELD_WIDTH, type FieldWidth } from "@/components/ui/control";

interface FieldContextValue {
  controlId: string;
  /** Space-separated ids of the help / error nodes, or undefined when neither. */
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

/** The aria wiring a form control spreads onto its own element. Empty outside a
 *  `<Field>`, so controls can call this unconditionally. */
export interface FieldControlProps {
  id?: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export function useFieldControl(): FieldControlProps {
  const ctx = React.useContext(FieldContext);
  if (!ctx) return {};
  const out: FieldControlProps = { id: ctx.controlId };
  if (ctx.invalid) out["aria-invalid"] = true;
  if (ctx.describedBy) out["aria-describedby"] = ctx.describedBy;
  return out;
}

export interface FieldProps {
  label: string;
  /** Right-aligned annotation beside the label, e.g. a unit. Prefer `optional`. */
  hint?: string;
  /** Marks the field optional with the app's single "optional" wording. */
  optional?: boolean;
  /** One line of help under the label. Announced with the control. */
  description?: string;
  /** Validation message; its presence also marks the control invalid. */
  error?: string;
  /** Control id. Generated when omitted — pass one only for controls that set
   *  their own id (a bare `<select>` / `<textarea>`, say). */
  id?: string;
  /** Content-shaped width. See FIELD_WIDTH — this is the alignment lever. */
  width?: FieldWidth;
  /** Label styling override — the auth screens use the micro caps treatment. */
  labelClassName?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Label + optional help + control + validation message.
 *
 * The message is tied to the control with aria-invalid/aria-describedby and
 * announced through role="alert", so a screen reader user hears *why* a submit
 * failed instead of only the field name. Controls built on Input / Select /
 * Textarea / Combobox / NumberInput pick all of that up from context — nothing
 * to wire per call site.
 *
 * Vertical rhythm is fixed here rather than per form: 6px label→control, and
 * `FormRow` / `CardContent` supply the 16px between fields.
 */
export function Field({
  label,
  hint,
  optional,
  description,
  error,
  id,
  width = "full",
  labelClassName,
  className,
  children,
}: FieldProps) {
  const { t } = useTranslation();
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const errorId = error ? `${controlId}-error` : undefined;
  const helpId = description ? `${controlId}-help` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  const ctx = React.useMemo<FieldContextValue>(
    () => ({ controlId, describedBy, invalid: !!error }),
    [controlId, describedBy, error],
  );

  // One wording for "optional" across the whole app. Call sites used to pass
  // two different strings (bike.optional and fleet.optional) for the same idea.
  const annotation = hint ?? (optional ? t("bike.optional") : undefined);

  return (
    <FieldContext.Provider value={ctx}>
      <div className={cn("flex min-w-0 flex-col gap-1.5", FIELD_WIDTH[width], className)}>
        {/* `flex-wrap` is a safety net, not a layout: when the label and the
            annotation fit — which is the case every time a field is given a
            width that clears its Turkish label — this renders identically. When
            they do not, the annotation drops to a second line instead of
            overflowing the column, because a one-word label like "Kilometre"
            cannot shrink to min-content and the `shrink-0` annotation would
            otherwise spill over whatever sits to the right of the field. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <Label htmlFor={controlId} className={cn("text-pretty", labelClassName)}>
            {label}
          </Label>
          {annotation && (
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted dark:text-muted-dark">
              {annotation}
            </span>
          )}
        </div>
        {description && (
          <p id={helpId} className="-mt-0.5 text-[12px] leading-snug text-muted dark:text-muted-dark">
            {description}
          </p>
        )}
        {children}
        {error && (
          <p id={errorId} role="alert" className="flex items-start gap-1 text-xs text-danger">
            {/* Icon + text, so the error does not rely on red alone. */}
            <AlertCircle className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/**
 * A row of fields. Wraps instead of overflowing, keeps a single horizontal and
 * vertical gap, and tops-aligns so a two-line Turkish label next to a one-line
 * English one does not push its control out of line with the rest of the row.
 */
export const FormRow = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-wrap items-start gap-x-3 gap-y-4", className)} {...props} />
  ),
);
FormRow.displayName = "FormRow";

/**
 * A titled group of related fields. Grouping is what lets the eye scan a form
 * in chunks instead of as one undifferentiated stack; the micro-label matches
 * the instrument-cluster treatment used elsewhere.
 */
export function FormSection({
  title,
  description,
  className,
  children,
}: {
  title?: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {(title || description) && (
        <div className="flex flex-col gap-1">
          {title && (
            <h3 className="label-micro text-muted dark:text-muted-dark">{title}</h3>
          )}
          {description && (
            <p className="text-[12px] leading-snug text-muted dark:text-muted-dark">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
