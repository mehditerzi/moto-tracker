import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Flame, MessageCircle, MoreHorizontal } from "lucide-react";
import type { FeedPost } from "@mototracker/shared";
import { Card } from "@/components/ui/card";
import { VehicleAvatar } from "@/components/VehicleAvatar";
import { RiderAvatar } from "@/components/social/RiderAvatar";
import { RouteThumb } from "@/components/social/RouteThumb";
import { relTime } from "@/components/social/relTime";
import { useProfileGate } from "@/components/social/ProfileGate";
import { useKudos } from "@/hooks/useSocial";
import { formatNumber } from "@/lib/format";
import { durationText } from "@/lib/rideCards";
import { hapticSelection, hapticSuccess } from "@/lib/haptics";
import { cn } from "@/lib/cn";

/** One shared ride in the feed: who, the shape of it, the numbers, Gaz!. */
export function FeedPostCard({
  post,
  index = 0,
  onMenu,
  linkToDetail = true,
}: {
  post: FeedPost;
  index?: number;
  onMenu?: (post: FeedPost) => void;
  linkToDetail?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const kudos = useKudos();
  const gate = useProfileGate();
  const speed = post.durationMin >= 5 ? post.distanceKm / (post.durationMin / 60) : null;
  const vehicleLine = [post.vehicle.make, post.vehicle.model].filter(Boolean).join(" ") || post.vehicle.name;

  const toggleKudos = () =>
    gate(() => {
      const on = !post.kudosByMe;
      if (on) hapticSuccess();
      else hapticSelection();
      kudos.mutate({ id: post.id, on });
    });

  const body = (
    <>
      {post.caption && <p className="whitespace-pre-line px-4 pb-3 text-[15px] leading-snug">{post.caption}</p>}
      <div className="grid grid-cols-3 gap-2 px-4 pb-3">
        <Stat label={t("shareCard.distance")} value={formatNumber(post.distanceKm, 1, i18n.language)} unit="km" />
        <Stat label={t("shareCard.time")} value={durationText(post.durationMin, t)} />
        {speed && <Stat label={t("shareCard.avgSpeed")} value={formatNumber(speed, 0, i18n.language)} unit={t("shareCard.kmh")} />}
      </div>
      {post.route ? (
        <RouteThumb route={post.route} className="aspect-[16/9]" />
      ) : (
        <VehicleAvatar
          vehicle={{ vehicleType: post.vehicle.vehicleType, make: post.vehicle.make, model: post.vehicle.model, color: post.vehicle.color, id: post.id }}
          emphasis
          className="aspect-[16/7] w-full"
        />
      )}
    </>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 5) * 0.04, duration: 0.24 }}>
      <Card className="overflow-hidden p-0">
        <header className="flex items-center gap-3 px-4 pb-3 pt-3.5">
          <Link to={`/u/${post.author.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
            <RiderAvatar name={post.author.displayName} handle={post.author.handle} />
            <div className="min-w-0">
              <div className="truncate text-[14.5px] font-semibold">{post.author.displayName}</div>
              <div className="truncate text-[12px] text-muted dark:text-muted-dark">
                {relTime(post.createdAt, i18n.language)}
                {vehicleLine && <> · {vehicleLine}</>}
              </div>
            </div>
          </Link>
          {onMenu && (
            <button
              type="button"
              aria-label={t("social.more")}
              onClick={() => onMenu(post)}
              className="-mr-2 grid h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-surface dark:text-muted-dark dark:hover:bg-surface-elev-dark"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          )}
        </header>
        {linkToDetail ? (
          <Link to={`/posts/${post.id}`} className="block">
            {body}
          </Link>
        ) : (
          body
        )}
        <footer className="flex items-center gap-1 px-2 py-1.5">
          <button
            type="button"
            onClick={toggleKudos}
            aria-pressed={post.kudosByMe}
            className={cn(
              "flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-[14px] font-semibold transition active:scale-95",
              post.kudosByMe ? "text-orange-500" : "text-muted dark:text-muted-dark",
            )}
          >
            <motion.span key={post.kudosByMe ? "on" : "off"} initial={post.kudosByMe ? { scale: 0.6, rotate: -15 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 14 }}>
              <Flame className={cn("h-5 w-5", post.kudosByMe && "fill-orange-500")} />
            </motion.span>
            {t("social.kudos")}
            {post.kudos > 0 && <span className="num">{post.kudos}</span>}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/posts/${post.id}#comments`)}
            className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-[14px] font-semibold text-muted transition active:scale-95 dark:text-muted-dark"
          >
            <MessageCircle className="h-5 w-5" />
            {post.comments > 0 ? <span className="num">{post.comments}</span> : t("social.comment")}
          </button>
        </footer>
      </Card>
    </motion.div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted dark:text-muted-dark">{label}</div>
      <div className="num truncate text-[18px] font-semibold leading-tight">
        {value}
        {unit && <span className="ml-0.5 text-[11.5px] font-medium text-muted dark:text-muted-dark">{unit}</span>}
      </div>
    </div>
  );
}
