import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Camera, Crown, FileText, FolderOpen, ImagePlus, Share2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/share/ShareSheet";
import { BackLink } from "@/components/BackLink";
import { VehicleBar } from "@/components/VehicleBar";
import { ErrorState } from "@/components/ErrorState";
import { useConfirm } from "@/components/ConfirmSheet";
import { usePaywall } from "@/components/paywall/PaywallContext";
import { useSelectedBike } from "@/hooks/useSelectedBike";
import { useEntitlement } from "@/hooks/useEntitlement";
import { attachmentFileUrl, useAttachments, useDeleteAttachment, useUploadAttachment } from "@/hooks/useAssistant";
import { downscaleImageFile } from "@/lib/camera";
import { formatDate } from "@/lib/format";
import { hapticSelection, hapticTap } from "@/lib/haptics";
import { friendlyError, proLimitCode } from "@/lib/apiError";
import { pushToast } from "@/hooks/useToast";
import { track } from "@/lib/telemetry";
import { env } from "@/env";
import { isNative, getBearerToken } from "@/lib/nativeAuth";
import { cn } from "@/lib/cn";
import { ATTACHMENT_KINDS, type Attachment, type AttachmentKind } from "@mototracker/shared";

/**
 * The digital glovebox: the papers you would otherwise keep in the car —
 * registration, licence, policies, invoices, warranties — always on the phone.
 */
export function GloveboxPage() {
  const { t } = useTranslation();
  const { bikes, bikeId, bike, select } = useSelectedBike();
  const files = useAttachments(bikeId);
  const ent = useEntitlement();
  const { openPaywall } = usePaywall();
  const [kind, setKind] = useState<AttachmentKind | "all">("all");
  const [pending, setPending] = useState<File | null>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  const limit = ent.data?.attachmentLimit ?? null;
  const used = ent.data?.attachmentsUsed ?? 0;
  const full = limit !== null && used >= limit;

  const startAdd = (which: "camera" | "pick") => {
    hapticTap();
    if (full) {
      openPaywall("glovebox");
      return;
    }
    (which === "camera" ? cameraRef : pickRef).current?.click();
  };

  const shown = (files.data ?? []).filter((f) => kind === "all" || f.kind === kind);
  const kindsPresent = new Set((files.data ?? []).map((f) => f.kind));

  return (
    <div className="flex flex-col gap-4">
      <BackLink to="/assistant" />
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label-micro text-muted dark:text-muted-dark">{t("nav.assistant")}</div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{t("glovebox.title")}</h1>
        </div>
        {limit !== null && (
          <button
            type="button"
            onClick={() => openPaywall("glovebox")}
            className="num flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark"
          >
            <Crown className="h-3.5 w-3.5 text-accent-dim" /> {used}/{limit}
          </button>
        )}
      </header>
      <p className="-mt-1 text-[13.5px] leading-relaxed text-muted dark:text-muted-dark">{t("glovebox.subtitle")}</p>

      {bike && <VehicleBar bike={bike} bikes={bikes.data ?? []} onChange={select} />}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="accent" size="lg" onClick={() => startAdd("camera")}>
          <Camera className="h-4 w-4" /> {t("glovebox.photo")}
        </Button>
        <Button variant="outline" size="lg" onClick={() => startAdd("pick")}>
          <ImagePlus className="h-4 w-4" /> {t("glovebox.fromFiles")}
        </Button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setPending(f);
        }}
      />
      <input
        ref={pickRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setPending(f);
        }}
      />

      {kindsPresent.size > 1 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {(["all", ...ATTACHMENT_KINDS.filter((k) => kindsPresent.has(k))] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                if (k !== kind) hapticSelection();
                setKind(k);
              }}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 transition",
                k === kind
                  ? "bg-text text-bg ring-text dark:bg-text-dark dark:text-bg-dark"
                  : "bg-surface ring-border dark:bg-surface-elev-dark dark:ring-border-dark",
              )}
            >
              {k === "all" ? t("glovebox.all") : t(`glovebox.kind.${k}`)}
            </button>
          ))}
        </div>
      )}

      {files.isLoading ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="aspect-[4/3] rounded-2xl" />
          <Skeleton className="aspect-[4/3] rounded-2xl" />
        </div>
      ) : files.isError ? (
        <ErrorState onRetry={() => void files.refetch()} />
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-border px-6 py-10 text-center dark:border-border-dark">
          <FolderOpen className="h-8 w-8 text-muted dark:text-muted-dark" strokeWidth={1.5} />
          <div className="text-[15px] font-semibold">{t("glovebox.empty")}</div>
          <p className="max-w-[34ch] text-[13px] text-muted dark:text-muted-dark">{t("glovebox.emptySub")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <AnimatePresence initial={false}>
            {shown.map((f, i) => (
              <motion.button
                key={f.id}
                type="button"
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: Math.min(i, 8) * 0.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setViewing(f)}
                className="group overflow-hidden rounded-2xl bg-surface text-left ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark"
              >
                <div className="relative aspect-[4/3] bg-black/5 dark:bg-black/30">
                  {f.mimeType.startsWith("image/") ? (
                    <img src={attachmentFileUrl(f.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center">
                      <FileText className="h-10 w-10 text-muted dark:text-muted-dark" strokeWidth={1.4} />
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur">
                    {t(`glovebox.kind.${f.kind}`)}
                  </span>
                </div>
                <div className="p-2.5">
                  <div className="truncate text-[13.5px] font-medium">{f.title}</div>
                  <div className="num text-[11.5px] text-muted dark:text-muted-dark">
                    {f.expiresOn ? t("glovebox.validUntil", { date: formatDate(f.expiresOn) }) : formatDate(f.createdAt.slice(0, 10))}
                  </div>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      <UploadSheet
        file={pending}
        bikeId={bikeId}
        onClose={() => setPending(null)}
        onLimit={() => {
          setPending(null);
          openPaywall("glovebox");
        }}
      />
      <Viewer file={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function UploadSheet({
  file,
  bikeId,
  onClose,
  onLimit,
}: {
  file: File | null;
  bikeId?: string;
  onClose: () => void;
  onLimit: () => void;
}) {
  const { t } = useTranslation();
  const upload = useUploadAttachment();
  const [kind, setKind] = useState<AttachmentKind>("registration");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [personal, setPersonal] = useState(false);
  const [expiresOn, setExpiresOn] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    setKind("registration");
    setTitle(t("glovebox.kind.registration"));
    setTitleTouched(false);
    setPersonal(false);
    setExpiresOn("");
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(null);
  }, [file, t]);

  return (
    <Sheet open={!!file} onClose={onClose} title={t("glovebox.addTitle")}>
      {file && (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              // Phone photos are 4-12 MB; the server keeps 2400px anyway, so
              // shrinking first saves the upload, not the quality.
              const body = file.type.startsWith("image/") ? await downscaleImageFile(file, 2400) : file;
              await upload.mutateAsync({
                file: body,
                title: title.trim() || t(`glovebox.kind.${kind}`),
                kind,
                bikeId: personal ? null : bikeId,
                expiresOn: expiresOn || null,
              });
              track("glovebox_added", { kind });
              pushToast({ variant: "success", title: t("glovebox.saved") });
              onClose();
            } catch (err) {
              if (proLimitCode(err)) onLimit();
              else pushToast({ variant: "danger", title: friendlyError(err, t) });
            }
          }}
        >
          <div className="flex items-center gap-3">
            <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
              {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <FileText className="h-8 w-8 text-muted" />}
            </div>
            <div className="min-w-0 text-[12.5px] text-muted dark:text-muted-dark">
              <div className="truncate font-medium text-text dark:text-text-dark">{file.name}</div>
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </div>
          </div>
          <div role="radiogroup" aria-label={t("glovebox.kindLabel")} className="flex flex-wrap gap-1.5">
            {ATTACHMENT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={k === kind}
                onClick={() => {
                  if (k !== kind) hapticSelection();
                  setKind(k);
                  if (!titleTouched) setTitle(t(`glovebox.kind.${k}`));
                  if (k === "license") setPersonal(true);
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 transition",
                  k === kind ? "bg-accent text-black ring-accent" : "bg-surface ring-border dark:bg-surface-elev-dark dark:ring-border-dark",
                )}
              >
                {t(`glovebox.kind.${k}`)}
              </button>
            ))}
          </div>
          <Field label={t("glovebox.name")}>
            <Input
              value={title}
              maxLength={120}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
            />
          </Field>
          <Field label={t("glovebox.expires")} optional description={t("glovebox.expiresHint")}>
            <DateInput value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </Field>
          {bikeId && (
            <label className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3.5 py-3 text-[13.5px] ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
              <span>{t("glovebox.personal")}</span>
              <input
                type="checkbox"
                role="switch"
                checked={personal}
                onChange={(e) => setPersonal(e.target.checked)}
                className="h-5 w-5 accent-[#E1FF4D]"
              />
            </label>
          )}
          <Button type="submit" size="lg" variant="accent" disabled={upload.isPending} className="w-full">
            {upload.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </form>
      )}
    </Sheet>
  );
}

/** Fetches with the native bearer too — Safari outside the app has no session. */
async function fetchFile(f: Attachment): Promise<File> {
  const bearer = isNative() ? getBearerToken() : null;
  const res = await fetch(`${env.VITE_API_URL}${attachmentFileUrl(f.id)}`, {
    credentials: "include",
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
  if (!res.ok) throw new Error(String(res.status));
  const ext = f.mimeType === "application/pdf" ? "pdf" : "jpg";
  return new File([await res.blob()], `${f.title}.${ext}`, { type: f.mimeType });
}

function Viewer({ file, onClose }: { file: Attachment | null; onClose: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const del = useDeleteAttachment();
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const f = await fetchFile(file);
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [f] })) await nav.share({ files: [f], title: file.title });
      else {
        const url = URL.createObjectURL(f);
        window.open(url, "_blank", "noopener");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") pushToast({ variant: "danger", title: friendlyError(e, t) });
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {file && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col bg-black/95 pb-safe pt-safe"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={file.title}
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-white">
            <button type="button" onClick={onClose} aria-label={t("common.close")} className="grid h-10 w-10 place-items-center rounded-full bg-white/10">
              <X className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold">{file.title}</div>
            <button
              type="button"
              aria-label={t("common.delete")}
              disabled={del.isPending}
              onClick={async () => {
                const ok = await confirm({ title: t("glovebox.deleteConfirm"), confirmLabel: t("common.delete"), destructive: true });
                if (!ok) return;
                await del.mutateAsync(file.id);
                onClose();
              }}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3" onClick={onClose}>
            {file.mimeType.startsWith("image/") ? (
              <motion.img
                src={attachmentFileUrl(file.id)}
                alt={file.title}
                className="max-h-full max-w-full rounded-lg object-contain"
                initial={{ scale: 0.94, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-white/80" onClick={(e) => e.stopPropagation()}>
                <FileText className="h-16 w-16" strokeWidth={1.2} />
                <span className="text-[14px]">{t("glovebox.pdf")}</span>
              </div>
            )}
          </div>
          <div className="px-4 pb-4">
            <Button size="lg" variant="accent" className="w-full" disabled={busy} onClick={() => void share()}>
              <Share2 className="h-4 w-4" /> {file.mimeType === "application/pdf" ? t("glovebox.openPdf") : t("common.share")}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
