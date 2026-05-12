import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Pencil, X, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDocument } from "@/hooks/useDocuments";
import { useUpdateBike } from "@/hooks/useBikes";
import { pushToast } from "@/hooks/useToast";
import { ScanFrame } from "@/pages/DocumentCapturePage";
import { env } from "@/env";

export function DocumentReviewPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const doc = useDocument(id, { pollWhilePending: true });

  if (!id) return null;

  if (doc.isLoading || !doc.data) {
    return <p className="text-center text-muted dark:text-muted-dark">{t("common.loading")}</p>;
  }

  const d = doc.data;
  const fileUrl = `${env.VITE_API_URL}/api/documents/${d.id}/file`;

  if (d.ocrStatus === "pending") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{t("review.reading")}</CardTitle>
            <CardDescription>{t("review.readingSub")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ScanFrame src={fileUrl} active />
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  if (d.ocrStatus === "failed") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2 text-danger">
                <AlertTriangle className="h-5 w-5" /> {t("review.failedTitle")}
              </span>
            </CardTitle>
            <CardDescription>{t("review.failedSub")}</CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <p className="text-sm text-muted dark:text-muted-dark">
              {d.ocrError ?? t("common.error")}
            </p>
            <div className="flex gap-2">
              <Button asChild variant="accent" className="flex-1">
                <Link to="/capture">{t("review.retry")}</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link to="/dashboard">{t("review.manualEntry")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  const ex = d.ocrExtracted;
  const applied = !!d.appliedDatedItemId;
  const isRuhsat = ex?.docType === "ruhsat";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col gap-3"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <span
              className={
                "inline-flex items-center gap-2 " +
                (applied ? "text-success" : isRuhsat ? "text-text dark:text-text-dark" : "")
              }
            >
              {applied ? (
                <>
                  <CheckCircle2 className="h-5 w-5" /> {t("review.appliedTitle")}
                </>
              ) : isRuhsat ? (
                <>
                  <FileText className="h-5 w-5" /> {t("review.ruhsatTitle")}
                </>
              ) : (
                <>
                  <Pencil className="h-5 w-5" /> {t("review.pendingTitle")}
                </>
              )}
            </span>
          </CardTitle>
          <CardDescription>
            {applied
              ? t("review.appliedSub")
              : isRuhsat
                ? t("review.ruhsatSub")
                : t("review.pendingSub")}
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          <div className="overflow-hidden rounded-2xl border border-border dark:border-border-dark">
            <img src={fileUrl} alt="" className="block h-56 w-full object-cover" />
          </div>

          {ex && (
            <ul className="grid gap-2">
              <FieldRow label={t("review.docType")} value={ex.docType} />
              <FieldRow label={t("review.plate")} value={ex.plate} />
              {/* Ruhsat-specific fields */}
              {(isRuhsat || ex.make) && <FieldRow label={t("review.make")} value={ex.make ?? null} />}
              {(isRuhsat || ex.model) && <FieldRow label={t("review.model")} value={ex.model ?? null} />}
              {(isRuhsat || ex.year) && (
                <FieldRow
                  label={t("review.year")}
                  value={ex.year != null ? String(ex.year) : null}
                />
              )}
              {/* Date-bearing docs */}
              {!isRuhsat && (
                <>
                  <FieldRow
                    label={t("review.sigortaExpires")}
                    value={ex.dates.sigortaExpiresOn}
                  />
                  <FieldRow
                    label={t("review.kaskoExpires")}
                    value={ex.dates.kaskoExpiresOn}
                  />
                  <FieldRow
                    label={t("review.muayeneExpires")}
                    value={ex.dates.muayeneExpiresOn}
                  />
                </>
              )}
              <FieldRow
                label={t("review.confidence")}
                value={`${Math.round(ex.confidence * 100)}%`}
              />
            </ul>
          )}

          {isRuhsat && d.bikeId && ex && (
            <ApplyRuhsatToBike
              bikeId={d.bikeId}
              extracted={{
                plate: ex.plate ?? undefined,
                make: ex.make ?? undefined,
                model: ex.model ?? undefined,
                year: ex.year ?? undefined,
              }}
            />
          )}

          <div className="flex gap-2">
            {applied && d.appliedDatedItemId ? (
              <Button asChild variant="accent" className="flex-1">
                <Link to={`/dated-items/${d.appliedDatedItemId}`}>{t("review.goToRecord")}</Link>
              </Button>
            ) : !isRuhsat ? (
              <Button asChild variant="accent" className="flex-1">
                <Link
                  to={
                    d.bikeId
                      ? `/bikes/${d.bikeId}/dated-items/new?type=${
                          ex?.docType && ex.docType !== "ruhsat" && ex.docType !== "unknown"
                            ? ex.docType
                            : "sigorta"
                        }`
                      : "/dashboard"
                  }
                >
                  {t("items.manualAdd")}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="ghost" className="flex-1">
              <Link to="/dashboard">
                <X className="h-4 w-4" /> {t("review.close")}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface RuhsatPayload {
  plate?: string;
  make?: string;
  model?: string;
  year?: number;
}

function ApplyRuhsatToBike({
  bikeId,
  extracted,
}: {
  bikeId: string;
  extracted: RuhsatPayload;
}) {
  const { t } = useTranslation();
  const update = useUpdateBike(bikeId);
  const [applied, setApplied] = useState(false);

  const hasAnything =
    !!extracted.plate || !!extracted.make || !!extracted.model || extracted.year != null;
  if (!hasAnything) return null;

  const onApply = async () => {
    try {
      await update.mutateAsync({
        ...(extracted.plate ? { plate: extracted.plate } : {}),
        ...(extracted.make ? { make: extracted.make } : {}),
        ...(extracted.model ? { model: extracted.model } : {}),
        ...(extracted.year != null ? { year: extracted.year } : {}),
      });
      setApplied(true);
      pushToast({ variant: "success", title: t("review.appliedToBike") });
    } catch (e) {
      pushToast({
        variant: "danger",
        title: t("items.saveFailed"),
        description: String(e),
      });
    }
  };

  return (
    <Button
      onClick={onApply}
      variant={applied ? "outline" : "accent"}
      disabled={update.isPending || applied}
    >
      {applied ? (
        <>
          <CheckCircle2 className="h-4 w-4" /> {t("review.appliedToBike")}
        </>
      ) : (
        t("review.applyToBike")
      )}
    </Button>
  );
}

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm dark:border-border-dark">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted dark:text-muted-dark">
        {label}
      </span>
      <span className="font-mono">{value ?? <em className="opacity-60">—</em>}</span>
    </li>
  );
}
