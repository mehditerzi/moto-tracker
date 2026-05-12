import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUploadDocument } from "@/hooks/useDocuments";
import { pushToast } from "@/hooks/useToast";

export function DocumentCapturePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const bikeId = params.get("bikeId") ?? undefined;
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const galleryInput = useRef<HTMLInputElement | null>(null);
  const upload = useUploadDocument();

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function handleFile(file: File) {
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const doc = await upload.mutateAsync({ file, bikeId });
      navigate(`/documents/${doc.id}/review`, { replace: true });
    } catch (e) {
      pushToast({
        variant: "danger",
        title: t("capture.uploadFailed"),
        description: (e as Error).message,
      });
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-[22px] tracking-tight">{t("capture.title")}</CardTitle>
          <CardDescription>{t("capture.subtitle")}</CardDescription>
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
                  onClick={() => cameraInput.current?.click()}
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
                <input
                  ref={cameraInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
                <input
                  ref={galleryInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
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
