import * as React from "react";
import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/label";

interface FieldContextValue {
  controlId: string;
  /** id of the rendered error node, absent while the field is valid */
  errorId: string | undefined;
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
  if (!ctx.errorId) return { id: ctx.controlId };
  return { id: ctx.controlId, "aria-invalid": true, "aria-describedby": ctx.errorId };
}

export interface FieldProps {
  label: string;
  /** Right-aligned annotation beside the label, e.g. "optional". */
  hint?: string;
  /** Validation message; its presence also marks the control invalid. */
  error?: string;
  /** Control id. Generated when omitted — pass one only for controls that set
   *  their own id (a bare `<select>` / `<textarea>`, say). */
  id?: string;
  /** Label styling override — the auth screens use the micro caps treatment. */
  labelClassName?: string;
  children: React.ReactNode;
}

/**
 * Label + control + validation message. The message is tied to the control with
 * aria-invalid/aria-describedby and announced through role="alert", so a screen
 * reader user hears *why* a submit failed instead of only the field name.
 * Controls built on Input/Combobox pick all of that up from context — nothing
 * to wire per call site.
 */
export function Field({ label, hint, error, id, labelClassName, children }: FieldProps) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const errorId = error ? `${controlId}-error` : undefined;
  const ctx = React.useMemo<FieldContextValue>(
    () => ({ controlId, errorId }),
    [controlId, errorId],
  );

  return (
    <FieldContext.Provider value={ctx}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={controlId} className={cn(labelClassName)}>
            {label}
          </Label>
          {hint && (
            <span className="text-[10px] uppercase tracking-wider text-muted dark:text-muted-dark">
              {hint}
            </span>
          )}
        </div>
        {children}
        {error && (
          <p id={errorId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
