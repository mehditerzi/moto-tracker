import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, FileText, Image as ImageIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUploadDocument } from "@/hooks/useDocuments";
import { pushToast } from "@/hooks/useToast";

export function DocumentCapturePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const bikeId = params.get("bikeId") ?? undefined;
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const galleryInput = useRef<HTMLInputElement | null>(null);
  const upload = useUploadDocument();

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function handleFile(file: File) {
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const doc = await upload.mutateAsync({ file, bikeId });
      navigate(`/documents/${doc.id}/review`, { replace: true });
    } catch (e) {
      pushToast({
        variant: "danger",
        title: "Yüklenemedi",
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
          <CardTitle>Belge yükle</CardTitle>
          <CardDescription>
            Sigorta poliçesi, kasko poliçesi veya muayene belgenin fotoğrafını çek. Tarihler
            otomatik okunur, eksikleri sen onaylarsın.
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
                  onClick={() => cameraInput.current?.click()}
                >
                  <Camera className="h-4 w-4" /> Kamera ile çek
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => cameraInput.current?.click()}
                >
                  <FileText className="h-4 w-4" /> Ruhsat çek
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => galleryInput.current?.click()}
                >
                  <ImageIcon className="h-4 w-4" /> Galeriden seç
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
                <div className="relative overflow-hidden rounded-xl border border-border dark:border-border-dark">
                  <img src={preview} alt="" className="block h-64 w-full object-cover" />
                  {busy && (
                    <motion.div
                      initial={{ y: "-100%" }}
                      animate={{ y: "100%" }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-accent/40 to-transparent"
                    />
                  )}
                </div>
                <p className="text-center text-sm text-muted dark:text-muted-dark">
                  Yükleniyor ve okunuyor...
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
