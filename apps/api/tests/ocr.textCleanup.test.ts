import { describe, it, expect } from "vitest";
import { cleanupExtractedText } from "../src/ocr/ollamaClient.js";

const RECEIPT = "OPET PETROL\n\nTARIH: 02.07.2026\nLITRE : 12,45\nTUTAR : 1.037,93";

describe("cleanupExtractedText", () => {
  it("returns clean text untouched", () => {
    expect(cleanupExtractedText(RECEIPT)).toBe(RECEIPT);
  });

  it("truncates a looped transcription to one copy", () => {
    expect(cleanupExtractedText(`${RECEIPT}\n${RECEIPT}\n${RECEIPT}`)).toBe(RECEIPT);
  });

  it("strips markdown fences before deduping", () => {
    expect(cleanupExtractedText(`${RECEIPT}\n\`\`\`markdown\n${RECEIPT}\n\`\`\`\n\`\`\`\n\`\`\``)).toBe(RECEIPT);
  });

  it("leaves short outputs alone", () => {
    expect(cleanupExtractedText("34 ABC 123")).toBe("34 ABC 123");
  });
});
