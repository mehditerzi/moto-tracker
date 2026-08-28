import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Copy, Mail, Trash2, UserMinus } from "lucide-react";
import type { OrgRole } from "@mototracker/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { useConfirm } from "@/components/ConfirmSheet";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { useFleetContext } from "@/components/fleet/FleetLayout";
import { canManageFleet, isOwner } from "@/hooks/useOrgs";
import {
  useCreateInvite,
  useFleetInvites,
  useFleetMembers,
  useRemoveMember,
  useRevokeInvite,
  useSetMemberRole,
  type CreatedInvite,
} from "@/hooks/useFleetData";
import { SectionHeading } from "@/components/fleet/bits";
import { RowCard, TableShell, Td, Th, Tr } from "@/components/fleet/table";

const ROLES: OrgRole[] = ["owner", "manager", "staff", "driver"];

/**
 * `/fleet/people` (docs/fleet-design.md §5, §7.5) — members, their roles, what
 * they are holding, and outstanding invitations.
 *
 * TWO SERVER RULES ARE MIRRORED HERE so the UI never offers a doomed action:
 * a manager cannot make or unmake owners, and the last owner cannot be demoted
 * or removed. Both are enforced by the API (`owner_role_required`, `last_owner`)
 * — this only keeps a manager from clicking something that will bounce.
 */
export function FleetPeoplePage() {
  const { t } = useTranslation();
  const { org } = useFleetContext();
  const manages = canManageFleet(org.role);
  const members = useFleetMembers(org.orgId, manages);
  const invites = useFleetInvites(org.orgId, manages);

  // Staff can reach this URL by typing it; the routes it needs are owner/manager
  // only. Send them back to the board rather than showing an error they cannot act on.
  if (!manages) return <Navigate to="/fleet" replace />;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("fleet.people.members")}>
        <SectionHeading title={t("fleet.people.members")} count={members.data?.length} />
        {members.isPending ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : members.isError || !members.data ? (
          <ErrorState onRetry={() => void members.refetch()} />
        ) : (
          <MemberList
            orgId={org.orgId}
            callerRole={org.role}
            mode={org.mode}
            members={members.data}
          />
        )}
      </section>

      <InviteSection orgId={org.orgId} callerRole={org.role} />

      <section aria-label={t("fleet.people.pending")}>
        <SectionHeading title={t("fleet.people.pending")} count={invites.data?.length} />
        {invites.isPending ? (
          <Skeleton className="h-20 rounded-2xl" />
        ) : (invites.data ?? []).length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-5 text-center text-[13px] text-muted dark:border-border-dark dark:text-muted-dark">
            {t("fleet.people.noPending")}
          </p>
        ) : (
          <InviteList orgId={org.orgId} callerRole={org.role} invites={invites.data!} />
        )}
      </section>
    </div>
  );
}

// ─── members ──────────────────────────────────────────────────────────────────

function MemberList({
  orgId,
  callerRole,
  mode,
  members,
}: {
  orgId: string;
  callerRole: OrgRole;
  mode: "fleet" | "rental";
  members: NonNullable<ReturnType<typeof useFleetMembers>["data"]>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const setRole = useSetMemberRole(orgId);
  const remove = useRemoveMember(orgId);
  const ownerCount = members.filter((m) => m.role === "owner" && m.status === "active").length;

  const mayTouch = (targetRole: OrgRole) => isOwner(callerRole) || targetRole !== "owner";
  const isLastOwner = (targetRole: OrgRole) => targetRole === "owner" && ownerCount <= 1;

  const onRole = async (userId: string, role: OrgRole) => {
    try {
      await setRole.mutateAsync({ userId, role });
      pushToast({ variant: "success", title: t("fleet.people.roleUpdated") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("fleet.people.roleFailed"), description: friendlyError(e, t) });
    }
  };

  const onRemove = async (userId: string, label: string) => {
    const ok = await confirm({
      title: t("fleet.people.removeConfirm", { name: label }),
      message: t("fleet.people.removeExplain"),
      confirmLabel: t("fleet.people.remove"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(userId);
      pushToast({ variant: "success", title: t("fleet.people.removed") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("fleet.people.roleFailed"), description: friendlyError(e, t) });
    }
  };

  const roleSelect = (m: (typeof members)[number]) => (
    <label>
      <span className="sr-only">{t("fleet.people.role")}</span>
      <select
        value={m.role}
        disabled={!mayTouch(m.role) || isLastOwner(m.role) || setRole.isPending}
        onChange={(e) => onRole(m.userId, e.target.value as OrgRole)}
        className="h-9 rounded-xl border border-border bg-surface px-2 text-[13px] disabled:opacity-50 dark:border-border-dark dark:bg-surface-elev-dark"
      >
        {ROLES.map((r) => (
          <option key={r} value={r} disabled={!mayTouch(r)}>
            {t(`fleet.roles.${r}`)}
          </option>
        ))}
      </select>
    </label>
  );

  const holdings = (m: (typeof members)[number]) =>
    m.assignments.length === 0 ? (
      <span className="text-muted dark:text-muted-dark">{t("common.dash")}</span>
    ) : (
      <span className="num text-[12px]">
        {m.assignments.map((a) => a.plate ?? a.nickname).join(", ")}
      </span>
    );

  return (
    <>
      <TableShell label={t("fleet.people.members")}>
        <thead>
          <tr>
            <Th>{t("fleet.people.person")}</Th>
            <Th>{t("fleet.people.email")}</Th>
            <Th>{t("fleet.people.role")}</Th>
            {mode === "fleet" && <Th>{t("fleet.people.holding")}</Th>}
            <Th>{t("fleet.people.joined")}</Th>
            <Th align="right">
              <span className="sr-only">{t("fleet.people.actions")}</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <Tr key={m.userId}>
              <Td>
                <span className="font-medium">{m.name ?? m.email ?? m.userId}</span>
                {m.isSelf && (
                  <span className="ml-2 rounded-full bg-surface-elev px-1.5 py-0.5 text-[10px] text-muted dark:bg-surface-elev-dark dark:text-muted-dark">
                    {t("fleet.people.you")}
                  </span>
                )}
              </Td>
              <Td className="text-muted dark:text-muted-dark">{m.email ?? t("common.dash")}</Td>
              <Td>{roleSelect(m)}</Td>
              {mode === "fleet" && <Td>{holdings(m)}</Td>}
              <Td className="num text-muted dark:text-muted-dark">{m.joinedAt.slice(0, 10)}</Td>
              <Td align="right">
                {!m.isSelf && mayTouch(m.role) && !isLastOwner(m.role) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(m.userId, m.name ?? m.email ?? m.userId)}
                    disabled={remove.isPending}
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    <span className="sr-only">{t("fleet.people.remove")}</span>
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      <ul className="flex flex-col gap-2 lg:hidden">
        {members.map((m) => (
          <li key={m.userId}>
            <RowCard>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">
                    {m.name ?? m.email ?? m.userId}
                    {m.isSelf && (
                      <span className="ml-2 text-[11px] font-normal text-muted dark:text-muted-dark">
                        {t("fleet.people.you")}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[12px] text-muted dark:text-muted-dark">{m.email}</p>
                  {mode === "fleet" && m.assignments.length > 0 && (
                    <p className="num mt-1 text-[12px]">{m.assignments.map((a) => a.plate ?? a.nickname).join(", ")}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {roleSelect(m)}
                  {!m.isSelf && mayTouch(m.role) && !isLastOwner(m.role) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemove(m.userId, m.name ?? m.email ?? m.userId)}
                    >
                      <UserMinus className="h-3.5 w-3.5" /> {t("fleet.people.remove")}
                    </Button>
                  )}
                </div>
              </div>
            </RowCard>
          </li>
        ))}
      </ul>
    </>
  );
}

// ─── invitations ──────────────────────────────────────────────────────────────

function InviteSection({ orgId, callerRole }: { orgId: string; callerRole: OrgRole }) {
  const { t } = useTranslation();
  const create = useCreateInvite(orgId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("driver");
  const [error, setError] = useState<string | undefined>();
  const [issued, setIssued] = useState<CreatedInvite | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(t("fleet.people.invalidEmail"));
      return;
    }
    try {
      const res = await create.mutateAsync({ email: email.trim().toLowerCase(), role });
      setIssued(res);
      setEmail("");
    } catch (err) {
      setError(friendlyError(err, t));
    }
  };

  return (
    <section aria-label={t("fleet.people.invite")}>
      <SectionHeading title={t("fleet.people.invite")} />
      <form
        onSubmit={submit}
        className="flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface/70 p-4 dark:border-border-dark dark:bg-surface-dark/60"
      >
        <div className="min-w-[220px] flex-1">
          <Field label={t("fleet.people.email")} error={error}>
            <Input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ali@ornek.com"
            />
          </Field>
        </div>
        <div className="w-40">
          <Field label={t("fleet.people.role")} id="invite-role">
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              className="h-11 w-full rounded-xl border border-border bg-surface px-2.5 text-[15px] dark:border-border-dark dark:bg-surface-elev-dark"
            >
              {ROLES.filter((r) => isOwner(callerRole) || r !== "owner").map((r) => (
                <option key={r} value={r}>
                  {t(`fleet.roles.${r}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button type="submit" variant="accent" disabled={create.isPending}>
          <Mail className="h-4 w-4" /> {t("fleet.people.sendInvite")}
        </Button>
      </form>

      {issued && <IssuedInvite issued={issued} onDismiss={() => setIssued(null)} />}
    </section>
  );
}

/**
 * The invitation link, shown exactly once.
 *
 * The token is a bearer capability — whoever holds it joins the organization —
 * so the server hands it back a single time and stores only its digest. There is
 * no "show it again": the honest affordance is to say so and let the manager
 * re-issue, which invalidates the previous link.
 */
function IssuedInvite({ issued, onDismiss }: { issued: CreatedInvite; onDismiss: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.acceptUrl);
      setCopied(true);
      pushToast({ variant: "success", title: t("fleet.people.linkCopied") });
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role="status"
      className="mt-3 rounded-2xl border border-accent/40 bg-accent/5 p-4"
    >
      <p className="text-[14px] font-semibold">
        {t("fleet.people.inviteReady", { email: issued.invite.email })}
      </p>
      <p className="mt-1 text-pretty text-[13px] text-muted dark:text-muted-dark">
        {t("fleet.people.inviteOnce")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-surface px-3 py-2 font-mono text-[12px] dark:border-border-dark dark:bg-surface-elev-dark">
          {issued.acceptUrl}
        </code>
        <Button variant="outline" size="sm" onClick={copy}>
          <Copy className="h-3.5 w-3.5" /> {copied ? t("fleet.people.copied") : t("fleet.people.copy")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t("common.dismiss")}
        </Button>
      </div>
    </div>
  );
}

function InviteList({
  orgId,
  callerRole,
  invites,
}: {
  orgId: string;
  callerRole: OrgRole;
  invites: NonNullable<ReturnType<typeof useFleetInvites>["data"]>;
}) {
  const { t } = useTranslation();
  const revoke = useRevokeInvite(orgId);

  return (
    <ul className="flex flex-col gap-1.5">
      {invites.map((i) => (
        <li
          key={i.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2 dark:border-border-dark dark:bg-surface-dark/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium">{i.email}</span>
            <span className="rounded-full bg-surface-elev px-1.5 py-0.5 text-[11px] text-muted dark:bg-surface-elev-dark dark:text-muted-dark">
              {t(`fleet.roles.${i.role}`)}
            </span>
            {i.expired && (
              <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
                {t("fleet.people.expired")}
              </span>
            )}
          </span>
          <span className="flex items-center gap-2">
            <span className="num text-[12px] text-muted dark:text-muted-dark">
              {t("fleet.people.expires", { date: i.expiresAt.slice(0, 10) })}
            </span>
            {(isOwner(callerRole) || i.role !== "owner") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => revoke.mutate(i.id)}
                disabled={revoke.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">{t("fleet.people.revoke")}</span>
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
