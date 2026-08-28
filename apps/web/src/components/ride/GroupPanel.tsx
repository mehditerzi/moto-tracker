import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RiderList } from "@/components/ride/RiderList";
import type { RiderRow } from "@/hooks/useRideRoster";

/**
 * The group, once you are in a ride: who is where, the leader's rally control,
 * and the way out. Every button is 56px — these are the controls most likely to
 * be pressed with a glove on, at the roadside, in a hurry.
 */
export function GroupPanel({
  riders,
  isLeader,
  hasRally,
  onToggleRally,
  onLeave,
  leaving,
}: {
  riders: RiderRow[];
  isLeader: boolean;
  hasRally: boolean;
  onToggleRally: () => void;
  onLeave: () => void;
  leaving: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <RiderList riders={riders} />
      <div className="flex flex-col gap-2">
        {isLeader && (
          <Button
            variant={hasRally ? "outline" : "accent"}
            size="lg"
            className="h-14 w-full"
            onClick={onToggleRally}
          >
            <Users className="h-5 w-5" />
            {hasRally ? t("map.rallyClear") : t("map.rallyAction")}
          </Button>
        )}
        <Button
          variant="outline"
          size="lg"
          className="h-14 w-full"
          onClick={onLeave}
          disabled={leaving}
        >
          <LogOut className="h-5 w-5" />
          {isLeader ? t("map.endRide") : t("map.leaveRide")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Starting or joining a ride. The code field is the one place in this screen
 * that needs typing, so it is oversized, centred and letter-spaced — a six
 * character code read out over an intercom has to be checkable at a glance.
 */
export function GroupJoin({
  onStart,
  starting,
  onJoin,
  joining,
}: {
  onStart: () => void;
  starting: boolean;
  onJoin: (code: string) => void;
  joining: boolean;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 dark:border-border-dark">
      <p className="text-[13px] leading-relaxed text-muted dark:text-muted-dark">
        {t("map.togetherIntro")}
      </p>
      <Button
        variant="accent"
        size="lg"
        className="h-14 w-full"
        disabled={starting}
        onClick={onStart}
      >
        <Users className="h-5 w-5" /> {t("map.startRide")}
      </Button>
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t("map.codePlaceholder")}
          className="num h-14 text-center text-[18px] uppercase tracking-[0.2em]"
          maxLength={8}
          aria-label={t("map.codePlaceholder")}
        />
        <Button
          size="lg"
          className="h-14 px-6"
          disabled={joining || code.trim().length < 4}
          onClick={() => onJoin(code.trim())}
        >
          {t("map.join")}
        </Button>
      </div>
    </div>
  );
}
