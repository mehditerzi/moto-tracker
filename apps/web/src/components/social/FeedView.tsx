import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Sparkles, UserRound } from "lucide-react";
import type { FeedPost } from "@mototracker/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { FeedPostCard } from "@/components/social/FeedPostCard";
import { PostMenu } from "@/components/social/PostMenu";
import { PersonRow } from "@/components/social/PersonRow";
import { RiderAvatar } from "@/components/social/RiderAvatar";
import { useProfileGate } from "@/components/social/ProfileGate";
import { useFeed, useMyProfile, useSuggestions } from "@/hooks/useSocial";

/** The "Akış" segment of the Rides tab: your rides and the people you follow. */
export function FeedView({ onShareTrip }: { onShareTrip: () => void }) {
  const { t } = useTranslation();
  const me = useMyProfile();
  const gate = useProfileGate();
  const feed = useFeed();
  const hasProfile = !!me.data?.profile?.rulesAccepted;
  const suggestions = useSuggestions(hasProfile);
  const [menu, setMenu] = useState<FeedPost | null>(null);
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Me + find people */}
      {me.isLoading ? (
        <Skeleton className="h-[68px] rounded-2xl" />
      ) : hasProfile ? (
        <div className="flex items-center gap-2">
          <Link
            to={`/u/${me.data!.profile!.handle}`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border bg-surface p-2.5 pr-3 dark:border-border-dark dark:bg-surface-dark"
          >
            <RiderAvatar name={me.data!.profile!.displayName} handle={me.data!.profile!.handle} className="h-10 w-10 text-[15px]" />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">{me.data!.profile!.displayName}</div>
              <div className="truncate text-[12px] text-muted dark:text-muted-dark">{t("social.myProfile")}</div>
            </div>
          </Link>
          <Button asChild variant="outline" className="h-[62px] w-[62px] shrink-0 rounded-2xl p-0" aria-label={t("social.findRiders")}>
            <Link to="/people">
              <Search className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      ) : (
        <Card className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_90%_at_0%_0%,rgba(225,255,77,0.18),transparent_60%)]" />
          <div className="relative flex flex-col gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent/20 text-accent-dim dark:text-accent">
              <UserRound className="h-5 w-5" />
            </span>
            <div>
              <div className="text-[17px] font-semibold">{t("social.joinTitle")}</div>
              <p className="mt-1 text-[13.5px] text-muted dark:text-muted-dark">{t("social.joinSub")}</p>
            </div>
            <Button variant="accent" className="self-start" onClick={() => gate()}>
              {t("social.joinCta")}
            </Button>
          </div>
        </Card>
      )}

      {/* Suggestions while the network is small */}
      {hasProfile && (suggestions.data?.length ?? 0) > 0 && posts.filter((p) => !p.isMine).length < 5 && (
        <section aria-labelledby="sugg" className="flex flex-col gap-2">
          <h2 id="sugg" className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
            <Sparkles className="h-3.5 w-3.5" /> {t("social.suggested")}
          </h2>
          <Card className="divide-y divide-border p-0 dark:divide-border-dark">
            {suggestions.data!.slice(0, 4).map((p) => (
              <PersonRow key={p.userId} person={p} />
            ))}
          </Card>
        </section>
      )}

      {feed.isLoading ? (
        <>
          <Skeleton className="h-[320px] rounded-2xl" />
          <Skeleton className="h-[320px] rounded-2xl" />
        </>
      ) : feed.isError ? (
        <ErrorState onRetry={() => void feed.refetch()} />
      ) : posts.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="text-[16px] font-semibold">{t("social.emptyTitle")}</div>
          <p className="text-[13.5px] text-muted dark:text-muted-dark">{t("social.emptySub")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="accent" size="sm" onClick={() => gate(onShareTrip)}>
              {t("social.shareFirst")}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/people">{t("social.findRiders")}</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {posts.map((p, i) => (
            <FeedPostCard key={p.id} post={p} index={i} onMenu={setMenu} />
          ))}
          {feed.hasNextPage && (
            <Button variant="ghost" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
              {feed.isFetchingNextPage ? t("common.loading") : t("social.loadMore")}
            </Button>
          )}
        </>
      )}
      <PostMenu post={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
