import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Images, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  fitGuideRect,
  mapRectToSource,
  laplacianVariance,
  meanLuma,
  assessQuality,
  type Rect,
  type QualityIssue,
} from "@/lib/camera";

/** Target document aspect (width / height). A ruhsat opened flat is ~landscape. */
const DOC_ASPECT = 1.5;
/** Long-edge cap for the uploaded crop — plenty for OCR, keeps payloads sane. */
const MAX_OUTPUT_EDGE = 2400;
/** Downscale used only for the quality measurement pass. */
const SAMPLE_EDGE = 480;
const QUALITY = { minSharpness: 60, minLuma: 40, maxLuma: 250 };

/** Rear-camera constraints. Shared by the initial acquire and the retake so a
 *  retake (taken because the first was blurry) doesn't come back lower-res. */
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 3840 },
    height: { ideal: 2160 },
  },
};

type Phase = "starting" | "live" | "error" | "review";

/** One shot already taken in this session, as the tray shows it. */
export interface BurstShot {
  id: string;
  /** Object URL of the captured JPEG. */
  url: string;
  /** Uploading, safely stored, or failed — the tray says which. */
  status: "uploading" | "uploaded" | "failed";
}

interface Props {
  /** Receives the cropped JPEG when the user accepts a shot. */
  onCapture: (file: File) => void;
  /** Closes the camera without capturing. */
  onClose: () => void;
  /** Opens the gallery picker instead (fallback path). */
  onPickGallery: () => void;
  /**
   * Burst mode: stay open after each shot so a stack of documents can be
   * photographed without leaving the viewfinder. The caller owns the shots and
   * passes them back for the tray.
   */
  burst?: boolean;
  shots?: BurstShot[];
  /** Drop a bad shot straight from the tray, before it matters. */
  onRemoveShot?: (id: string) => void;
  /** "I'm done shooting" — only meaningful in burst mode. */
  onDone?: () => void;
  /** Shown when the session is full (the per-batch ceiling). */
  limitReached?: boolean;
}

/**
 * Full-screen in-app camera with a document guide rectangle. Streams the rear
 * camera via getUserMedia, lets the user frame the ruhsat inside the overlay,
 * then crops to the guide and runs a cheap sharpness/brightness check before
 * handing the JPEG to the caller. Uses only WebView-safe APIs so it survives
 * the eventual Capacitor iOS wrap.
 */
export function CameraCapture({
  onCapture,
  onClose,
  onPickGallery,
  burst = false,
  shots = [],
  onRemoveShot,
  onDone,
  limitReached = false,
}: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [review, setReview] = useState<{ url: string; file: File; issues: QualityIssue[] } | null>(
    null,
  );
  /** Brief white flash + count bump: the "got it" beat between burst shots. */
  const [flash, setFlash] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  // Acquire the camera once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
        setPhase("error");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPhase("live");
      } catch {
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  // Escape closes the full-screen camera, matching standard modal behavior
  // (the only other dismissal path is the close button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stop();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop, onClose]);

  // Track the viewport size so the guide rect stays centered on rotate/resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  useEffect(() => () => {
    if (review) URL.revokeObjectURL(review.url);
  }, [review]);

  const guide: Rect = fitGuideRect(box.width, box.height, DOC_ASPECT);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const crop = mapRectToSource(
      box,
      { width: video.videoWidth, height: video.videoHeight },
      guide,
    );

    // Output canvas: crop at native resolution, capped to MAX_OUTPUT_EDGE.
    const longEdge = Math.max(crop.sw, crop.sh);
    const k = longEdge > MAX_OUTPUT_EDGE ? MAX_OUTPUT_EDGE / longEdge : 1;
    const outW = Math.max(1, Math.round(crop.sw * k));
    const outH = Math.max(1, Math.round(crop.sh * k));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outW, outH);

    // Quality pass on a small sample of the same crop.
    const sk = Math.min(1, SAMPLE_EDGE / Math.max(outW, outH));
    const sw = Math.max(1, Math.round(outW * sk));
    const sh = Math.max(1, Math.round(outH * sk));
    const sample = document.createElement("canvas");
    sample.width = sw;
    sample.height = sh;
    const sctx = sample.getContext("2d");
    let issues: QualityIssue[] = [];
    if (sctx) {
      sctx.drawImage(canvas, 0, 0, sw, sh);
      const { data } = sctx.getImageData(0, 0, sw, sh);
      const gray = new Uint8ClampedArray(sw * sh);
      for (let i = 0, p = 0; i + 3 < data.length; i += 4, p++) {
        gray[p] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      }
      issues = assessQuality(
        { sharpness: laplacianVariance(gray, sw, sh), luma: meanLuma(data) },
        QUALITY,
      ).issues;
    }

    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.92),
    );
    if (!blob) return;
    const file = new File([blob], `ruhsat-${Date.now()}.jpg`, { type: "image/jpeg" });

    if (issues.length === 0) {
      // In burst mode the stream stays live: the whole point is shoot, shoot,
      // shoot. The confirmation is the flash and the tray count, not a screen.
      if (burst) {
        onCapture(file);
        setFlash((n) => n + 1);
        return;
      }
      stop();
      onCapture(file);
      return;
    }
    setReview({ url: URL.createObjectURL(blob), file, issues });
    setPhase("review");
  }, [box, guide, onCapture, stop, burst]);

  /** Return to the viewfinder after a quality warning, without re-acquiring. */
  const backToLive = useCallback(() => {
    setReview((r) => {
      if (r) URL.revokeObjectURL(r.url);
      return null;
    });
    setPhase("live");
    void (async () => {
      if (!streamRef.current && typeof navigator.mediaDevices?.getUserMedia === "function") {
        try {
          streamRef.current = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
        } catch {
          setPhase("error");
          return;
        }
      }
      if (videoRef.current && streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play().catch(() => {});
      }
    })();
  }, []);

  // The flash is purely decorative; clear it so it can fire again.
  useEffect(() => {
    if (flash === 0) return;
    const timer = setTimeout(() => setFlash(0), 180);
    return () => clearTimeout(timer);
  }, [flash]);

  const issueLabel: Record<QualityIssue, string> = {
    blurry: t("capture.qualityBlurry"),
    dark: t("capture.qualityDark"),
    glare: t("capture.qualityGlare"),
  };

  return (
    <div className="fixed inset-0 z-50 bg-black" ref={containerRef}>
      {/* Live preview */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Dim mask with a transparent rounded cutout over the guide. */}
      {phase === "live" && box.width > 0 && (
        <>
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <defs>
              <mask id="guide-hole">
                <rect x={0} y={0} width="100%" height="100%" fill="white" />
                <rect
                  x={guide.x}
                  y={guide.y}
                  width={guide.width}
                  height={guide.height}
                  rx={16}
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x={0}
              y={0}
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.55)"
              mask="url(#guide-hole)"
            />
            <rect
              x={guide.x}
              y={guide.y}
              width={guide.width}
              height={guide.height}
              rx={16}
              fill="none"
              stroke="rgb(190,242,100)"
              strokeWidth={2}
            />
          </svg>
          <p
            className="absolute left-1/2 -translate-x-1/2 text-center text-sm font-medium text-white/90 drop-shadow"
            style={{ top: Math.max(16, guide.y - 30) }}
          >
            {t("capture.frameHint")}
          </p>
        </>
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 pt-safe">
        <button
          type="button"
          onClick={() => {
            stop();
            onClose();
          }}
          aria-label={t("capture.close")}
          className="rounded-full bg-black/40 p-2 text-white backdrop-blur"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Starting / error states */}
      {phase === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-white/80">{t("capture.starting")}</p>
        </div>
      )}
      {phase === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-white/80" />
          <p className="text-sm text-white/90">{t("capture.permissionError")}</p>
          <button
            type="button"
            onClick={() => {
              stop();
              onPickGallery();
            }}
            className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm text-white backdrop-blur"
          >
            <Images className="h-4 w-4" /> {t("capture.gallery")}
          </button>
        </div>
      )}

      {/* Shot-taken flash. Decorative only — the tray below is the real receipt. */}
      {flash > 0 && (
        <motion.div
          key={flash}
          aria-hidden
          initial={{ opacity: 0.75 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-none absolute inset-0 bg-white"
        />
      )}

      {/* Burst tray: what you have shot so far, and a way to drop a bad one
          before it costs anything. Announced politely so a screen-reader user
          hears the count climb without the viewfinder stealing focus. */}
      {burst && phase === "live" && shots.length > 0 && (
        <div className="absolute inset-x-0 bottom-32 px-4">
          <p aria-live="polite" className="mb-2 text-center text-[13px] font-medium text-white/90 drop-shadow">
            {t("batch.shotCount", { count: shots.length })}
          </p>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {shots.map((s, i) => (
              <li key={s.id} className="relative shrink-0">
                <img
                  src={s.url}
                  alt=""
                  className={`h-16 w-16 rounded-lg object-cover ring-1 ${
                    s.status === "failed" ? "opacity-50 ring-danger" : "ring-white/40"
                  }`}
                />
                {s.status === "uploading" && (
                  <span
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40"
                  >
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </span>
                )}
                {s.status === "failed" && (
                  <span aria-hidden className="absolute inset-0 flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-danger" />
                  </span>
                )}
                {onRemoveShot && (
                  <button
                    type="button"
                    onClick={() => onRemoveShot(s.id)}
                    aria-label={t("batch.removeShot", { index: i + 1 })}
                    className="absolute -right-2 -top-2 inline-flex h-11 w-11 items-center justify-center"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-white ring-1 ring-white/50">
                      <X className="h-3.5 w-3.5" />
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {burst && phase === "live" && limitReached && (
        <div className="absolute inset-x-0 bottom-32 px-6">
          <p className="rounded-xl bg-amber-500/20 p-3 text-center text-[13px] text-amber-100">
            {t("batch.full")}
          </p>
        </div>
      )}

      {/* Shutter row */}
      {phase === "live" && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 p-8 pb-safe">
          <button
            type="button"
            onClick={() => {
              // In burst mode the gallery is additive (multi-select), so the
              // camera is left running to come back to.
              if (!burst) stop();
              onPickGallery();
            }}
            aria-label={t("capture.gallery")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur"
          >
            <Images className="h-6 w-6" />
          </button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => void capture()}
            disabled={limitReached}
            aria-label={t("capture.shutter")}
            className="flex items-center justify-center rounded-full border-4 border-white p-1 disabled:opacity-40"
            style={{ height: 72, width: 72 }}
          >
            <span className="h-full w-full rounded-full bg-white" />
          </motion.button>
          {burst && onDone ? (
            <button
              type="button"
              onClick={() => {
                stop();
                onDone();
              }}
              disabled={shots.length === 0}
              className="min-h-[44px] rounded-full bg-accent px-4 text-sm font-semibold text-black disabled:opacity-40"
            >
              {t("batch.doneShooting")}
            </button>
          ) : (
            <span className="h-11 w-11" />
          )}
        </div>
      )}

      {/* Review (only shown when quality is questionable) */}
      {phase === "review" && review && (
        <div className="absolute inset-0 flex flex-col bg-black/90">
          <img src={review.url} alt="" className="min-h-0 flex-1 object-contain" />
          <div className="space-y-3 p-5">
            <div className="flex items-start gap-2 rounded-xl bg-amber-500/15 p-3 text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-sm font-medium">{t("capture.qualityTitle")}</p>
                <ul className="mt-0.5 text-xs text-amber-200/80">
                  {review.issues.map((i) => (
                    <li key={i}>{issueLabel[i]}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={backToLive}
                className="min-h-[44px] flex-1 rounded-full border border-white/30 py-3 text-sm font-medium text-white"
              >
                {t("capture.retake")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onCapture(review.file);
                  // Burst: keep shooting. Single: the caller closes us.
                  if (burst) {
                    backToLive();
                    setFlash((n) => n + 1);
                  }
                }}
                className="min-h-[44px] flex-1 rounded-full bg-accent py-3 text-sm font-semibold text-black"
              >
                {t("capture.useAnyway")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
