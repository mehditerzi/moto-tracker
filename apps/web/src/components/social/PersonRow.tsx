import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { RiderSummary } from "@mototracker/shared";
import { Button } from "@/components/ui/button";
import { RiderAvatar } from "@/components/social/RiderAvatar";
import { useProfileGate } from "@/components/social/ProfileGate";
import { useFollow, useMyProfile } from "@/hooks/useSocial";
import { hapticSelection } from "@/lib/haptics";

export function PersonRow({ person }: { person: RiderSummary }) {
  const { t } = useTranslation();
  const follow = useFollow();
  const gate = useProfileGate();
  const me = useMyProfile();
  const isMe = me.data?.profile?.handle === person.handle;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link to={`/u/${person.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
        <RiderAvatar name={person.displayName} handle={person.handle} />
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-semibold">{person.displayName}</div>
          <div className="truncate text-[12.5px] text-muted dark:text-muted-dark">
            @{person.handle}
            {person.reason ? ` · ${t(`social.reason.${person.reason}`)}` : person.city ? ` · ${person.city}` : ""}
          </div>
        </div>
      </Link>
      {!isMe && (
        <Button
          size="sm"
          variant={person.isFollowing ? "outline" : "accent"}
          disabled={follow.isPending}
          onClick={() =>
            gate(() => {
              hapticSelection();
              follow.mutate({ handle: person.handle, follow: !person.isFollowing });
            })
          }
        >
          {person.isFollowing ? t("social.following") : t("social.follow")}
        </Button>
      )}
    </div>
  );
}
