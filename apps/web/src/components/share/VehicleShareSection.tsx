import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Link2, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Sheet, RolePicker } from "@/components/share/ShareSheet";
import { useConfirm } from "@/components/ConfirmSheet";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { useMe } from "@/hooks/useMe";
import {
  useGroupMembers,
  useHandoverVehicle,
  useLeaveShareGroup,
  useRemoveVehicleFromGroup,
  useShareVehicle,
  useShareGroups,
  type ShareInviteResult,
} from "@/hooks/useVehicleShares";
import type { Bike } from "@mototracker/shared";

/**
 * "Who else can see this vehicle" — the sharing block on the vehicle edit
 * screen.
 *
 * It renders for a PERSONAL vehicle only. A company van is governed by an
 * organization, and offering to share one here would both contradict the fleet's
 * own permission model and reveal the fleet product to a consumer looking at
 * their own car (docs/fleet-design.md §1).
 */
export function VehicleShareSection({ bike }: { bike: Bike }) {
  const { t } = useTranslation();
  const me = useMe();
  const confirm = useConfirm();
  const groups = useShareGroups();
  const group = groups.data?.find((g) => g.id === bike.orgId) ?? null;
  const members = useGroupMembers(group?.id);
  const share = useShareVehicle(bike.id);
  const removeVehicle = useRemoveVehicleFromGroup();
  const leave = useLeaveShareGroup();
  const handover = useHandoverVehicle(bike.id);

  const [open, setOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "guest">("guest");
  const [invite, setInvite] = useState<ShareInviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [handoverEmail, setHandoverEmail] = useState("");

  const myId = me.data?.user.id;
  // A vehicle whose custodian is somebody else is one that was shared WITH me:
  // I can stop looking at it, but I cannot give it away or invite others.
  const isMine = !!myId && bike.userId === myId;

  // A BUSINESS fleet's vehicle: `orgId` is set but it is not one of the caller's
  // personal groups. Render nothing at all — a company van is governed by its
  // organization, and an affordance here would contradict that permission model
  // AND reveal fleet's existence to a consumer (docs/fleet-design.md §1). Held
  // until the groups have loaded so a slow request cannot flash the wrong UI.
  if (bike.orgId && !groups.isPending && !group) return null;

  const inviteLink = invite
    ? `${window.location.origin}/bikes?shareInvite=${encodeURIComponent(invite.token)}`
    : null;

  const onInvite = async () => {
    try {
      const res = await share.mutateAsync({ email: email.trim(), role });
      setInvite(res);
      setEmail("");
    } catch (e) {
      pushToast({ variant: "danger", title: t("share.inviteFailed"), description: friendlyError(e, t) });
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated in some WebViews; the link is on screen
      // and selectable either way, so this is not worth an error toast.
    }
  };

  const onStopSharing = async () => {
    if (!group) return;
    const ok = await confirm({
      title: t("share.stopConfirm"),
      message: t("share.stopConfirmBody"),
      confirmLabel: t("share.stop"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeVehicle.mutateAsync({ groupId: group.id, bikeId: bike.id });
      pushToast({ variant: "success", title: t("share.stopped") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) });
    }
  };

  const onLeave = async () => {
    if (!group || !myId) return;
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
    } catch (e) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) });
    }
  };

  const onHandover = async () => {
    const ok = await confirm({
      title: t("share.handoverConfirm"),
      message: t("share.handoverConfirmBody"),
      confirmLabel: t("share.handoverConfirmCta"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await handover.mutateAsync(handoverEmail.trim());
      setHandoverOpen(false);
      pushToast({ variant: "success", title: t("share.handoverDone") });
    } catch (e) {
      pushToast({
        variant: "danger",
        title: t("share.handoverFailed"),
        description: friendlyError(e, t),
      });
    }
  };

  return (
    <section className="mt-5 border-t border-border pt-4 dark:border-border-dark">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            <Users className="h-4 w-4 shrink-0 text-muted dark:text-muted-dark" />
            {t("share.sectionTitle")}
          </h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted dark:text-muted-dark">
            {group
              ? t("share.sharedWithCount", { count: Math.max((members.data?.length ?? 1) - 1, 0) })
              : t("share.notShared")}
          </p>
        </div>
        {isMine && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            {t("share.manage")}
          </Button>
        )}
      </div>

      {group && members.data && members.data.length > 1 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {members.data
            .filter((m) => !m.isSelf)
            .map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 dark:bg-surface-elev-dark"
              >
                <span className="min-w-0 truncate text-[13px]">{m.name || m.email}</span>
                <span className="shrink-0 text-[11px] uppercase tracking-wider text-muted dark:text-muted-dark">
                  {t(`share.role.${m.role}.short`)}
                </span>
              </li>
            ))}
        </ul>
      )}

      {/* Shared WITH me: the only action is to stop looking at it. */}
      {group && !isMine && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-3 text-muted dark:text-muted-dark"
          onClick={onLeave}
        >
          <LogOut className="h-4 w-4" /> {t("share.leave")}
        </Button>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("share.sheetTitle", { name: bike.nickname })}
        description={t("share.sheetBody")}
      >
        {invite ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed">
              {t("share.inviteSent", { email: invite.email })}
            </p>
            {/* The link is shown rather than emailed: there is no mail provider
                in this deployment's consumer path, and a link the inviter can
                send through WhatsApp is what people actually do. It is a bearer
                capability, so the copy says so. */}
            <div className="rounded-xl bg-surface p-3 text-[12px] leading-relaxed break-all dark:bg-surface-elev-dark">
              {inviteLink}
            </div>
            <p className="text-[12px] text-muted dark:text-muted-dark">{t("share.inviteLinkWarning")}</p>
            <Button type="button" variant="accent" onClick={copyLink}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t("share.copied") : t("share.copyLink")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setInvite(null)}>
              {t("share.inviteAnother")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label={t("share.emailLabel")}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@eposta.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <RolePicker value={role} onChange={setRole} />
            <Button
              type="button"
              variant="accent"
              disabled={!email.includes("@") || share.isPending}
              onClick={onInvite}
            >
              <Link2 className="h-4 w-4" /> {t("share.createInvite")}
            </Button>

            {group && (
              <Button type="button" variant="ghost" className="text-danger" onClick={onStopSharing}>
                {t("share.stop")}
              </Button>
            )}

            <div className="border-t border-border pt-4 dark:border-border-dark">
              <h4 className="text-[13px] font-semibold">{t("share.handoverTitle")}</h4>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted dark:text-muted-dark">
                {t("share.handoverBody")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setOpen(false);
                  setHandoverOpen(true);
                }}
              >
                {t("share.handoverCta")}
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet
        open={handoverOpen}
        onClose={() => setHandoverOpen(false)}
        title={t("share.handoverTitle")}
        description={t("share.handoverSheetBody")}
      >
        <div className="flex flex-col gap-4">
          {/* Stated in full, before the tap. This is irreversible and it moves a
              real asset's record between two people. */}
          <ul className="flex flex-col gap-1.5 rounded-xl bg-surface p-3 text-[12.5px] leading-relaxed dark:bg-surface-elev-dark">
            <li>{t("share.handoverTransfers")}</li>
            <li>{t("share.handoverKeeps")}</li>
          </ul>
          <Field label={t("share.handoverEmailLabel")}>
            <Input
              type="email"
              value={handoverEmail}
              onChange={(e) => setHandoverEmail(e.target.value)}
              placeholder="alici@eposta.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
          <Button
            type="button"
            variant="danger"
            disabled={!handoverEmail.includes("@") || handover.isPending}
            onClick={onHandover}
          >
            {t("share.handoverCta")}
          </Button>
        </div>
      </Sheet>
    </section>
  );
}
