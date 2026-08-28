import { describe, it, expect } from "vitest";
import { FIELD_WIDTH, type FieldWidth } from "@/components/ui/control";

/**
 * The fuel form shipped with two fields per row that could not both fit on a
 * phone. Nothing caught it, because the failure is arithmetic between three
 * files: the token widths here, `FormRow`'s gap, and the padding the field sits
 * inside. This is that arithmetic, written down.
 *
 * It cannot render — the suite runs in `node`, there is no layout engine — so
 * it checks the only thing that actually decided the bug: whether the floor
 * each token puts on a flex line still leaves the line able to hold its
 * neighbour inside a card on a 375px phone.
 */

const REM = 16;

/**
 * The width a token contributes to the *wrap* decision on a FormRow line.
 *
 * Flexbox wraps on the item's hypothetical main size clamped by its min-width,
 * so a flexing token (`flex-1`, basis 0) contributes its `min-w-[…]` and a
 * fixed token contributes its `w-[…]`. Variant-prefixed classes (`sm:w-…`) are
 * deliberately ignored: this is the phone budget.
 */
function floorPx(token: FieldWidth): number {
  const classes = FIELD_WIDTH[token].split(/\s+/).filter((c) => !c.includes(":"));
  const read = (prefix: string) => {
    const hit = classes.find((c) => c.startsWith(`${prefix}-[`));
    return hit ? parseFloat(hit.slice(prefix.length + 2)) * REM : undefined;
  };
  return read("min-w") ?? read("w") ?? 0;
}

/**
 * Inner width of a `Card` on a phone:
 *   viewport − 32 (AppShell `main` px-4 / pl-safe / pr-safe, 16 a side)
 *            − 2  (the card's 1px hairline)
 *            − 40 (the card's own `p-5`, 20 a side).
 * A `CardContent` must not add padding on top of that — doing so is what cost
 * this form 32px and pushed both of its rows over the line.
 */
const cardInner = (viewport: number) => viewport - 32 - 2 - 40;

/** `FormRow` is `gap-x-3`. */
const GAP = 12;

const fits = (viewport: number, ...tokens: FieldWidth[]) =>
  tokens.reduce((sum, tk) => sum + floorPx(tk), 0) + GAP * (tokens.length - 1) <=
  cardInner(viewport);

describe("FIELD_WIDTH row budget", () => {
  it("reads the phone floor out of each token", () => {
    expect(floorPx("tiny")).toBe(108);
    expect(floorPx("number")).toBe(152);
    // `date` and `moneyGrow` flex below `sm`, so their floor is the min-width,
    // not the `sm:` content width sitting in the same string.
    expect(floorPx("date")).toBe(168);
    expect(floorPx("moneyGrow")).toBe(128);
  });

  it("keeps both fuel-form rows two-up from 375px", () => {
    expect(fits(375, "date", "tiny")).toBe(true); // 288 <= 301
    expect(fits(375, "moneyGrow", "number")).toBe(true); // 292 <= 301
    expect(fits(393, "date", "tiny")).toBe(true);
    expect(fits(393, "moneyGrow", "number")).toBe(true);
  });

  it("wraps rather than overflows at 320px", () => {
    // 288 and 292 against 246 of card. Neither row fits, and that is fine —
    // `FormRow` wraps. What must never happen is a *single* field being wider
    // than the card, because a `shrink-0` token would then overflow it.
    expect(fits(320, "date", "tiny")).toBe(false);
    for (const token of Object.keys(FIELD_WIDTH) as FieldWidth[]) {
      expect(floorPx(token)).toBeLessThanOrEqual(cardInner(320));
    }
  });

  it("gives the odometer column room for its Turkish label", () => {
    // "Kilometre" + gap-2 + "İSTEĞE BAĞLI", measured against the shipped Geist
    // at the rendered sizes (text-sm label, 10px tracking-wider annotation).
    // `Field` puts both on one `justify-between` line; under this the hint
    // spills out of the column.
    const TR_ODOMETER_LABEL = 144;
    expect(floorPx("number")).toBeGreaterThanOrEqual(TR_ODOMETER_LABEL);
    // The width it used to have, kept here so the regression is legible.
    expect(floorPx("short")).toBeLessThan(TR_ODOMETER_LABEL);
  });

  it("gives the cost column room for its Turkish label", () => {
    // "Tutar" + gap-2 + "İSTEĞE BAĞLI" ≈ 117px.
    expect(floorPx("moneyGrow")).toBeGreaterThanOrEqual(117);
  });
});
