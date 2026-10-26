import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { Sheet } from "@/components/share/ShareSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { renderShareCard, type CardData, type CardFormat } from "@/lib/shareCard";
import { shareImage } from "@/lib/shareImage";
import { pushToast } from "@/hooks/useToast";
import { hapticSuccess } from "@/lib/haptics";
import { track } from "@/lib/telemetry";

/**
 * Preview + share for a card. Two formats — a story (9:16) for Instagram /
 * WhatsApp status and a post (4:5) — rendered on the phone and handed to the
 * system share sheet. What you see is exactly the image that is shared.
 */
export function ShareCardSheet({
  open,
  onClose,
  data,
  fileName,
  text,
  url,
}: {
  open: boolean;
  onClose: () => void;
  data: CardData | null;
  fileName: string;
  text?: string;
  url?: string;
}) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<CardFormat>("story");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!open || !data) return;
    let cancelled = false;
    setBlob(null);
    void renderShareCard(data, format)
      .then((b) => {
        if (cancelled) return;
        setBlob(b);
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(b);
        });
      })
      .catch(() => {
        if (!cancelled) pushToast({ variant: "danger", title: t("shareCard.renderFailed") });
      });
    return () => {
      cancelled = true;
    };
  }, [open, data, format, t]);

  useEffect(() => {
    if (!open) {
      setFallback(false);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    }
  }, [open]);

  const share = async () => {
    if (!blob) return;
    setBusy(true);
    try {
      const out = await shareImage(blob, { fileName: `${fileName}-${format}.png`, text, url });
      if (out === "shared" || out === "downloaded") {
        hapticSuccess();
        track("share_card", { kind: data?.kind ?? "", format });
        if (out === "downloaded") pushToast({ variant: "success", title: t("shareCard.downloaded") });
      }
      if (out === "unsupported") setFallback(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("shareCard.title")} description={t("shareCard.subtitle")}>
      <div role="radiogroup" aria-label={t("shareCard.format")} className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 dark:bg-surface-elev-dark">
        {(["story", "post"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={format === f}
            onClick={() => setFormat(f)}
            className={cn(
              "min-h-[40px] rounded-lg text-[13.5px] font-medium transition",
              format === f
                ? "bg-bg text-text shadow-sm dark:bg-surface-dark dark:text-text-dark"
                : "text-muted dark:text-muted-dark",
            )}
          >
            {t(`shareCard.${f}`)}
          </button>
        ))}
      </div>

      <div className="flex justify-center">
        <div className={cn("relative w-full overflow-hidden rounded-2xl bg-[#0B0B0E] shadow-lg", format === "story" ? "max-w-[240px] aspect-[9/16]" : "max-w-[300px] aspect-[4/5]")}>
          {preview && blob ? (
            <img src={preview} alt={t("shareCard.previewAlt")} className="h-full w-full object-cover" />
          ) : (
            <Skeleton className="absolute inset-0 rounded-none" />
          )}
        </div>
      </div>

      {fallback && (
        <p className="text-center text-[13px] text-muted dark:text-muted-dark">{t("shareCard.longPress")}</p>
      )}

      <Button size="lg" className="w-full" disabled={!blob || busy} onClick={() => void share()}>
        <Share2 className="h-4 w-4" /> {t("shareCard.share")}
      </Button>
    </Sheet>
  );
}
