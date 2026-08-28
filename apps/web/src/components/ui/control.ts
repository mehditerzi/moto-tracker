/**
 * The one place the form control scale is defined.
 *
 * Before this file every call site hand-rolled its own chrome, which is how the
 * app ended up with five different control heights (h-8, h-9, h-10, h-11, h-14)
 * and three different focus treatments. There are now exactly **two** sizes:
 *
 * - `md`  — the standard field. 44px tall on every viewport.
 * - `sm`  — the dense variant for the fleet toolbars (filters, range pickers),
 *           which are desk-first per `docs/fleet-design.md` §6. It is *still*
 *           44px on phones and only collapses to 36px from `sm:` up, so the
 *           44px touch-target rule holds on touch devices without giving a
 *           desktop table a phone-sized filter bar.
 *
 * Consequence worth stating plainly: **on a phone every form control in the app
 * is the same height.** A row of controls cannot be uneven any more.
 *
 * Font size is 16px (`text-base`) below `sm:` on every control, including
 * `<select>`: iOS zooms the page when a control smaller than 16px takes focus.
 * The 13/15px design sizes come back from `sm:` up where no zoom happens.
 */

export type ControlSize = "sm" | "md";

/** Shared chrome: surface, border, hover, focus ring, disabled, invalid. */
export const CONTROL_CHROME = [
  "w-full rounded-xl border border-border bg-surface text-text transition",
  "placeholder:text-muted dark:placeholder:text-muted-dark",
  "hover:border-border-strong dark:hover:border-border-strong-dark",
  "focus-visible:outline-none focus-visible:border-text/40 focus-visible:ring-2 focus-visible:ring-accent/40 dark:focus-visible:border-text-dark/40",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "dark:border-border-dark dark:bg-surface-elev-dark dark:text-text-dark",
  // Invalid is a border + ring change, never colour alone — the message the
  // <Field> renders underneath is what actually carries the meaning.
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/40",
].join(" ");

/** Height + horizontal padding + type size for each step of the scale. */
export const CONTROL_SIZE: Record<ControlSize, string> = {
  // Padding is deliberately NOT responsive. A `sm:px-*` here would sit inside a
  // media query and therefore win over the plain `pl-9` / `pr-9` that call sites
  // add to make room for a search icon or the select chevron — the glyph would
  // overlap the text from 640px up. Two pixels of horizontal padding are not
  // worth that class of bug.
  sm: "h-11 px-3 text-base sm:h-9 sm:text-[13px]",
  md: "h-11 px-3.5 text-base sm:text-[15px]",
};

/** Class string for a single-line control (input, select). */
export function controlClasses(size: ControlSize = "md"): string {
  return `flex leading-none ${CONTROL_SIZE[size]} ${CONTROL_CHROME}`;
}

/**
 * Content-shaped field widths.
 *
 * "Looks properly aligned" is mostly this: a 4-digit year should not be as wide
 * as a chassis number. Every value is a *max* width so a field never overflows a
 * narrow phone column, and `grow` is the one that eats the remaining space on a
 * row so the right edge stays flush.
 */
export const FIELD_WIDTH = {
  /** Fills its container. The default. */
  full: "w-full",
  /** Takes whatever is left on a FormRow; never narrower than ~10rem. */
  grow: "w-full min-w-[9rem] flex-1",
  /** 2–4 digits: year, month interval, cc. */
  tiny: "w-[6.75rem] shrink-0",
  /** 4–6 digits: litres, cylinder capacity. */
  short: "w-[8rem] shrink-0",
  /** up to 7 digits: odometer / km readings. */
  number: "w-[9.5rem] shrink-0",
  /** currency symbol + 7 digits. */
  money: "w-[10.5rem] shrink-0",
  /** A native date control renders "GG.AA.YYYY" plus a picker glyph. */
  date: "w-full min-w-[10.5rem] flex-1 sm:w-[11.5rem] sm:flex-none",
} as const;

export type FieldWidth = keyof typeof FIELD_WIDTH;
