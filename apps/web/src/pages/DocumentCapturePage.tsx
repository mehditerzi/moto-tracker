import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Image as ImageIcon, Layers, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HiddenFileInput } from "@/components/ui/file-input";
import { useCreateBatch, useOpenBatches, useUploadDocument } from "@/hooks/useDocuments";
import { useBike } from "@/hooks/useBikes";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { track } from "@/lib/telemetry";
import { CameraCapture } from "@/components/CameraCapture";
import { downscaleImageFile } from "@/lib/camera";

// Bulk capture is its own pair of screens and its own chunk: a user who only
// ever scans one insurance policy at a time should not download the batch
// review pass to do it. Routing happens here rather than in routes.tsx so the
// whole feature lives behind the one `/capture` entry the app already knows.
const BatchCapturePage = lazy(() =>
  import("@/pages/capture/BatchCapturePage").then((m) => ({ default: m.BatchCapturePage })),
);
const BatchReviewPage = lazy(() =>
  import("@/pages/capture/BatchReviewPage").then((m) => ({ default: m.BatchReviewPage })),
);

function CapturePending() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3" aria-hidden>
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-11 rounded-xl" />
    </div>
  );
}

/**
 * `/capture` is three screens behind one URL:
 *
 *   /capture                        — the single-document flow (unchanged).
 *   /capture?batch=<id>             — rapid capture into that batch.
 *   /capture?batch=<id>&step=review — the batch review pass.
 *
 * The batch id in the URL is what makes a half-finished pile resumable: the
 * worker keeps reading after the app is closed, and coming back to the link
 * lands exactly where the user was.
 */
export function DocumentCapturePage() {
  const [params] = useSearchParams();
  const batchId = params.get("batch");
  const step = params.get("step");

  if (batchId && step === "review") {
    return (
      <Suspense fallback={<CapturePending />}>
        <BatchReviewPage batchId={batchId} />
      </Suspense>
    );
  }
  if (batchId) {
    return (
      <Suspense fallback={<CapturePending />}>
        <BatchCapturePage batchId={batchId} />
      </Suspense>
    );
  }
  return <SingleCapture />;
}

function SingleCapture() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const bikeId = params.get("bikeId") ?? undefined;
  // Naming the target vehicle up front removes the "will this create a new car?"
  // ambiguity — the scan merges into this bike.
  const bike = useBike(bikeId);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const galleryInput = useRef<HTMLInputElement | null>(null);
  const upload = useUploadDocument();
  const createBatch = useCreateBatch();
  // Only asked for on the "add a vehicle" entry — a scan aimed at a vehicle has
  // nothing to resume.
  const openBatches = useOpenBatches(!bikeId);

  function openCamera() {
    // Live viewfinder with the document guide when supported; otherwise fall
    // back to the OS camera via the file input.
    if (typeof navigator.mediaDevices?.getUserMedia === "function") setCameraOpen(true);
    else cameraInput.current?.click();
  }

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  /** Long-edge cap applied to gallery picks (matches the in-camera MAX_OUTPUT_EDGE). */
  const MAX_GALLERY_EDGE = 2400;

  /** Back to the two big buttons. Clearing both file inputs matters: without it
   *  re-picking the SAME photo fires no `change` event, so the obvious retry
   *  (tap gallery, choose the same shot) silently does nothing. */
  function resetPicker() {
    setPreview(null);
    setBusy(false);
    if (galleryInput.current) galleryInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  async function handleFile(file: File) {
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    const startedAt = Date.now();
    try {
      const doc = await upload.mutateAsync({ file, bikeId });
      track("scan_uploaded", { ms: Date.now() - startedAt, hasBike: !!bikeId });
      navigate(`/documents/${doc.id}/review`, { replace: true });
    } catch (e) {
      // An aborted upload is not an error — reset silently to the picker.
      if ((e as Error).name === "AbortError") {
        resetPicker();
        return;
      }
      // Map raw API error codes to friendly messages instead of leaking
      // "service_unavailable" / "bike_not_found" into the toast.
      const code = (e as Error).message;
      track("scan_upload_failed", { code });
      const KNOWN: Record<string, string> = {
        service_unavailable: t("capture.errorLimit"),
        file_required: t("capture.errorFileRequired"),
        bike_not_found: t("capture.errorBikeNotFound"),
        // The multer fileFilter rejects these before the file is written: a
        // PDF/other non-image pick (415) and anything over the 10 MB cap (413).
        unsupported_media_type: t("capture.errorUnsupportedType"),
        file_too_large: t("capture.errorTooLarge"),
      };
      pushToast({
        variant: "danger",
        title: t("capture.uploadFailed"),
        description: KNOWN[code] ?? t("capture.errorGeneric"),
      });
      // Only `busy` used to be cleared here. `preview` stayed set, so the screen
      // kept rendering the "uploading…" panel — now with its Cancel button gone,
      // because that is `{busy && …}`. The toast vanished after four seconds and
      // left a dead screen with no camera, no gallery and no way back.
      resetPicker();
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      {cameraOpen && (
        <CameraCapture
          onCapture={(file) => {
            setCameraOpen(false);
            void handleFile(file);
          }}
          onClose={() => setCameraOpen(false)}
          onPickGallery={() => {
            setCameraOpen(false);
            galleryInput.current?.click();
          }}
        />
      )}

      {/* Resume. The worker keeps reading whether or not the app is open, so a
          pile left half-reviewed is not lost — but it is invisible unless we
          say so here, which is the difference between "resumable" and
          "resumable if you remember the link". */}
      {!preview &&
        (openBatches.data ?? []).map((b) => (
          <Card key={b.id} className="mb-3 border-accent/50">
            <CardHeader>
              <CardTitle className="text-base">{t("batch.resumeTitle")}</CardTitle>
              <CardDescription>
                {t("batch.resumeSub", {
                  total: b.progress.total,
                  done: b.progress.total - b.progress.pending,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="accent"
                className="min-h-[44px]"
                onClick={() => navigate(`/capture?batch=${b.id}&step=review`)}
              >
                {t("batch.resume")} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-[22px] tracking-tight">
            {bikeId ? t("capture.title") : t("capture.newVehicleTitle")}
          </CardTitle>
          <CardDescription>
            {bikeId
              ? bike.data
                ? t("capture.forVehicle", { name: bike.data.nickname })
                : t("capture.subtitle")
              : t("capture.newVehicleSub")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait">
            {!preview ? (
              <motion.div
                key="picker"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col gap-2"
              >
                <Button
                  type="button"
                  variant="accent"
                  size="lg"
                  onClick={openCamera}
                >
                  <Camera className="h-4 w-4" /> {t("capture.camera")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => galleryInput.current?.click()}
                >
                  <ImageIcon className="h-4 w-4" /> {t("capture.gallery")}
                </Button>
                {/* Bulk is offered only when the scan is not already aimed at a
                    vehicle: "several documents for this one van" is the single
                    flow repeated, not a batch — a batch is where vehicles come
                    from. */}
                {!bikeId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      track("batch_started", {});
                      createBatch.mutate(
                        {},
                        {
                          onSuccess: (b) => navigate(`/capture?batch=${b.id}`, { replace: true }),
                          onError: (e) =>
                            pushToast({
                              variant: "danger",
                              title: t("batch.startFailed"),
                              description: friendlyError(e, t),
                            }),
                        },
                      );
                    }}
                    disabled={createBatch.isPending}
                  >
                    <Layers className="h-4 w-4" /> {t("batch.startBulk")}
                  </Button>
                )}
                {bikeId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted dark:text-muted-dark"
                    onClick={() => navigate("/dashboard")}
                  >
                    {t("capture.skip")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted dark:text-muted-dark"
                    onClick={() => navigate("/bikes/new")}
                  >
                    {t("capture.enterManually")}
                  </Button>
                )}
                <HiddenFileInput
                  ref={cameraInput}
                  accept="image/*"
                  capture="environment"
                  onPick={([f]) => void handleFile(f!)}
                />
                <HiddenFileInput
                  ref={galleryInput}
                  accept="image/*"
                  onPick={([f]) => {
                    // Downscale gallery picks to the same 2400px edge cap used by
                    // the in-app camera, so large HEIC/JPEG files don't upload raw.
                    downscaleImageFile(f!, MAX_GALLERY_EDGE)
                      .then((scaled) => void handleFile(scaled))
                      .catch(() => void handleFile(f!));
                  }}
                />
              </motion.div>
            ) : (
              <motion.div
                key="uploading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-3"
              >
                <ScanFrame src={preview} active={busy} />
                <p className="text-center text-sm text-muted dark:text-muted-dark">
                  {t("capture.uploading")}
                </p>
                {busy && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => upload.abort()}
                  >
                    {t("common.cancel")}
                  </Button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/**
 * Shared frame for the captured/loading document. A horizontal lime scanline
 * sweeps across the image while OCR is in flight, with thin guideline brackets
 * at the corners — sells the "we're reading this document" beat without being
 * gimmicky.
 */
export function ScanFrame({ src, active }: { src: string; active: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-bg/40 dark:border-border-dark dark:bg-bg-dark/40">
      <img src={src} alt="" className="block h-64 w-full object-cover" />
      {/* Corner brackets */}
      <span aria-hidden className="pointer-events-none absolute left-3 top-3 h-3 w-3 border-l-2 border-t-2 border-accent" />
      <span aria-hidden className="pointer-events-none absolute right-3 top-3 h-3 w-3 border-r-2 border-t-2 border-accent" />
      <span aria-hidden className="pointer-events-none absolute bottom-3 left-3 h-3 w-3 border-b-2 border-l-2 border-accent" />
      <span aria-hidden className="pointer-events-none absolute bottom-3 right-3 h-3 w-3 border-b-2 border-r-2 border-accent" />
      {/* Sweeping scanline */}
      {active && (
        <motion.div
          aria-hidden
          initial={{ y: "-100%" }}
          animate={{ y: "100%" }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
          className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-accent/45 to-transparent mix-blend-screen"
        />
      )}
    </div>
  );
}
