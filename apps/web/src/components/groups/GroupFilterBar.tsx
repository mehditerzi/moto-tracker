import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FolderPlus, Settings2, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useShareGroups } from "@/hooks/useVehicleShares";
import type { Bike, ShareGroup } from "@mototracker/shared";

/**
 * The garage list, sliced by group.
 *
 * This is where the feature earns its place: a group nobody can browse BY is an
 * admin screen, not a way of organising a garage. The owner asked to be able to
 * make "Ducatis" and "Motorlarım" — the point of doing so is that the garage can
 * then be looked at one collection at a time.
 *
 * Deliberately a filter rather than sections. A vehicle may be in several groups
 * at once (migration 029), so sectioning would print the same Monster under
 * "Ducatiler" and again under "Motorlarım" — the list would be longer than the
 * garage, and "how many bikes do I have" would stop having an answer on screen.
 * One chip at a time keeps every row unique and the count honest.
 *
 * The bar hides itself entirely when the user has no groups: somebody who has
 * never made one should not pay a row of chrome for a feature they are not
 * using. The empty-state prompt lives on the garage's own empty state and in
 * Settings, not here.
 */

/** `null` means "all vehicles" — the default, and what the chip row starts on. */
export type GroupFilter = string | null;

/**
 * Which filter is actually in force.
 *
 * A group that has just been deleted — or that the user has just left, or that
 * belongs to a stale cache — must not leave the garage filtered to nothing with
 * no obvious way back. Falling back to "all" turns that into a no-op instead of
 * a convincingly empty garage, which is the failure mode that makes people think
 * their data is gone.
 */
export function resolveGroupFilter(
  requested: GroupFilter,
  groups: readonly { id: string }[],
): GroupFilter {
  if (requested === null) return null;
  return groups.some((g) => g.id === requested) ? requested : null;
}

/** The vehicles a filter selects. `null` passes the list straight through. */
export function filterByGroup<T extends { groupIds: string[] }>(
  bikes: readonly T[],
  groupId: GroupFilter,
): T[] {
  return groupId === null ? [...bikes] : bikes.filter((b) => b.groupIds.includes(groupId));
}

/**
 * The filter state plus the filtered list. Kept as a hook so the page owns the
 * data and the bar stays a presentational component — and so a page that wants
 * the filter without the chips (or the chips without re-filtering) can have it.
 */
export function useGroupFilter(bikes: Bike[] | undefined) {
  const groups = useShareGroups();
  const [groupId, setGroupId] = useState<GroupFilter>(null);

  const active = resolveGroupFilter(groupId, groups.data ?? []);

  const filtered = useMemo(
    () => (active === null ? bikes : filterByGroup(bikes ?? [], active)),
    [bikes, active],
  );

  return {
    groups: groups.data ?? [],
    groupId: active,
    setGroupId,
    /** The vehicles to render. Same reference as `bikes` when unfiltered. */
    filtered,
  };
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        // 44px tall so the row is a comfortable touch target, and `shrink-0` so
        // a long Turkish group name scrolls rather than squeezing its neighbours.
        "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        selected
          ? // Inverted, not lime: `accent` is reserved for the primary CTA and
            // never used to encode data (docs/fleet-design.md §6). `aria-pressed`
            // carries the state for anyone who cannot see the inversion.
            "border-text bg-text text-bg dark:border-text-dark dark:bg-text-dark dark:text-bg-dark"
          : "border-border bg-surface text-muted hover:border-border-strong dark:border-border-dark dark:bg-surface-elev-dark dark:text-muted-dark dark:hover:border-border-strong-dark",
      )}
    >
      {children}
    </button>
  );
}

/** The count on a chip. Tabular so a column of chips does not jitter. */
function Count({ n }: { n: number }) {
  return <span className="num text-[12px] opacity-70">{n}</span>;
}

export function GroupFilterBar({
  groups,
  groupId,
  onChange,
  total,
}: {
  groups: ShareGroup[];
  groupId: GroupFilter;
  onChange: (id: GroupFilter) => void;
  /** Vehicles in the unfiltered garage — the count on the "all" chip. */
  total: number;
}) {
  const { t } = useTranslation();
  if (groups.length === 0) return null;

  return (
    <nav aria-label={t("groups.filterLabel")} className="-mx-4 px-4">
      {/* Edge-to-edge and horizontally scrollable: with ten groups and Turkish
          names this row is wider than a phone, and wrapping it to three lines
          would push the garage itself below the fold. */}
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip selected={groupId === null} onClick={() => onChange(null)}>
          {t("groups.all")}
          <Count n={total} />
        </Chip>
        {groups.map((g) => (
          <Chip key={g.id} selected={groupId === g.id} onClick={() => onChange(g.id)}>
            {/* A shared group is marked, always. Knowing a collection has other
                people in it is the difference between a folder and a
                disclosure, and it must not depend on remembering. */}
            {g.memberCount > 1 && <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="max-w-[10rem] truncate">{g.name}</span>
            <Count n={g.vehicleCount} />
            {g.memberCount > 1 && (
              <span className="sr-only">
                {t("groups.sharedWith", { count: g.memberCount - 1 })}
              </span>
            )}
          </Chip>
        ))}
        <Link
          to="/groups"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-4 text-[13px] font-medium text-muted transition hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:border-border-dark dark:text-muted-dark dark:hover:border-border-strong-dark"
        >
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
          {t("groups.manage")}
        </Link>
      </div>
    </nav>
  );
}

/**
 * What the garage shows when a filter is on and the group is empty.
 *
 * Distinct from the garage's own empty state on purpose: "you have no vehicles"
 * and "this collection is empty" call for different next actions, and showing
 * the first when the second is true is how a filter convinces somebody their
 * data is gone.
 */
export function EmptyGroup({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center dark:border-border-dark">
      <FolderPlus className="h-8 w-8 text-muted dark:text-muted-dark" strokeWidth={1.6} />
      <p className="text-[15px] font-medium">{t("groups.emptyGroup")}</p>
      <p className="text-pretty text-[13px] text-muted dark:text-muted-dark">
        {t("groups.emptyGroupSub")}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-1 text-[13px] font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {t("groups.showAll")}
      </button>
    </div>
  );
}
