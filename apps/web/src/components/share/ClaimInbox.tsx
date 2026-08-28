import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, RolePicker } from "@/components/share/ShareSheet";
import { useConfirm } from "@/components/ConfirmSheet";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import {
  useDecideClaim,
  useIncomingClaims,
  useOutgoingClaims,
  useStartSeparateRecord,
} from "@/hooks/useVehicleShares";
import type { IncomingClaim } from "@mototracker/shared";

/**
 * Somebody is asking about one of your vehicles.
 *
 * This is the holder's half of the duplicate conversation, and the only place a
 * claim can be settled. It lives on the garage screen rather than behind a
 * notification because a claim on a real asset should be impossible to miss and
 * trivial to refuse — the decline button is as prominent as the approve one, and
 * doing nothing at all is a safe, supported outcome: an unanswered claim simply
 * expires and the vehicle never moves.
 */
export function ClaimInbox() {
  const { t } = useTranslation();
  const incoming = useIncomingClaims();
  const outgoing = useOutgoingClaims();
  const [deciding, setDeciding] = useState<IncomingClaim | null>(null);

  const claims = incoming.data ?? [];
  const pendingMine = (outgoing.data ?? []).filter(
    (c) => c.status === "pending" || c.separateRecordAvailable,
  );
  if (claims.length === 0 && pendingMine.length === 0) return null;

  return (
    <>
      {claims.map((c) => (
        <Card key={c.id} className="flex flex-col gap-3 border-accent/40 bg-accent/5 p-4">
          <div className="flex items-start gap-3">
            <Inbox className="mt-0.5 h-5 w-5 shrink-0 text-accent-dim" />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">
                {t(c.kind === "purchase" ? "share.inboxPurchase" : "share.inboxAccess", {
                  name: c.bikeNickname,
                })}
              </div>
              <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted dark:text-muted-dark">
                {c.requesterName || c.requesterEmail}
                {c.message ? ` — “${c.message}”` : ""}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="accent" className="flex-1" onClick={() => setDeciding(c)}>
              {t("share.review")}
            </Button>
          </div>
        </Card>
      ))}

      {pendingMine.map((c) => (
        <OutgoingRow key={c.id} claim={c} />
      ))}

      <DecideSheet claim={deciding} onClose={() => setDeciding(null)} />
    </>
  );
}

function OutgoingRow({
  claim,
}: {
  claim: { id: string; identifierHint: string; status: string; separateRecordAvailable: boolean };
}) {
  const { t } = useTranslation();
  const start = useStartSeparateRecord();
  return (
    <Card className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="num truncate text-[13px] font-medium">{claim.identifierHint}</div>
        <div className="text-[12.5px] text-muted dark:text-muted-dark">
          {claim.separateRecordAvailable ? t("share.claimUnanswered") : t("share.claimWaiting")}
        </div>
      </div>
      {claim.separateRecordAvailable && (
        <Button
          size="sm"
          variant="outline"
          disabled={start.isPending}
          onClick={async () => {
            try {
              await start.mutateAsync(claim.id);
              pushToast({ variant: "success", title: t("share.separateRecordCreated") });
            } catch (e) {
              pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) });
            }
          }}
        >
          {t("share.startOwnRecord")}
        </Button>
      )}
    </Card>
  );
}

function DecideSheet({ claim, onClose }: { claim: IncomingClaim | null; onClose: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const decide = useDecideClaim();
  const [role, setRole] = useState<"member" | "guest">("guest");

  const act = async (decision: "approve" | "decline") => {
    if (!claim) return;
    // A purchase approval hands a real asset to somebody else and cannot be
    // undone from inside the app, so it gets a second, explicit confirmation
    // that spells out what moves and what does not.
    if (decision === "approve" && claim.kind === "purchase") {
      const ok = await confirm({
        title: t("share.handoverConfirm"),
        message: t("share.handoverConfirmBody"),
        confirmLabel: t("share.handoverConfirmCta"),
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await decide.mutateAsync({ id: claim.id, decision, role });
      onClose();
      pushToast({
        variant: "success",
        title: t(decision === "approve" ? "share.claimApproved" : "share.claimDeclined"),
      });
    } catch (e) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) });
    }
  };

  return (
    <Sheet
      open={!!claim}
      onClose={onClose}
      title={t("share.decideTitle")}
      description={
        claim
          ? t(claim.kind === "purchase" ? "share.decidePurchaseBody" : "share.decideAccessBody", {
              name: claim.bikeNickname,
              who: claim.requesterName || claim.requesterEmail,
            })
          : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {claim?.kind === "access" && <RolePicker value={role} onChange={setRole} />}
        {claim?.kind === "purchase" && (
          <ul className="flex flex-col gap-1.5 rounded-xl bg-surface p-3 text-[12.5px] leading-relaxed dark:bg-surface-elev-dark">
            <li>{t("share.handoverTransfers")}</li>
            <li>{t("share.handoverKeeps")}</li>
          </ul>
        )}
        <Button
          type="button"
          variant={claim?.kind === "purchase" ? "danger" : "accent"}
          disabled={decide.isPending}
          onClick={() => act("approve")}
        >
          {t(claim?.kind === "purchase" ? "share.approveHandover" : "share.approveAccess")}
        </Button>
        <Button type="button" variant="outline" disabled={decide.isPending} onClick={() => act("decline")}>
          {t("share.decline")}
        </Button>
        <p className="text-[12px] leading-relaxed text-muted dark:text-muted-dark">
          {t("share.decideIgnoreNote")}
        </p>
      </div>
    </Sheet>
  );
}
