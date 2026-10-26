import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import type { Trip } from "@mototracker/shared";
import { Sheet } from "@/components/share/ShareSheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePost } from "@/hooks/useSocial";
import { ApiError } from "@/lib/api";
import { hapticSuccess } from "@/lib/haptics";
import { track } from "@/lib/telemetry";
import { pushToast } from "@/hooks/useToast";
import { cn } from "@/lib/cn";

/** Post a trip to the feed: a caption and whether to show the route. */
export function PostTripSheet({ trip, onClose }: { trip: Trip | null; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreatePost();
  const [caption, setCaption] = useState("");
  const [showRoute, setShowRoute] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (trip) {
      setCaption("");
      setShowRoute(true);
      setError(null);
    }
  }, [trip]);

  const submit = async () => {
    if (!trip) return;
    setError(null);
    try {
      const post = await create.mutateAsync({ tripId: trip.id, caption: caption.trim() || null, showRoute: showRoute && !!trip.hasRoute });
      hapticSuccess();
      track("social_posted", { route: showRoute });
      pushToast({ variant: "success", title: t("social.posted") });
      onClose();
      navigate(`/posts/${post.id}`);
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { error?: string; postId?: string } | undefined) : undefined;
      if (body?.error === "already_posted" && body.postId) {
        onClose();
        navigate(`/posts/${body.postId}`);
        return;
      }
      setError(body?.error === "objectionable" ? t("social.objectionable") : t("errors.generic"));
    }
  };

  return (
    <Sheet open={!!trip} onClose={onClose} title={t("social.postTitle")} description={t("social.postSubtitle")}>
      <Textarea
        value={caption}
        maxLength={280}
        rows={3}
        placeholder={t("social.captionPlaceholder")}
        onChange={(e) => setCaption(e.target.value)}
      />
      {trip?.hasRoute && (
        <button
          type="button"
          role="switch"
          aria-checked={showRoute}
          onClick={() => setShowRoute((v) => !v)}
          className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl border border-border px-4 text-left dark:border-border-dark"
        >
          <span>
            <span className="block text-[14px] font-medium">{t("social.showRoute")}</span>
            <span className="block text-[12px] text-muted dark:text-muted-dark">{t("social.showRouteHint")}</span>
          </span>
          <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition", showRoute ? "bg-accent" : "bg-border dark:bg-border-dark")}>
            <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition", showRoute ? "translate-x-5" : "translate-x-0.5")} />
          </span>
        </button>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <Button size="lg" variant="accent" className="w-full" disabled={create.isPending} onClick={() => void submit()}>
        <Send className="h-4 w-4" /> {create.isPending ? t("common.saving") : t("social.postCta")}
      </Button>
    </Sheet>
  );
}
