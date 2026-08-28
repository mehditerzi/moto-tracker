import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/share/ShareSheet";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { useFileClaim } from "@/hooks/useVehicleShares";
import type { DuplicateVehicle } from "@mototracker/shared";

/**
 * "This vehicle is already tracked."
 *
 * The screen a user meets when the chassis or engine number they typed already
 * belongs to a record somewhere in the system. Everything about it is shaped by
 * one constraint: IT MUST NOT SAY WHOSE. Not the name, not the email, not the
 * nickname, not the plate, not whether the holder is a person or a company —
 * because the person reading this screen may have typed a VIN they copied off a
 * windscreen, and the app must not confirm anything about the owner of that car.
 *
 * So the copy says only that the vehicle exists, and offers the two things that
 * are actually useful:
 *
 *   • REQUEST ACCESS — "that is my family's car" → becomes a share if approved.
 *   • I BOUGHT IT    — becomes an ownership handover if approved.
 *
 * Both are requests. Neither takes anything. The current holder decides, and if
 * they never answer, nothing happens to their vehicle at all (the fallback is
 * offered on the claim list three weeks later, and it only ever creates a record
 * of the requester's own).
 */
export function DuplicateVehicleSheet({
  duplicate,
  onClose,
}: {
  duplicate: DuplicateVehicle | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fileClaim = useFileClaim();
  const [kind, setKind] = useState<"access" | "purchase" | null>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const close = () => {
    setKind(null);
    setMessage("");
    setSent(false);
    onClose();
  };

  const submit = async () => {
    if (!duplicate || !kind) return;
    try {
      await fileClaim.mutateAsync({
        claimToken: duplicate.claimToken,
        kind,
        message: message.trim() || undefined,
      });
      setSent(true);
    } catch (e) {
      pushToast({ variant: "danger", title: t("share.claimFailed"), description: friendlyError(e, t) });
    }
  };

  return (
    <Sheet
      open={!!duplicate}
      onClose={close}
      title={t("share.duplicateTitle")}
      description={
        duplicate?.matchedOn === "engine"
          ? t("share.duplicateBodyEngine")
          : t("share.duplicateBodyChassis")
      }
    >
      {sent ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed">{t("share.claimSent")}</p>
          <p className="text-[12.5px] leading-relaxed text-muted dark:text-muted-dark">
            {t("share.claimSentSub")}
          </p>
          <Button type="button" variant="accent" onClick={close}>
            {t("common.done")}
          </Button>
        </div>
      ) : kind ? (
        <div className="flex flex-col gap-4">
          <Field label={t("share.claimMessageLabel")} optional>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={280}
              placeholder={
                kind === "purchase" ? t("share.claimMessageBuy") : t("share.claimMessageAccess")
              }
            />
          </Field>
          <p className="text-[12px] leading-relaxed text-muted dark:text-muted-dark">
            {t("share.claimDisclosure")}
          </p>
          <Button type="button" variant="accent" disabled={fileClaim.isPending} onClick={submit}>
            {t("share.claimSubmit")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setKind(null)}>
            {t("common.back")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <ChoiceCard
            icon={<ShieldQuestion className="h-5 w-5" />}
            title={t("share.choiceAccessTitle")}
            body={t("share.choiceAccessBody")}
            onClick={() => setKind("access")}
          />
          <ChoiceCard
            icon={<KeyRound className="h-5 w-5" />}
            title={t("share.choicePurchaseTitle")}
            body={t("share.choicePurchaseBody")}
            onClick={() => setKind("purchase")}
          />
          <Button type="button" variant="ghost" className="mt-1" onClick={close}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function ChoiceCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-2xl border border-border p-3.5 text-left transition hover:border-text/20 dark:border-border-dark dark:hover:border-text-dark/20"
    >
      <span className="mt-0.5 shrink-0 text-muted dark:text-muted-dark">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted dark:text-muted-dark">
          {body}
        </span>
      </span>
    </button>
  );
}
