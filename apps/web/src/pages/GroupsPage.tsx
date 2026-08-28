import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ChevronRight, FolderPlus, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { ErrorState } from "@/components/ErrorState";
import { useConfirm } from "@/components/ConfirmSheet";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { useBikes } from "@/hooks/useBikes";
import { useMe } from "@/hooks/useMe";
import {
  useAddVehicleToGroup,
  useCreateShareGroup,
  useDeleteShareGroup,
  useLeaveShareGroup,
  useRemoveVehicleFromGroup,
  useRenameShareGroup,
  useShareGroups,
} from "@/hooks/useVehicleShares";
import type { Bike, ShareGroup } from "@mototracker/shared";

/**
 * GROUPS — the screen that was missing.
 *
 * Sharing shipped first and built a "personal group" underneath itself, but a
 * group could only ever be born as a side effect of inviting somebody. The
 * owner's words: *"grouping is still not present like i want to make a group as
 * my cars or my bikes or ducatis bmws etc. but i couldnt see any option about
 * this"*. They were right — there was no option, because there was no screen.
 *
 * What this page is, in one line: **named collections of your own vehicles,
 * which you may then share.** Sharing is an action you take ON a group, not the
 * way you get one. A group with nobody else in it is a folder; the moment
 * somebody joins, the same folder is a shared garage — and the card says so,
 * because the difference is a disclosure and must never be something the user
 * has to remember.
 *
 * A vehicle can be in SEVERAL groups (migration 029), which is why membership is
 * edited as a list of checkboxes per group rather than a single "which group is
 * this car in?" picker. "Ducatiler" and "Motorlarım" are not alternatives.
 */

/** How many groups one person may have — mirrors MAX_SHARE_GROUPS on the API. */
const MAX_GROUPS = 10;

function GroupSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-40" />
      </div>
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  );
}

/** Create a group. Inline rather than behind a sheet: making one is the whole
 *  point of arriving here, so it should not cost a tap to reveal. */
function CreateGroup({ atCap }: { atCap: boolean }) {
  const { t } = useTranslation();
  const create = useCreateShareGroup();
  const [name, setName] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync(trimmed);
      setName("");
      pushToast({ variant: "success", title: t("groups.created", { name: trimmed }) });
    } catch (err) {
      pushToast({ variant: "danger", title: t("groups.createFailed"), description: friendlyError(err, t) });
    }
  };

  if (atCap) {
    return (
      <p className="text-[13px] text-muted dark:text-muted-dark">
        {t("groups.atCap", { max: MAX_GROUPS })}
      </p>
    );
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label={t("groups.nameLabel")} description={t("groups.nameHint")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder={t("groups.namePlaceholder")}
            autoComplete="off"
          />
        </Field>
        {/* The one lime button on the screen: creating a group is this page's
            primary action (docs/fleet-design.md §6). */}
        <Button
          type="submit"
          variant="accent"
          disabled={!name.trim() || create.isPending}
          className="self-start"
        >
          <Plus className="h-4 w-4" /> {t("groups.create")}
        </Button>
      </form>
    </Card>
  );
}

/** Rename, in place. A group's name is the only thing about it worth editing. */
function RenameForm({ group, onDone }: { group: ShareGroup; onDone: () => void }) {
  const { t } = useTranslation();
  const rename = useRenameShareGroup();
  const [name, setName] = useState(group.name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) {
      onDone();
      return;
    }
    try {
      await rename.mutateAsync({ groupId: group.id, name: trimmed });
      onDone();
    } catch (err) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(err, t) });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label={t("groups.nameLabel")}>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the user tapped
            "rename"; landing anywhere else would cost them a second tap. */}
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!name.trim() || rename.isPending}>
          {t("common.save")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Which of MY vehicles are in this group.
 *
 * Only the caller's OWN vehicles are listed, and that is the rule the API
 * enforces too: you may file your car anywhere you have access, but you may not
 * drag somebody else's car into a collection. Vehicles belonging to other
 * members of a shared group are shown as a read-only count so the card's total
 * still adds up.
 */
function VehiclePicker({ group, bikes }: { group: ShareGroup; bikes: Bike[] }) {
  const { t } = useTranslation();
  const add = useAddVehicleToGroup();
  const remove = useRemoveVehicleFromGroup();
  const me = useMe();
  const myId = me.data?.user.id;

  // A guest (the mechanic tier) can see the group but may not file anything in
  // it — offering checkboxes that always fail would be a lie.
  const canEdit = group.role !== "guest";
  const mine = bikes.filter((b) => b.userId === myId && b.orgId === null);
  const inGroupNotMine = bikes.filter(
    (b) => b.groupIds.includes(group.id) && b.userId !== myId,
  ).length;

  const toggle = async (bike: Bike, next: boolean) => {
    try {
      if (next) await add.mutateAsync({ groupId: group.id, bikeId: bike.id });
      else await remove.mutateAsync({ groupId: group.id, bikeId: bike.id });
    } catch (err) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(err, t) });
    }
  };

  if (mine.length === 0 && inGroupNotMine === 0) {
    return (
      <p className="text-[13px] text-muted dark:text-muted-dark">{t("groups.noVehiclesYet")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="label-micro text-muted dark:text-muted-dark">{t("groups.vehicles")}</div>
      {mine.map((b) => (
        <Checkbox
          key={b.id}
          label={b.nickname}
          description={[b.make, b.model].filter(Boolean).join(" ") || undefined}
          checked={b.groupIds.includes(group.id)}
          disabled={!canEdit}
          onChange={(e) => void toggle(b, e.target.checked)}
        />
      ))}
      {inGroupNotMine > 0 && (
        <p className="mt-1 text-[12px] text-muted dark:text-muted-dark">
          {t("groups.othersVehicles", { count: inGroupNotMine })}
        </p>
      )}
    </div>
  );
}

function GroupCard({ group, bikes }: { group: ShareGroup; bikes: Bike[] }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const del = useDeleteShareGroup();
  const leave = useLeaveShareGroup();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const isOwner = group.role === "owner";
  const shared = group.memberCount > 1;

  const onDelete = async () => {
    const ok = await confirm({
      title: t("groups.deleteConfirm", { name: group.name }),
      // Says plainly what is NOT lost. A collection that might take the cars
      // with it is a collection nobody dares tidy up.
      message: t("groups.deleteConfirmBody"),
      confirmLabel: t("groups.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(group.id);
      pushToast({ variant: "success", title: t("groups.deleted") });
    } catch (err) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(err, t) });
    }
  };

  const onLeave = async () => {
    const myId = me.data?.user.id;
    if (!myId) return;
    const ok = await confirm({
      title: t("share.leaveConfirm", { name: group.name }),
      message: t("share.leaveConfirmBody"),
      confirmLabel: t("share.leave"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await leave.mutateAsync({ groupId: group.id, userId: myId });
      pushToast({ variant: "success", title: t("share.left") });
    } catch (err) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(err, t) });
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 p-4">
        {renaming ? (
          <RenameForm group={group} onDone={() => setRenaming(false)} />
        ) : (
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-elev ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
                {shared ? (
                  <Users className="h-5 w-5 text-muted dark:text-muted-dark" strokeWidth={1.8} />
                ) : (
                  <FolderPlus
                    className="h-5 w-5 text-muted dark:text-muted-dark"
                    strokeWidth={1.8}
                  />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold">{group.name}</span>
                <span className="block truncate text-[13px] text-muted dark:text-muted-dark">
                  {/* Vehicle count always; the sharing state only when it is
                      true, so "shared" never becomes background noise. */}
                  <span className="num">{group.vehicleCount}</span>{" "}
                  {t("groups.vehicleCount", { count: group.vehicleCount })}
                  {shared && (
                    <> · {t("groups.sharedWith", { count: group.memberCount - 1 })}</>
                  )}
                  {!isOwner && <> · {t(`share.role.${group.role}.short`)}</>}
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 text-muted transition-transform dark:text-muted-dark",
                  open && "rotate-90",
                )}
              />
            </button>
          </div>
        )}

        {open && !renaming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="flex flex-col gap-4 border-t border-border pt-3 dark:border-border-dark"
          >
            <VehiclePicker group={group} bikes={bikes} />

            <div className="flex flex-wrap gap-2">
              {isOwner && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setRenaming(true)}>
                    <Pencil className="h-4 w-4" /> {t("groups.rename")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void onDelete()}>
                    <Trash2 className="h-4 w-4" /> {t("groups.delete")}
                  </Button>
                </>
              )}
              {!isOwner && (
                <Button size="sm" variant="outline" onClick={() => void onLeave()}>
                  {t("share.leave")}
                </Button>
              )}
            </div>

            {/* Sharing is an action ON a group, and it happens where the people
                are — on the vehicle's own screen, which already carries the
                role explanations and the invite-link warning. Pointing at it
                keeps one sharing flow in the app rather than two. */}
            <p className="text-[12px] text-muted dark:text-muted-dark">
              {t("groups.shareHint")}
            </p>
          </motion.div>
        )}
      </div>
    </Card>
  );
}

export function GroupsPage() {
  const { t } = useTranslation();
  const groups = useShareGroups();
  const bikes = useBikes();

  if (groups.isLoading || bikes.isLoading) return <GroupSkeleton />;
  if (groups.isError) return <ErrorState onRetry={() => void groups.refetch()} />;

  const data = groups.data ?? [];
  const owned = data.filter((g) => g.role === "owner").length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label-micro text-muted dark:text-muted-dark">{t("nav.bikes")}</div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">
            {t("groups.title")}
          </h1>
        </div>
        <Link
          to="/bikes"
          className="text-[13px] font-medium text-muted underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:text-muted-dark"
        >
          {t("groups.backToGarage")}
        </Link>
      </header>

      <p className="text-pretty text-[14px] text-muted dark:text-muted-dark">
        {t("groups.intro")}
      </p>

      <CreateGroup atCap={owned >= MAX_GROUPS} />

      {data.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center dark:border-border-dark">
          <FolderPlus className="h-8 w-8 text-muted dark:text-muted-dark" strokeWidth={1.6} />
          <p className="text-[15px] font-medium">{t("groups.emptyTitle")}</p>
          <p className="text-pretty text-[13px] text-muted dark:text-muted-dark">
            {t("groups.emptySub")}
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {data.map((g) => (
            <GroupCard key={g.id} group={g} bikes={bikes.data ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}
