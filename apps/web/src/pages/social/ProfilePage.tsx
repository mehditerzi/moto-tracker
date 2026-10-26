import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Ban, Flag, MapPin, MoreHorizontal, Pencil, Share2 } from "lucide-react";
import type { FeedPost } from "@mototracker/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/BackLink";
import { ErrorState } from "@/components/ErrorState";
import { VehicleAvatar } from "@/components/VehicleAvatar";
import { Sheet } from "@/components/share/ShareSheet";
import { useConfirm } from "@/components/ConfirmSheet";
import { RiderAvatar } from "@/components/social/RiderAvatar";
import { FeedPostCard } from "@/components/social/FeedPostCard";
import { PostMenu } from "@/components/social/PostMenu";
import { useProfileGate } from "@/components/social/ProfileGate";
import { useBlock, useFollow, useProfile, useProfilePosts, useReport } from "@/hooks/useSocial";
import { pushToast } from "@/hooks/useToast";
import { ApiError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { hapticSelection } from "@/lib/haptics";
import { shareLink } from "@/lib/shareImage";
import { cn } from "@/lib/cn";

export function ProfilePage() {
  const { handle } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const gate = useProfileGate();
  const profile = useProfile(handle);
  const posts = useProfilePosts(handle);
  const follow = useFollow();
  const block = useBlock();
  const report = useReport();
  const [tab, setTab] = useState<"rides" | "garage">("rides");
  const [menu, setMenu] = useState(false);
  const [postMenu, setPostMenu] = useState<FeedPost | null>(null);

  if (profile.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-44 rounded-3xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  if (profile.isError || !profile.data) {
    const missing = profile.error instanceof ApiError && profile.error.status === 404;
    return (
      <div className="flex flex-col gap-5">
        <BackLink to="/rides" />
        {missing ? (
          <Card className="p-6 text-center">
            <div className="text-[17px] font-semibold">{t("social.profileNotFound")}</div>
          </Card>
        ) : (
          <ErrorState onRetry={() => void profile.refetch()} />
        )}
      </div>
    );
  }
  const p = profile.data;
  const list = posts.data?.pages.flatMap((x) => x.posts) ?? [];

  const onReport = async () => {
    setMenu(false);
    if (!(await confirm({ title: t("social.reportUserConfirm", { name: p.displayName }), message: t("social.reportConfirmSub"), confirmLabel: t("rides.report"), destructive: true }))) return;
    await report.mutateAsync({ kind: "user", targetId: p.userId, reason: "profile" });
    pushToast({ variant: "success", title: t("rides.reported") });
  };
  const onBlock = async () => {
    setMenu(false);
    if (p.blocked) {
      await block.mutateAsync({ userId: p.userId, block: false });
      return;
    }
    if (!(await confirm({ title: t("social.blockConfirm", { name: p.displayName }), message: t("social.blockConfirmSub"), confirmLabel: t("social.block"), destructive: true }))) return;
    await block.mutateAsync({ userId: p.userId, block: true });
    pushToast({ variant: "success", title: t("social.blocked", { name: p.displayName }) });
    navigate("/rides", { replace: true });
  };
  const onShare = () =>
    void shareLink({ text: t("social.shareProfileText", { name: p.displayName }), url: `https://mototracker.mehditerzi.com/u/${p.handle}` });

  return (
    <div className="flex flex-col gap-5">
      <BackLink to="/rides" />

      <header className="relative overflow-hidden rounded-3xl bg-[#0B0B0E] p-5 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_80%_at_0%_0%,rgba(225,255,77,0.22),transparent_60%)]" />
        <div className="relative flex items-start gap-4">
          <RiderAvatar name={p.displayName} handle={p.handle} className="h-16 w-16 text-[26px]" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-semibold leading-tight">{p.displayName}</h1>
            <div className="truncate text-[13.5px] text-white/60">@{p.handle}</div>
            {p.city && (
              <div className="mt-1 flex items-center gap-1 text-[12.5px] text-white/60">
                <MapPin className="h-3 w-3" /> {p.city}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={t("social.more")}
            onClick={() => (p.isMe ? onShare() : setMenu(true))}
            className="-mr-2 -mt-1 grid h-10 w-10 place-items-center rounded-full text-white/70 hover:bg-white/10"
          >
            {p.isMe ? <Share2 className="h-[18px] w-[18px]" /> : <MoreHorizontal className="h-5 w-5" />}
          </button>
        </div>
        {p.bio && <p className="relative mt-3 whitespace-pre-line text-[14px] leading-snug text-white/85">{p.bio}</p>}
        <div className="relative mt-4 grid grid-cols-4 gap-2 text-center">
          <Link to={`/u/${p.handle}/followers`} className="rounded-xl py-1 hover:bg-white/5">
            <div className="num text-[18px] font-semibold">{p.followers}</div>
            <div className="text-[11px] text-white/55">{t("social.followers")}</div>
          </Link>
          <Link to={`/u/${p.handle}/following`} className="rounded-xl py-1 hover:bg-white/5">
            <div className="num text-[18px] font-semibold">{p.following}</div>
            <div className="text-[11px] text-white/55">{t("social.followingCount")}</div>
          </Link>
          <div className="py-1">
            <div className="num text-[18px] font-semibold">{formatNumber(p.stats.km, 0, i18n.language)}</div>
            <div className="text-[11px] text-white/55">km</div>
          </div>
          <div className="py-1">
            <div className="num text-[18px] font-semibold">{p.stats.rides}</div>
            <div className="text-[11px] text-white/55">{t("shareCard.rides")}</div>
          </div>
        </div>
        <div className="relative mt-4">
          {p.isMe ? (
            <Button asChild variant="outline" className="w-full border-white/20 bg-white/5 text-white hover:bg-white/10">
              <Link to="/profile">
                <Pencil className="h-4 w-4" /> {t("social.editProfile")}
              </Link>
            </Button>
          ) : p.blocked ? (
            <Button variant="outline" className="w-full border-white/20 text-white" onClick={() => void onBlock()}>
              {t("social.unblock")}
            </Button>
          ) : (
            <Button
              variant={p.isFollowing ? "outline" : "accent"}
              className={cn("w-full", p.isFollowing && "border-white/20 bg-white/5 text-white hover:bg-white/10")}
              disabled={follow.isPending}
              onClick={() =>
                gate(() => {
                  hapticSelection();
                  follow.mutate({ handle: p.handle, follow: !p.isFollowing });
                })
              }
            >
              {p.isFollowing ? t("social.following") : p.followsMe ? t("social.followBack") : t("social.follow")}
            </Button>
          )}
        </div>
      </header>

      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 dark:bg-surface-elev-dark">
        {(["rides", "garage"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "min-h-[40px] rounded-lg text-[13.5px] font-medium transition",
              tab === k ? "bg-bg text-text shadow-sm dark:bg-surface-dark dark:text-text-dark" : "text-muted dark:text-muted-dark",
            )}
          >
            {k === "rides" ? t("social.tabRides", { count: p.stats.posts }) : t("social.tabGarage", { count: p.garage.length })}
          </button>
        ))}
      </div>

      {tab === "rides" ? (
        posts.isLoading ? (
          <Skeleton className="h-[320px] rounded-2xl" />
        ) : list.length === 0 ? (
          <Card className="p-6 text-center text-[13.5px] text-muted dark:text-muted-dark">
            {p.isMe ? t("social.noPostsMe") : t("social.noPosts")}
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {list.map((post, i) => (
              <FeedPostCard key={post.id} post={post} index={i} onMenu={setPostMenu} />
            ))}
            {posts.hasNextPage && (
              <Button variant="ghost" onClick={() => void posts.fetchNextPage()}>
                {t("social.loadMore")}
              </Button>
            )}
          </div>
        )
      ) : p.garage.length === 0 ? (
        <Card className="p-6 text-center text-[13.5px] text-muted dark:text-muted-dark">
          {p.showGarage ? t("social.emptyGarage") : t("social.hiddenGarage")}
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {p.garage.map((v) => (
            <Card key={v.id} className="overflow-hidden p-0">
              <VehicleAvatar vehicle={v} className="aspect-[4/3] w-full" />
              <div className="p-3">
                <div className="truncate text-[14px] font-semibold">{[v.make, v.model].filter(Boolean).join(" ") || v.nickname}</div>
                <div className="truncate text-[12px] text-muted dark:text-muted-dark">
                  {[v.year, v.cylinderCc ? `${v.cylinderCc} cc` : null, v.color].filter(Boolean).join(" · ")}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={`@${p.handle}`}>
        <div className="flex flex-col">
          <button type="button" onClick={onShare} className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium hover:bg-surface dark:hover:bg-surface-elev-dark">
            <Share2 className="h-5 w-5" /> {t("social.shareProfile")}
          </button>
          <button type="button" onClick={() => void onReport()} className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium hover:bg-surface dark:hover:bg-surface-elev-dark">
            <Flag className="h-5 w-5" /> {t("social.reportUser")}
          </button>
          <button type="button" onClick={() => void onBlock()} className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-danger hover:bg-surface dark:hover:bg-surface-elev-dark">
            <Ban className="h-5 w-5" /> {p.blocked ? t("social.unblock") : t("social.blockUser", { name: p.displayName })}
          </button>
        </div>
      </Sheet>
      <PostMenu post={postMenu} onClose={() => setPostMenu(null)} />
    </div>
  );
}
