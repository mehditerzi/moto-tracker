import * as React from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "@/components/ui/field";
import { CONTROL_CHROME } from "@/components/ui/control";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow to fit the content instead of showing an inner scrollbar. */
  autoGrow?: boolean;
  /** Show a "used / limit" counter once the field is two-thirds full. */
  showCount?: boolean;
  /** Monospace + no autocorrect — for pasted CSV and other machine text. */
  mono?: boolean;
}

/**
 * Multi-line text with the same chrome as `Input`, so a notes box and the field
 * above it share one border, one radius and one focus ring.
 *
 * Defaults are the ones a free-text box almost always wants and which the two
 * hand-rolled textareas in the app both got wrong: sentence capitalisation,
 * spellcheck on, `enterKeyHint="enter"` (a newline, not "go"), and a comfortable
 * three-line starting height rather than the browser's two.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoGrow, showCount, mono, rows = 3, onChange, ...props }, ref) => {
    const field = useFieldControl();
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [used, setUsed] = React.useState(
      String(props.value ?? props.defaultValue ?? "").length,
    );

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      },
      [ref],
    );

    const resize = React.useCallback(() => {
      const el = innerRef.current;
      if (!el || !autoGrow) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, [autoGrow]);

    // Fires for programmatic fills too — react-hook-form's `reset()` when an
    // edit form loads its record, which is exactly when the box has content.
    React.useEffect(resize, [resize, props.value]);

    const limit = props.maxLength;
    const counterVisible = showCount && limit != null && used > limit * 0.66;

    return (
      <div className="flex w-full flex-col gap-1">
        <textarea
          ref={setRefs}
          rows={rows}
          autoCapitalize={mono ? "off" : "sentences"}
          autoCorrect={mono ? "off" : undefined}
          spellCheck={mono ? false : undefined}
          enterKeyHint="enter"
          className={cn(
            CONTROL_CHROME,
            "block min-h-[5.5rem] resize-y px-3.5 py-2.5 text-base leading-relaxed sm:text-[15px]",
            mono && "font-mono text-[13px] sm:text-[13px]",
            autoGrow && "resize-none overflow-hidden",
            className,
          )}
          {...field}
          {...props}
          onChange={(e) => {
            setUsed(e.target.value.length);
            resize();
            onChange?.(e);
          }}
        />
        {counterVisible && (
          <span
            aria-hidden
            className={cn(
              "num self-end text-[11px] tabular-nums",
              used >= limit! ? "text-danger" : "text-muted dark:text-muted-dark",
            )}
          >
            {used}/{limit}
          </span>
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
