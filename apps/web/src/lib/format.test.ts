import { describe, it, expect } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("formats ISO as dd.MM.yyyy for Turkish", () => {
    expect(formatDate("2025-12-01", "tr")).toBe("01.12.2025");
  });
  it("formats for English without throwing", () => {
    expect(typeof formatDate("2025-12-01", "en")).toBe("string");
    expect(formatDate("2025-12-01", "en")).not.toBe("");
  });
  it("returns the raw input for an unparseable date", () => {
    expect(formatDate("not-a-date", "tr")).toBe("not-a-date");
  });
});
