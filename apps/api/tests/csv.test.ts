import { describe, it, expect } from "vitest";
import {
  normHeader,
  parseCsv,
  parseDecimal,
  parseIntish,
  parseTurkishDate,
  sniffDelimiter,
  stripBom,
} from "../src/lib/csv.js";

/**
 * The parser is first-party because the two things that break a Turkish fleet
 * import — a `;` delimiter and a UTF-8 BOM — are exactly the two things a
 * dependency would not have fixed. So they are the first things tested.
 */

describe("delimiter sniffing", () => {
  it("prefers the delimiter that actually separates the header", () => {
    expect(sniffDelimiter("plaka;marka;model\n34ABC123;Ford;Transit")).toBe(";");
    expect(sniffDelimiter("plaka,marka,model\n34ABC123,Ford,Transit")).toBe(",");
    expect(sniffDelimiter("plaka\tmarka\tmodel")).toBe("\t");
  });

  it("is not fooled by a comma inside a quoted header cell", () => {
    expect(sniffDelimiter('"Marka, Model";Plaka;Yıl')).toBe(";");
  });

  it("does not look past the first line", () => {
    expect(sniffDelimiter("plaka;marka\n34ABC123;Ford,Transit,Extra,More,Even,More")).toBe(";");
  });
});

describe("parseCsv", () => {
  it("strips a UTF-8 BOM so the first header still maps", () => {
    const table = parseCsv("﻿plaka;marka\n34ABC123;Ford");
    expect(table.header).toEqual(["plaka", "marka"]);
    expect(stripBom("﻿x")).toBe("x");
  });

  it("handles CRLF, bare CR and trailing blank lines", () => {
    const table = parseCsv("plaka;marka\r\n34ABC123;Ford\r\n\r\n");
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.cells).toEqual(["34ABC123", "Ford"]);
    expect(parseCsv("a;b\r1;2\r").rows).toHaveLength(1);
  });

  it("honours RFC 4180 quoting, including embedded delimiters and newlines", () => {
    const table = parseCsv('plaka;not\n34ABC123;"iki satır\niçerir; ve ayraç"');
    expect(table.rows[0]!.cells[1]).toBe("iki satır\niçerir; ve ayraç");
  });

  it("unescapes a doubled quote", () => {
    const table = parseCsv('a;b\n1;"o ""iyi"" araç"');
    expect(table.rows[0]!.cells[1]).toBe('o "iyi" araç');
  });

  it("pads short rows and reports the file line each record started on", () => {
    const table = parseCsv("plaka;marka;model\n34ABC123;Ford\n\n06XYZ99;Fiat;Doblo");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.line).toBe(2);
    expect(table.rows[1]!.line).toBe(4);
    // A short row keeps its cells; the reader indexes by column, so a missing
    // trailing cell simply reads as empty.
    expect(table.rows[0]!.cells).toEqual(["34ABC123", "Ford"]);
  });

  it("survives a file with only a header", () => {
    const table = parseCsv("plaka;marka");
    expect(table.header).toEqual(["plaka", "marka"]);
    expect(table.rows).toEqual([]);
  });
});

describe("normHeader", () => {
  it("folds Turkish letters, case, spacing and punctuation into one key", () => {
    for (const s of ["Şasi No", "şasi  no", "SASI_NO", "şasi-no"]) {
      expect(normHeader(s)).toBe("SASINO");
    }
    expect(normHeader("Model Yılı")).toBe("MODELYILI");
    expect(normHeader(null)).toBe("");
  });
});

describe("parseTurkishDate", () => {
  it("reads the conventions a Turkish spreadsheet produces", () => {
    expect(parseTurkishDate("03.04.2027")).toBe("2027-04-03");
    expect(parseTurkishDate("3/4/2027")).toBe("2027-04-03");
    expect(parseTurkishDate("03-04-2027")).toBe("2027-04-03");
    expect(parseTurkishDate("2027-04-03")).toBe("2027-04-03");
    expect(parseTurkishDate(" 03.04.2027 ")).toBe("2027-04-03");
  });

  it("is day-first, which is the whole point", () => {
    // 04 March would be the American reading; a Turkish sheet means 3 April.
    expect(parseTurkishDate("03.04.2027")).not.toBe("2027-03-04");
  });

  it("rejects impossible and unparseable dates", () => {
    for (const bad of ["31.02.2027", "00.01.2027", "13.13.2027", "yakında", "2027", "", null]) {
      expect(parseTurkishDate(bad), String(bad)).toBeNull();
    }
  });
});

describe("number coercion", () => {
  it("reads integers however they were grouped", () => {
    expect(parseIntish("125000")).toBe(125000);
    expect(parseIntish("125.000")).toBe(125000);
    expect(parseIntish("125 000")).toBe(125000);
    expect(parseIntish("125,000")).toBe(125000);
    expect(parseIntish("abc")).toBeNull();
    expect(parseIntish("")).toBeNull();
  });

  it("reads decimals in both conventions", () => {
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("1,234.56")).toBe(1234.56);
    expect(parseDecimal("1234,5")).toBe(1234.5);
    expect(parseDecimal("1.234")).toBe(1234); // grouping, not 1.234
    expect(parseDecimal("1.23")).toBe(1.23);
    expect(parseDecimal("₺ 950")).toBe(950);
    expect(parseDecimal("bedava")).toBeNull();
  });
});
