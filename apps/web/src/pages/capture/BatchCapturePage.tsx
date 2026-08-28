import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Camera, Images, AlertTriangle, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HiddenFileInput } from "@/components/ui/file-input";
import { CameraCapture, type BurstShot } from "@/components/CameraCapture";
import { downscaleImageFile } from "@/lib/camera";
import { uploadDocument, useDeleteDocument } from "@/hooks/useDocuments";
import { pushToast } from "@/hooks/useToast";
import { track } from "@/lib/telemetry";

/** Long-edge cap for gallery picks — matches the in-camera MAX_OUTPUT_EDGE. */
const MAX_GALLERY_EDGE = 2400;

/**
 * How many uploads are allowed in flight at once.
 *
 * Two, not "all of them". Each upload is a multipart body the server holds in
 * memory and hands to sharp; twenty at once from one phone on hotel wifi is a
 * long stall during which nothing appears to work, and on the server it is the
 * one way bulk capture could genuinely hurt the process. Two keeps the tray
 * filling visibly while the user carries on shooting, which is the only thing
 * they can perceive anyway.
 */
const UPLOAD_CONCURRENCY = 2;

interface Shot {
  id: string;
  url: string;
  file: File;
  status: "queued" | "uploading" | "uploaded" | "failed";
  documentId?: string;
  /** Machine error code from the API, for a precise message. */
  error?: string;
}

/**
 * Rapid capture. Shoot a stack of documents without leaving the viewfinder;
 * every shot uploads in the background while the next is being framed, so by
 * the time the user stops shooting most of the pile is already being read.
 *
 * The screen deliberately does NOT wait for OCR. Reading is minutes of queued
 * work (see the API's bulk priority); the review pass is where waiting belongs,
 * and it can start on the documents that are already done.
 */
export function BatchCapturePage({ batchId }: { batchId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [shots, setShots] = useState<Shot[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [batchFull, setBatchFull] = useState(false);
  const galleryInput = useRef<HTMLInputElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const deleteDoc = useDeleteDocument();

  // Object URLs are revoked on unmount, not per-shot: a thumbnail stays on
  // screen for the whole session and revoking early blanks the tray.
  const urlsRef = useRef<string[]>([]);
  useEffect(
    () => () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const inFlight = useRef(0);
  const shotsRef = useRef<Shot[]>([]);
  shotsRef.current = shots;

  const patch = useCallback((id: string, next: Partial<Shot>) => {
    setShots((s) => s.map((x) => (x.id === id ? { ...x, ...next } : x)));
  }, []);

  /** Start as many queued uploads as the concurrency budget allows. */
  const pump = useCallback(() => {
    while (inFlight.current < UPLOAD_CONCURRENCY) {
      const next = shotsRef.current.find((s) => s.status === "queued");
      if (!next) return;
      inFlight.current += 1;
      // Mark synchronously so the same shot is not picked twice in this loop.
      next.status = "uploading";
      patch(next.id, { status: "uploading" });
      void uploadDocument({ file: next.file, batchId })
        .then((doc) => {
          patch(next.id, { status: "uploaded", documentId: doc.id });
        })
        .catch((e: Error) => {
          const code = e.message;
          if (code === "batch_full") setBatchFull(true);
          next.status = "failed";
          patch(next.id, { status: "failed", error: code });
          track("batch_upload_failed", { code });
        })
        .finally(() => {
          inFlight.current -= 1;
          pump();
        });
    }
  }, [batchId, patch]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const added: Shot[] = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: URL.createObjectURL(file),
        file,
        status: "queued",
      }));
      urlsRef.current.push(...added.map((s) => s.url));
      shotsRef.current = [...shotsRef.current, ...added];
      setShots(shotsRef.current);
      pump();
    },
    [pump],
  );

  /**
   * Drop a shot. A bad photo spotted in the tray costs nothing here; spotted in
   * the review pass it costs a confused minute. If it already reached the
   * server the document goes with it, so a discarded shot is never read.
   */
  const removeShot = useCallback(
    (id: string) => {
      const shot = shotsRef.current.find((s) => s.id === id);
      shotsRef.current = shotsRef.current.filter((s) => s.id !== id);
      setShots(shotsRef.current);
      setBatchFull(false);
      if (shot?.documentId) {
        deleteDoc.mutate({ documentId: shot.documentId, batchId });
      }
      track("batch_shot_removed", { uploaded: !!shot?.documentId });
    },
    [batchId, deleteDoc],
  );

  const retryShot = useCallback(
    (id: string) => {
      const shot = shotsRef.current.find((s) => s.id === id);
      if (!shot) return;
      shot.status = "queued";
      patch(id, { status: "queued", error: undefined });
      pump();
    },
    [patch, pump],
  );

  const uploaded = shots.filter((s) => s.status === "uploaded").length;
  const failed = shots.filter((s) => s.status === "failed");
  const pending = shots.filter((s) => s.status === "queued" || s.status === "uploading").length;

  const goToReview = () => {
    track("batch_capture_finished", { shots: shots.length, failed: failed.length });
    navigate(`/capture?batch=${encodeURIComponent(batchId)}&step=review`, { replace: true });
  };

  const openCamera = () => {
    if (typeof navigator.mediaDevices?.getUserMedia === "function") setCameraOpen(true);
    else cameraInput.current?.click();
  };

  /** The tray as the camera overlay wants it. */
  const burstShots: BurstShot[] = shots.map((s) => ({
    id: s.id,
    url: s.url,
    status: s.status === "uploaded" ? "uploaded" : s.status === "failed" ? "failed" : "uploading",
  }));

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-md">
      {cameraOpen && (
        <CameraCapture
          burst
          shots={burstShots}
          limitReached={batchFull}
          onCapture={(file) => addFiles([file])}
          onRemoveShot={removeShot}
          onDone={() => {
            setCameraOpen(false);
            goToReview();
          }}
          onClose={() => setCameraOpen(false)}
          onPickGallery={() => {
            setCameraOpen(false);
            galleryInput.current?.click();
          }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-[22px] tracking-tight">{t("batch.captureTitle")}</CardTitle>
          <CardDescription>{t("batch.captureSub")}</CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          {shots.length === 0 ? (
            <>
              <Button type="button" variant="accent" size="lg" onClick={openCamera}>
                <Camera className="h-4 w-4" /> {t("batch.startShooting")}
              </Button>
              <Button type="button" variant="outline" onClick={() => galleryInput.current?.click()}>
                <Images className="h-4 w-4" /> {t("batch.pickMany")}
              </Button>
            </>
          ) : (
            <>
              {/* Honest counts: what is on the phone, what reached us, what did
                  not. Never a bare spinner — a stalled upload is something the
                  user can retry, and they can only do that if they can see it. */}
              <p aria-live="polite" className="text-sm text-muted dark:text-muted-dark">
                {t("batch.uploadProgress", { uploaded, total: shots.length })}
                {pending > 0 ? ` · ${t("batch.uploadingCount", { count: pending })}` : ""}
              </p>

              <ul className="grid grid-cols-4 gap-2">
                {shots.map((s, i) => (
                  <li key={s.id} className="relative">
                    <img
                      src={s.url}
                      alt=""
                      className={`aspect-square w-full rounded-xl object-cover ring-1 ring-border dark:ring-border-dark ${
                        s.status === "failed" ? "opacity-50" : ""
                      }`}
                    />
                    {s.status !== "uploaded" && (
                      <span
                        aria-hidden
                        className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30"
                      >
                        {s.status === "failed" ? (
                          <AlertTriangle className="h-5 w-5 text-danger" />
                        ) : (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        )}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeShot(s.id)}
                      aria-label={t("batch.removeShot", { index: i + 1 })}
                      className="absolute -right-2 -top-2 inline-flex h-11 w-11 items-center justify-center"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface text-text ring-1 ring-border dark:bg-surface-dark dark:text-text-dark dark:ring-border-dark">
                        <X className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {failed.length > 0 && (
                <div className="flex flex-col gap-2 rounded-xl bg-danger/10 p-3">
                  <p className="text-[13px] text-danger">
                    {t("batch.uploadFailedCount", { count: failed.length })}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => failed.forEach((s) => retryShot(s.id))}
                  >
                    <RotateCw className="h-4 w-4" /> {t("batch.retryUploads")}
                  </Button>
                </div>
              )}

              {batchFull && (
                <p className="rounded-xl bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-300">
                  {t("batch.full")}
                </p>
              )}

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={openCamera} disabled={batchFull}>
                  <Camera className="h-4 w-4" /> {t("batch.shootMore")}
                </Button>
                <Button type="button" variant="outline" onClick={() => galleryInput.current?.click()} disabled={batchFull}>
                  <Images className="h-4 w-4" />
                  <span className="sr-only">{t("batch.pickMany")}</span>
                </Button>
              </div>
              <Button
                type="button"
                variant="accent"
                size="lg"
                onClick={goToReview}
                disabled={uploaded === 0}
              >
                {t("batch.goToReview", { count: uploaded })}
              </Button>
              {pending > 0 && (
                <p className="text-center text-xs text-muted dark:text-muted-dark">
                  {t("batch.reviewWhileUploading")}
                </p>
              )}
            </>
          )}

          <Button
            type="button"
            variant="ghost"
            className="text-muted dark:text-muted-dark"
            onClick={() => navigate("/capture", { replace: true })}
          >
            {t("common.cancel")}
          </Button>

          {/* Multi-select: a fleet manager often already has the photos. */}
          <HiddenFileInput
            ref={galleryInput}
            accept="image/*"
            multiple
            onPick={(picked) => {
              void Promise.all(
                picked.map((f) =>
                  downscaleImageFile(f, MAX_GALLERY_EDGE).catch(() => f),
                ),
              ).then((scaled) => {
                addFiles(scaled);
                pushToast({
                  variant: "default",
                  title: t("batch.addedFromGallery", { count: scaled.length }),
                });
              });
            }}
          />
          <HiddenFileInput
            ref={cameraInput}
            accept="image/*"
            capture="environment"
            onPick={(picked) => addFiles(picked)}
          />
        </CardContent>
      </Card>
    </motion.div>
  );
}
