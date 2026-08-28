import { describe, it, expect } from "vitest";
import { sanitizeNumeric } from "@/components/ui/number-input";

/**
 * The Turkish decimal comma is the reason `NumberInput` is a text field rather
 * than `<input type="number">`. On a `tr` device the decimal key next to "0"
 * emits ",", which WebKit's number input cannot parse — it reports `value === ""`
 * and the digits appear to vanish. This is the guard on that behaviour, in both
 * directions: a comma must become a dot, and a decimal field must never end up
 * with two separators.
 */
describe("sanitizeNumeric", () => {
  it("accepts the Turkish decimal comma in a decimal field", () => {
    expect(sanitizeNumeric("52,4", true)).toBe("52.4");
    expect(sanitizeNumeric("0,05", true)).toBe("0.05");
  });

  it("keeps only the first separator", () => {
    expect(sanitizeNumeric("1.2.3", true)).toBe("1.23");
    expect(sanitizeNumeric("1,2,3", true)).toBe("1.23");
  });

  it("drops anything that is not part of a number", () => {
    expect(sanitizeNumeric("₺1 500", true)).toBe("1500");
    expect(sanitizeNumeric("12abc5", true)).toBe("125");
    expect(sanitizeNumeric("-8", true)).toBe("8");
  });

  it("refuses a separator entirely in an integer field", () => {
    // Odometers and service intervals are whole numbers; "12.500" typed as a
    // thousands separator must read 12500, not 12.5.
    expect(sanitizeNumeric("12.500", false)).toBe("12500");
    expect(sanitizeNumeric("12,500", false)).toBe("12500");
  });

  it("leaves a partially typed value alone", () => {
    // A trailing separator has to survive, or the field fights the user as they
    // type "3" "," "5".
    expect(sanitizeNumeric("3,", true)).toBe("3.");
    expect(sanitizeNumeric("", true)).toBe("");
  });
});
