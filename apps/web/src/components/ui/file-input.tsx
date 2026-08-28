import * as React from "react";

export interface HiddenFileInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "size"> {
  /** Called with the picked files. Never called with an empty list. */
  onPick: (files: File[]) => void;
}

/**
 * The offscreen `<input type="file">` behind a styled button.
 *
 * It is a primitive for one reason that has nothing to do with looks: it clears
 * `value` after every pick. A file input fires `change` only when the selection
 * *changes*, so choosing the same photo twice in a row — which is exactly what
 * you do after "couldn't read this, try again" — fired nothing at all and the
 * button appeared dead. Three of the five file inputs in the app got this
 * wrong; centralising it means none can.
 *
 * `sr-only` (clipped but rendered) rather than `hidden` (display:none), because
 * a programmatic `.click()` on a display:none file input has historically been
 * ignored in WKWebView, which is what the Capacitor wrap runs in. It is not a
 * tab stop — the visible, labelled button beside it is.
 */
export const HiddenFileInput = React.forwardRef<HTMLInputElement, HiddenFileInputProps>(
  ({ onPick, ...props }, ref) => (
    <input
      ref={ref}
      type="file"
      className="sr-only"
      tabIndex={-1}
      {...props}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length > 0) onPick(files);
      }}
    />
  ),
);
HiddenFileInput.displayName = "HiddenFileInput";
