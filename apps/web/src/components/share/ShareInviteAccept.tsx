import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/share/ShareSheet";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { useAcceptInvite, useInvitePreview } from "@/hooks/useVehicleShares";

/**
 * Accepting a garage invitation.
 *
 * The invite link is `/bikes?shareInvite=<token>` — a QUERY PARAMETER on a route
 * that already exists, rather than a route of its own. Two reasons, and the
 * second is the real one: the router is owned elsewhere and this feature should
 * not need to touch it; and a token in the path would end up in every server
 * access log and browser history entry as part of the URL's identity, whereas
 * this one is consumed and stripped on arrival (see the effect below).
 *
 * The user is told what they are joining BEFORE they join: the garage's name,
 * how many vehicles are in it, and — most importantly — what the role they were
 * offered actually lets them see. Accepting is the moment consent happens, so
 * the disclosure has to be on this screen and not in a policy page.
 */
export function ShareInviteAccept() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const token = params.get("shareInvite");
  const [open, setOpen] = useState(false);
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite();

  useEffect(() => {
    if (token) setOpen(true);
  }, [token]);

  const close = () => {
    setOpen(false);
    // Strip the token so a back navigation, a reload or a shared screenshot of
    // the URL bar cannot replay it.
    const next = new URLSearchParams(params);
    next.delete("shareInvite");
    setParams(next, { replace: true });
  };

  if (!token) return null;

  const onAccept = async () => {
    try {
      const group = await accept.mutateAsync(token);
      close();
      pushToast({ variant: "success", title: t("share.joined", { name: group.name }) });
    } catch (e) {
      pushToast({ variant: "danger", title: t("share.joinFailed"), description: friendlyError(e, t) });
    }
  };

  return (
    <Sheet open={open} onClose={close} title={t("share.inviteTitle")}>
      {preview.isLoading ? (
        <p className="text-[13px] text-muted dark:text-muted-dark">{t("common.loading")}</p>
      ) : preview.isError || !preview.data ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed">{t("share.inviteInvalid")}</p>
          <Button type="button" variant="ghost" onClick={close}>
            {t("common.close")}
          </Button>
        </div>
      ) : preview.data.alreadyMember ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed">
            {t("share.alreadyMember", { name: preview.data.groupName })}
          </p>
          <Button type="button" variant="accent" onClick={close}>
            {t("common.done")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed">
            {t("share.inviteBody", {
              name: preview.data.groupName,
              count: preview.data.vehicleCount,
            })}
          </p>
          {/* What this role will and will not show them. Stated here because
              this is where consent is given. */}
          <div className="rounded-xl bg-surface p-3 dark:bg-surface-elev-dark">
            <div className="text-[13px] font-semibold">
              {t(`share.role.${preview.data.role}.title`)}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted dark:text-muted-dark">
              {t(`share.role.${preview.data.role}.body`)}
            </p>
          </div>
          <Button type="button" variant="accent" disabled={accept.isPending} onClick={onAccept}>
            {t("share.acceptInvite")}
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
