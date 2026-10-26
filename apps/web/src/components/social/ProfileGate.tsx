import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, ShieldCheck } from "lucide-react";
import { HANDLE_RE } from "@mototracker/shared";
import { Sheet } from "@/components/share/ShareSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { useMyProfile, useSaveProfile } from "@/hooks/useSocial";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { hapticSuccess } from "@/lib/haptics";
import { track } from "@/lib/telemetry";

/**
 * Social actions (follow, post, Gaz!, comment) need a rider profile with the
 * community rules accepted — the opt-in, and App Review 1.2's agreement step.
 * `requireProfile(action)` runs the action at once when the profile exists;
 * otherwise it opens a two-field sheet and runs it right after.
 */
type Gate = (action?: () => void) => void;
const GateContext = createContext<Gate | null>(null);

export function useProfileGate(): Gate {
  const ctx = useContext(GateContext);
  if (!ctx) throw new Error("useProfileGate must be used within <ProfileGateProvider>");
  return ctx;
}

export function ProfileGateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const me = useMyProfile();
  const ready = !!me.data?.profile?.rulesAccepted;

  const gate = useCallback<Gate>(
    (action) => {
      if (ready) {
        action?.();
        return;
      }
      pending.current = action ?? null;
      setOpen(true);
    },
    [ready],
  );

  return (
    <GateContext.Provider value={gate}>
      {children}
      <ProfileSetupSheet
        open={open}
        onClose={() => {
          setOpen(false);
          pending.current = null;
        }}
        onDone={() => {
          setOpen(false);
          const run = pending.current;
          pending.current = null;
          run?.();
        }}
      />
    </GateContext.Provider>
  );
}

export function ProfileSetupSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const me = useMyProfile();
  const save = useSaveProfile();
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [rules, setRules] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && me.data) {
      setHandle(me.data.profile?.handle ?? me.data.suggestedHandle);
      setName(me.data.profile?.displayName ?? me.data.suggestedName);
      setRules(false);
      setError(null);
    }
  }, [open, me.data]);

  const cleanHandle = handle.trim().toLowerCase().replace(/^@/, "");
  const valid = HANDLE_RE.test(cleanHandle) && name.trim().length >= 2 && rules;

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        handle: cleanHandle,
        displayName: name.trim(),
        bio: me.data?.profile?.bio ?? null,
        city: me.data?.profile?.city ?? null,
        showGarage: me.data?.profile?.showGarage ?? true,
        acceptRules: true,
      });
      hapticSuccess();
      track("social_profile_created");
      onDone();
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | undefined)?.error : null;
      setError(
        code === "handle_taken"
          ? t("social.setup.handleTaken")
          : code === "objectionable"
            ? t("social.objectionable")
            : t("errors.generic"),
      );
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("social.setup.title")} description={t("social.setup.subtitle")}>
      <Field label={t("social.setup.name")}>
        <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <Field label={t("social.setup.handle")} description={t("social.setup.handleHint")} error={handle && !HANDLE_RE.test(cleanHandle) ? t("social.setup.handleInvalid") : undefined}>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted dark:text-muted-dark">@</span>
          <Input
            value={handle}
            maxLength={20}
            className="pl-8"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))}
          />
        </div>
      </Field>

      <div className="rounded-2xl border border-border bg-surface p-4 dark:border-border-dark dark:bg-surface-elev-dark">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <ShieldCheck className="h-4 w-4 text-accent-dim dark:text-accent" /> {t("social.rules.title")}
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted dark:text-muted-dark">
          {(t("social.rules.items", { returnObjects: true }) as string[]).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <button
          type="button"
          role="checkbox"
          aria-checked={rules}
          onClick={() => setRules((v) => !v)}
          className="mt-3 flex min-h-[44px] w-full items-center gap-3 text-left text-[13.5px] font-medium"
        >
          <span
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition",
              rules ? "border-transparent bg-accent text-black" : "border-border dark:border-border-dark",
            )}
          >
            {rules && <Check className="h-4 w-4" />}
          </span>
          {t("social.rules.accept")}
        </button>
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}
      <Button size="lg" variant="accent" className="w-full" disabled={!valid || save.isPending} onClick={() => void submit()}>
        {save.isPending ? t("common.saving") : t("social.setup.cta")}
      </Button>
    </Sheet>
  );
}
