/**
 * A CSV reader for the files Turkish fleet operators actually have.
 *
 * There is no dependency here on purpose. The parsers on npm are excellent at
 * RFC 4180 and useless at the two things that decide whether an import succeeds
 * in Istanbul: a `;` delimiter (Turkish Excel writes it, because the locale's
 * decimal separator is a comma) and a UTF-8 BOM (which turns the first header
 * cell into `﻿Plaka` and silently unmaps the plate column). Both are
 * handled below in about thirty lines; adding a package would not have removed
 * either problem, only hidden where it is solved.
 *
 * What is supported, because real exports contain all of it:
 *   * `,` `;` tab and `|` delimiters, sniffed from the header line
 *   * a leading UTF-8 BOM
 *   * CRLF, LF and bare-CR line endings
 *   * RFC 4180 quoting: `"…"`, `""` as an escaped quote, delimiters and
 *     newlines inside quotes
 *   * ragged rows (short rows are padded, long rows keep their extra cells)
 */

/** One parsed record, with the file line it started on for error reporting. */
export interface CsvRow {
  cells: string[];
  /** 1-based line number in the original text — what the user sees in Excel. */
  line: number;
}

export interface CsvTable {
  delimiter: string;
  header: string[];
  /** Line the header was on; data rows follow. */
  headerLine: number;
  rows: CsvRow[];
}

const CANDIDATE_DELIMITERS = [";", ",", "\t", "|"] as const;
export type CsvDelimiter = (typeof CANDIDATE_DELIMITERS)[number];

/**
 * Pick the delimiter by counting candidates OUTSIDE quotes on the header line.
 * Counting inside quotes is how sniffers get fooled by a header like
 * `"Marka, Model";Plaka` — there the comma is data and the semicolon is
 * structure. `;` wins ties because a Turkish export is the likelier source and
 * a comma-in-a-cell is far more common than a semicolon-in-a-cell.
 */
export function sniffDelimiter(text: string): CsvDelimiter {
  const line = firstLogicalLine(text);
  let best: CsvDelimiter = ";";
  let bestCount = -1;
  for (const d of CANDIDATE_DELIMITERS) {
    const n = countOutsideQuotes(line, d);
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  // A single-column file has no delimiter at all; `;` is as good as any.
  return bestCount <= 0 ? ";" : best;
}

/** The header line, respecting quotes so a quoted newline doesn't cut it short. */
function firstLogicalLine(text: string): string {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a close.
      if (inQuotes && text[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) return text.slice(0, i);
  }
  return text;
}

function countOutsideQuotes(line: string, needle: string): number {
  let inQuotes = false;
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === needle) n++;
  }
  return n;
}

/** Strip a UTF-8 BOM. Left in place it becomes part of the first header cell. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse the whole text into records. Blank lines are skipped (Excel loves
 * trailing ones); a record whose cells are all empty is dropped for the same
 * reason. Everything is returned as a trimmed string — typing is the caller's
 * job, because "12.500" means different things in a km column and a price one.
 */
export function parseCsv(input: string, forced?: CsvDelimiter): CsvTable {
  const text = stripBom(input);
  const delimiter = forced ?? sniffDelimiter(text);

  const records: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let sawContent = false;

  const endField = () => {
    cells.push(field.trim());
    field = "";
  };
  const endRecord = () => {
    endField();
    if (sawContent && cells.some((c) => c !== "")) records.push({ cells, line: recordLine });
    cells = [];
    sawContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawContent = true;
      continue;
    }
    if (ch === delimiter) {
      endField();
      sawContent = true;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      // CRLF is one line break, not two.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
      continue;
    }
    if (ch.trim() !== "") sawContent = true;
    field += ch;
  }
  endRecord();

  const first = records.shift();
  return {
    delimiter,
    header: first?.cells ?? [],
    headerLine: first?.line ?? 1,
    rows: records,
  };
}

// ─── value coercion for Turkish spreadsheets ──────────────────────────────────

/**
 * Normalise a header cell for matching: fold Turkish letters onto ASCII,
 * uppercase, and drop everything that is not a letter or digit — so `Şasi No`,
 * `SASI_NO` and `şasi  no` are one key. Deliberately the same shape as
 * `ocr/catalog.ts`'s `norm()`, which solves the identical problem for makes.
 */
export function normHeader(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/İ/g, "I")
    .replace(/ı/g, "I")
    .replace(/Ş/g, "S")
    .replace(/ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "C")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * A date as a Turkish spreadsheet writes it. `dd.mm.yyyy` is the Turkish
 * convention and by far the commonest; `dd/mm/yyyy` and `dd-mm-yyyy` show up
 * from other tools, and `yyyy-mm-dd` from anything that has met a database.
 *
 * Ambiguity is resolved day-first EXCEPT when the first component is 4 digits,
 * because a Turkish operator writing 03.04.2027 means 3 April, not 4 March.
 * Returns an ISO `yyyy-mm-dd` string, or null when it is not a date we trust.
 */
export function parseTurkishDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  const iso = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
  let y: number, m: number, d: number;
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject 31.02 and friends: build the date and check it did not roll over.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * A whole number as a spreadsheet writes it: `125000`, `125.000`, `125 000`,
 * `125,000`. Grouping separators are dropped whichever way round they are used,
 * which is safe here because every integer column we import (km, year) is a
 * count with no fractional part.
 */
export function parseIntish(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const cleaned = s.replace(/[.\s,'’]/g, "");
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * A money/decimal value in either convention: `1.234,56` (Turkish) or
 * `1,234.56` (English). The separator that appears LAST is the decimal point;
 * when only one kind appears and it is followed by exactly three digits it is
 * read as grouping (`1.234` is one thousand two hundred, not 1.234).
 */
export function parseDecimal(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim().replace(/[\s'’₺]/g, "");
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    normalized = s.slice(0, decimalAt).replace(/[.,]/g, "") + "." + s.slice(decimalAt + 1);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const at = Math.max(lastComma, lastDot);
    const tail = s.slice(at + 1);
    normalized =
      tail.length === 3 && !/[.,]/.test(tail)
        ? s.replace(/[.,]/g, "") // grouping: 1.234 → 1234
        : s.slice(0, at).replace(/[.,]/g, "") + "." + tail;
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
