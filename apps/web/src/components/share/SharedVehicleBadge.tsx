import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { useBikes } from "@/hooks/useBikes";
import { useShareGroups } from "@/hooks/useVehicleShares";
import type { Bike } from "@mototracker/shared";

/**
 * "This car is in a shared garage."
 *
 * Small, quiet, and always present on a shared vehicle. It exists because the
 * most dangerous state in a sharing feature is not knowing you are in it: a
 * person who has forgotten that their ex-partner is still in the family garage
 * will keep logging fill-ups into a shared record. So every shared vehicle says
 * so on every list it appears in, and names the garage.
 *
 * It renders nothing for a BUSINESS org vehicle. Those already carry
 * `OrgVehicleBadge` and its monitoring notice, which is a different and much
 * stronger disclosure — `useShareGroups` only ever returns personal groups, so
 * a company van simply finds no match here.
 */
export function SharedVehicleBadge({ bike }: { bike: Bike }) {
  const { t } = useTranslation();
  const me = useMe();
  // Only asks the server when there is something to ask about. A consumer with
  // no grouped vehicle at all never issues this request.
  const groups = useShareGroups({ enabled: bike.groupIds.length > 0 });
  if (bike.groupIds.length === 0) return null;

  const mine = groups.data?.filter((g) => bike.groupIds.includes(g.id)) ?? [];
  // ONLY GROUPS WITH OTHER PEOPLE IN THEM. Since a vehicle may now be in several
  // groups (029), most of them are private collections — "Ducatiler" — and
  // labelling those "paylaşımda" would cry wolf on every row until the word
  // stopped meaning anything. `memberCount > 1` is the whole test: a group you
  // are alone in discloses nothing.
  const shared = mine.filter((g) => g.memberCount > 1);
  if (shared.length === 0) return null;

  // Named when there is one, counted when there are several — a badge that
  // listed three Turkish group names would be wider than the row it sits in.
  const isMine = me.data?.user.id === bike.userId;
  const label =
    shared.length === 1
      ? isMine
        ? t("share.badgeShared", { name: shared[0]!.name })
        : t("share.badgeSharedWithMe", { name: shared[0]!.name })
      : t("groups.badgeSharedGroups", { count: shared.length });

  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted dark:text-muted-dark">
      <Users className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

/**
 * The same badge, addressed by id.
 *
 * The dashboard's own payload is a deliberately narrow projection of a vehicle
 * (`DashboardEntry`) and carries no `orgId` or custodian, so this reads the full
 * record out of the `["bikes"]` cache the garage screens already populate — one
 * shared cache entry, no extra request on a screen that is the app's front door.
 */
export function SharedVehicleBadgeById({ bikeId }: { bikeId: string }) {
  const bikes = useBikes();
  const bike = bikes.data?.find((b) => b.id === bikeId);
  if (!bike) return null;
  return <SharedVehicleBadge bike={bike} />;
}
