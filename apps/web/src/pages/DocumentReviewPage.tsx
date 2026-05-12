import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDocument } from "@/hooks/useDocuments";
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
            <div className="relative overflow-hidden rounded-2xl border border-border dark:border-border-dark">
              <img src={fileUrl} alt="" className="block h-64 w-full object-cover" />
              <motion.div
                initial={{ y: "-100%" }}
                animate={{ y: "100%" }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-accent/50 to-transparent"
              />
            </div>
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
              className={"inline-flex items-center gap-2 " + (applied ? "text-success" : "")}
            >
              {applied ? (
                <>
                  <CheckCircle2 className="h-5 w-5" /> {t("review.appliedTitle")}
                </>
              ) : (
                <>
                  <Pencil className="h-5 w-5" /> {t("review.pendingTitle")}
                </>
              )}
            </span>
          </CardTitle>
          <CardDescription>
            {applied ? t("review.appliedSub") : t("review.pendingSub")}
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
              <FieldRow label={t("review.sigortaExpires")} value={ex.dates.sigortaExpiresOn} />
              <FieldRow label={t("review.kaskoExpires")} value={ex.dates.kaskoExpiresOn} />
              <FieldRow label={t("review.muayeneExpires")} value={ex.dates.muayeneExpiresOn} />
              <FieldRow label={t("review.confidence")} value={`${Math.round(ex.confidence * 100)}%`} />
            </ul>
          )}

          <div className="flex gap-2">
            {applied && d.appliedDatedItemId ? (
              <Button asChild variant="accent" className="flex-1">
                <Link to={`/dated-items/${d.appliedDatedItemId}`}>{t("review.goToRecord")}</Link>
              </Button>
            ) : (
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
            )}
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
