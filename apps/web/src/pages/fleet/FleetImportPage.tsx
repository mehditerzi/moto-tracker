import { useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import type { FleetImportPreview, FleetImportRow } from "@mototracker/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HiddenFileInput } from "@/components/ui/file-input";
import { ApiError } from "@/lib/api";
import { friendlyError } from "@/lib/apiError";
import { pushToast } from "@/hooks/useToast";
import { useFleetContext } from "@/components/fleet/FleetLayout";
import { canManageFleet } from "@/hooks/useOrgs";
import { useCommitImport, usePreviewImport, type ImportInput } from "@/hooks/useFleetData";
import { SectionHeading } from "@/components/fleet/bits";
import { TableShell, Td, Th, Tr } from "@/components/fleet/table";
import { cn } from "@/lib/cn";

type Delimiter = NonNullable<ImportInput["delimiter"]>;

/**
 * `/fleet/import` (docs/fleet-design.md §7.7) — onboarding a fleet that already
 * lives in a spreadsheet. This removes the biggest objection in a sales call.
 *
 * PREVIEW, THEN COMMIT, AND NEVER HALF. The server re-parses and re-validates
 * the same text on commit and refuses the whole file if any row is bad, so this
 * screen's job is to make the fixes obvious before that happens: which column
 * was understood as what, which rows failed and why, and — because the API
 * returns its preview inside the error body too — a rejected commit still shows
 * the same annotated table rather than a bare toast.
 */
export function FleetImportPage() {
  const { t } = useTranslation();
  const { org } = useFleetContext();
  const manages = canManageFleet(org.role);

  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [delimiter, setDelimiter] = useState<Delimiter | "">("");
  const [preview, setPreview] = useState<FleetImportPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; datedItems: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doPreview = usePreviewImport(org.orgId);
  const doCommit = useCommitImport(org.orgId);

  if (!manages) return <Navigate to="/fleet" replace />;

  const reset = () => {
    setPreview(null);
    setProblem(null);
    setDone(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    // `File.text()` decodes as UTF-8 and the server strips a BOM, which covers
    // the "Save as CSV UTF-8" that Turkish Excel produces.
    setCsv(await file.text());
  };

  const runPreview = async () => {
    reset();
    if (!csv.trim()) {
      setProblem(t("fleet.import.noFile"));
      return;
    }
    try {
      setPreview(await doPreview.mutateAsync({ csv, ...(delimiter ? { delimiter } : {}) }));
    } catch (e) {
      handleFailure(e);
    }
  };

  const runCommit = async () => {
    setProblem(null);
    try {
      const res = await doCommit.mutateAsync({ csv, ...(delimiter ? { delimiter } : {}) });
      setDone({ created: res.created, datedItems: res.datedItemsCreated });
      setPreview(null);
      pushToast({ variant: "success", title: t("fleet.import.committed", { count: res.created }) });
    } catch (e) {
      handleFailure(e);
    }
  };

  /** Every import failure carries the annotated preview — show it, not a toast. */
  const handleFailure = (e: unknown) => {
    if (e instanceof ApiError) {
      const body = e.body as { error?: string; preview?: FleetImportPreview } | undefined;
      if (body?.preview) setPreview(body.preview);
      // `vehicle_limit_reached` is shared with the consumer paywall, whose copy
      // ends in "upgrade to add more". An organization's ceiling is not bought
      // in-app and there is no upgrade path to point a fleet manager at (§1), so
      // say what actually happened instead of reusing that string.
      if (body?.error === "vehicle_limit_reached" && body.preview) {
        setProblem(
          t("fleet.import.blockedLimit", {
            max: body.preview.maxVehicles,
            current: body.preview.currentVehicles,
            adding: body.preview.validRows,
          }),
        );
        return;
      }
      setProblem(friendlyError(e, t));
      return;
    }
    setProblem(friendlyError(e, t));
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("fleet.import.title")}>
        <SectionHeading title={t("fleet.import.title")} />
        <p className="mb-4 max-w-2xl text-pretty text-[14px] text-muted dark:text-muted-dark">
          {t("fleet.import.intro")}
        </p>

        <div className="flex flex-wrap items-end gap-x-3 gap-y-4 rounded-2xl border border-border bg-surface/70 p-4 dark:border-border-dark dark:bg-surface-dark/60">
          <HiddenFileInput
            ref={fileRef}
            accept=".csv,text/csv,text/plain"
            onPick={([f]) => void onFile(f)}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <FileSpreadsheet className="h-4 w-4" /> {t("fleet.import.chooseFile")}
          </Button>
          <span className="text-[13px] text-muted dark:text-muted-dark">
            {fileName || t("fleet.import.noFileChosen")}
          </span>
          <div className="w-44">
            <Field label={t("fleet.import.delimiter")}>
              <Select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as Delimiter | "")}
              >
                <option value="">{t("fleet.import.delimiterAuto")}</option>
                <option value=";">{t("fleet.import.delimiterSemicolon")}</option>
                <option value=",">{t("fleet.import.delimiterComma")}</option>
                <option value={"\t"}>{t("fleet.import.delimiterTab")}</option>
                <option value="|">{t("fleet.import.delimiterPipe")}</option>
              </Select>
            </Field>
          </div>
          <Button variant="accent" onClick={runPreview} disabled={!csv || doPreview.isPending}>
            <Upload className="h-4 w-4" /> {t("fleet.import.preview")}
          </Button>
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] text-muted underline-offset-2 hover:underline dark:text-muted-dark">
            {t("fleet.import.pasteInstead")}
          </summary>
          <Textarea
            mono
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setFileName("");
              reset();
            }}
            rows={6}
            aria-label={t("fleet.import.pasteInstead")}
            className="mt-2"
            placeholder={"plaka;marka;model;sigorta\n34 ABC 123;Honda;PCX 125;31.12.2026"}
          />
        </details>
      </section>

      {problem && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-[14px] text-danger">
          {problem}
        </p>
      )}

      {done && (
        <section className="flex items-center gap-4 rounded-2xl border border-success/30 bg-success/5 p-5">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-success" aria-hidden />
          <div>
            <h2 className="text-[16px] font-semibold">
              {t("fleet.import.doneTitle", { count: done.created })}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted dark:text-muted-dark">
              {t("fleet.import.doneSub", { count: done.datedItems })}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="ml-auto">
            <Link to="/fleet/vehicles">{t("fleet.import.openInventory")}</Link>
          </Button>
        </section>
      )}

      {preview && <PreviewPanel preview={preview} onCommit={runCommit} committing={doCommit.isPending} />}
    </div>
  );
}

function PreviewPanel({
  preview,
  onCommit,
  committing,
}: {
  preview: FleetImportPreview;
  onCommit: () => void;
  committing: boolean;
}) {
  const { t } = useTranslation();
  const blocked = preview.errorRows > 0 || preview.wouldExceedLimit || preview.totalRows === 0;

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t("fleet.import.columns")}>
        <SectionHeading title={t("fleet.import.columns")} />
        <ul className="flex flex-wrap gap-1.5">
          {preview.columns.map((c, i) => (
            <li
              key={`${c.raw}-${i}`}
              className={cn(
                "rounded-lg border px-2 py-1 text-[12px]",
                c.field
                  ? "border-success/40 bg-success/5"
                  : "border-border text-muted dark:border-border-dark dark:text-muted-dark",
              )}
            >
              <span className="font-mono">{c.raw || "—"}</span>
              <span className="mx-1 opacity-60">→</span>
              {c.field ? t(`fleet.import.fields.${c.field}`) : t("fleet.import.ignored")}
            </li>
          ))}
        </ul>
        {preview.missingFields.length > 0 && (
          <p className="mt-2 text-[12px] text-muted dark:text-muted-dark">
            {t("fleet.import.missing", {
              fields: preview.missingFields.map((f) => t(`fleet.import.fields.${f}`)).join(", "),
            })}
          </p>
        )}
      </section>

      <section
        aria-label={t("fleet.import.summary")}
        className={cn(
          "flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border p-4",
          blocked ? "border-warning/40 bg-warning/5" : "border-success/30 bg-success/5",
        )}
      >
        <span className="text-[13px]">
          <span className="num text-[20px] font-semibold">{preview.validRows}</span>{" "}
          {t("fleet.import.validRows")}
        </span>
        <span className="text-[13px]">
          <span
            className={cn(
              "num text-[20px] font-semibold",
              preview.errorRows > 0 && "text-danger",
            )}
          >
            {preview.errorRows}
          </span>{" "}
          {t("fleet.import.errorRows")}
        </span>
        <span className="text-[13px] text-muted dark:text-muted-dark">
          {t("fleet.import.capacity", {
            current: preview.currentVehicles,
            max: preview.maxVehicles,
          })}
        </span>
        <span className="text-[12px] text-muted dark:text-muted-dark">
          {t("fleet.import.detectedDelimiter", { delimiter: showDelimiter(preview.delimiter) })}
        </span>
        <Button
          variant="accent"
          className="ml-auto"
          onClick={onCommit}
          disabled={blocked || committing}
        >
          {t("fleet.import.commit", { count: preview.validRows })}
        </Button>
      </section>

      {blocked && (
        <p className="flex items-start gap-2 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {preview.wouldExceedLimit
              ? t("fleet.import.blockedLimit", {
                  max: preview.maxVehicles,
                  current: preview.currentVehicles,
                  adding: preview.validRows,
                })
              : preview.totalRows === 0
                ? t("fleet.import.blockedEmpty")
                : t("fleet.import.blockedErrors", { count: preview.errorRows })}
          </span>
        </p>
      )}

      <section aria-label={t("fleet.import.rows")}>
        <SectionHeading title={t("fleet.import.rows")} count={preview.totalRows} />
        <TableShell label={t("fleet.import.rows")}>
          <thead>
            <tr>
              <Th align="right">{t("fleet.import.line")}</Th>
              <Th>{t("fleet.import.fields.plate")}</Th>
              <Th>{t("fleet.import.fields.nickname")}</Th>
              <Th>{t("fleet.import.fields.make")}</Th>
              <Th>{t("fleet.import.fields.model")}</Th>
              <Th align="right">{t("fleet.import.fields.year")}</Th>
              <Th align="right">{t("fleet.import.fields.currentKm")}</Th>
              <Th>{t("fleet.import.dates")}</Th>
              <Th>{t("fleet.import.problems")}</Th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => (
              <Tr key={r.line} className={r.errors.length > 0 ? "bg-danger/[0.05]" : undefined}>
                <Td align="right" className="num text-muted dark:text-muted-dark">
                  {r.line}
                </Td>
                <Td className="num uppercase">{str(r.values.plate)}</Td>
                <Td>{str(r.values.nickname)}</Td>
                <Td>{str(r.values.make)}</Td>
                <Td>{str(r.values.model)}</Td>
                <Td align="right" className="num">
                  {str(r.values.year)}
                </Td>
                <Td align="right" className="num">
                  {str(r.values.currentKm)}
                </Td>
                <Td className="num text-[12px] text-muted dark:text-muted-dark">
                  {(["sigorta", "kasko", "muayene", "mtv"] as const)
                    .map((f) => (r.values[f] ? `${t(`items.${f}`)} ${r.values[f]}` : null))
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </Td>
                <Td>
                  <RowErrors row={r} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>

        <ul className="flex flex-col gap-1.5 lg:hidden">
          {preview.rows.map((r) => (
            <li
              key={r.line}
              className={cn(
                "rounded-xl border px-3 py-2 text-[13px]",
                r.errors.length > 0
                  ? "border-danger/40 bg-danger/5"
                  : "border-border dark:border-border-dark",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="num font-medium uppercase">{str(r.values.plate)}</span>
                <span className="num text-[11px] text-muted dark:text-muted-dark">
                  {t("fleet.import.line")} {r.line}
                </span>
              </div>
              <p className="truncate text-[12px] text-muted dark:text-muted-dark">
                {[r.values.nickname, r.values.make, r.values.model].filter(Boolean).join(" · ")}
              </p>
              <RowErrors row={r} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RowErrors({ row }: { row: FleetImportRow }) {
  const { t } = useTranslation();
  if (row.errors.length === 0) {
    return <span className="text-[12px] text-success">{t("fleet.import.rowOk")}</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {row.errors.map((e, i) => (
        <li key={`${e.field ?? "row"}-${e.code}-${i}`} className="text-[12px] text-danger">
          {e.field && (
            <span className="font-medium">{t(`fleet.import.fields.${e.field}`)}: </span>
          )}
          {t(`fleet.import.errors.${e.code}`, { defaultValue: e.code })}
        </li>
      ))}
    </ul>
  );
}

function str(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

function showDelimiter(d: string): string {
  if (d === "\t") return "TAB";
  return d;
}
