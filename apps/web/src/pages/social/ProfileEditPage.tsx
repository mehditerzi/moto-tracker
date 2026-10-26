import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HANDLE_RE } from "@mototracker/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/BackLink";
import { ProfileSetupSheet } from "@/components/social/ProfileGate";
import { useBlock, useBlocks, useMyProfile, useSaveProfile } from "@/hooks/useSocial";
import { pushToast } from "@/hooks/useToast";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

/** /profile — edit your rider profile; manage blocked people. */
export function ProfileEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMyProfile();
  const save = useSaveProfile();
  const blocks = useBlocks();
  const unblock = useBlock();
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [garage, setGarage] = useState(true);
  const [setup, setSetup] = useState(false);

  useEffect(() => {
    const p = me.data?.profile;
    if (p) {
      setHandle(p.handle);
      setName(p.displayName);
      setBio(p.bio ?? "");
      setCity(p.city ?? "");
      setGarage(p.showGarage);
    }
  }, [me.data]);

  if (me.isLoading) return <Skeleton className="h-80 rounded-2xl" />;
  if (!me.data?.profile?.rulesAccepted) {
    return (
      <div className="flex flex-col gap-5">
        <BackLink to="/settings" />
        <Card className="flex flex-col items-start gap-3 p-5">
          <div className="text-[17px] font-semibold">{t("social.joinTitle")}</div>
          <p className="text-[13.5px] text-muted dark:text-muted-dark">{t("social.joinSub")}</p>
          <Button variant="accent" onClick={() => setSetup(true)}>{t("social.joinCta")}</Button>
        </Card>
        <ProfileSetupSheet open={setup} onClose={() => setSetup(false)} onDone={() => setSetup(false)} />
      </div>
    );
  }

  const clean = handle.trim().toLowerCase().replace(/^@/, "");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save.mutateAsync({ handle: clean, displayName: name.trim(), bio: bio.trim() || null, city: city.trim() || null, showGarage: garage });
      pushToast({ variant: "success", title: t("social.profileSaved") });
      navigate(`/u/${clean}`);
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { error?: string } | undefined)?.error : null;
      pushToast({ variant: "danger", title: code === "handle_taken" ? t("social.setup.handleTaken") : code === "objectionable" ? t("social.objectionable") : t("errors.generic") });
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      <BackLink to={`/u/${me.data.profile.handle}`} />
      <h1 className="text-[26px] font-semibold leading-none tracking-tight">{t("social.editProfile")}</h1>
      <Field label={t("social.setup.name")}>
        <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("social.setup.handle")} error={!HANDLE_RE.test(clean) ? t("social.setup.handleInvalid") : undefined}>
        <Input value={handle} maxLength={20} autoCapitalize="none" autoCorrect="off" onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))} />
      </Field>
      <Field label={t("social.bio")} optional>
        <Textarea value={bio} maxLength={160} rows={2} onChange={(e) => setBio(e.target.value)} placeholder={t("social.bioPlaceholder")} />
      </Field>
      <Field label={t("social.city")} optional>
        <Input value={city} maxLength={40} onChange={(e) => setCity(e.target.value)} />
      </Field>
      <button
        type="button"
        role="switch"
        aria-checked={garage}
        onClick={() => setGarage((v) => !v)}
        className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border border-border px-4 text-left dark:border-border-dark"
      >
        <span>
          <span className="block text-[14px] font-medium">{t("social.showGarage")}</span>
          <span className="block text-[12px] text-muted dark:text-muted-dark">{t("social.showGarageHint")}</span>
        </span>
        <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition", garage ? "bg-accent" : "bg-border dark:bg-border-dark")}>
          <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition", garage ? "translate-x-5" : "translate-x-0.5")} />
        </span>
      </button>
      <Button type="submit" variant="accent" size="lg" disabled={save.isPending || !HANDLE_RE.test(clean) || name.trim().length < 2}>
        {save.isPending ? t("common.saving") : t("common.save")}
      </Button>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">{t("social.blockedPeople")}</h2>
        {!blocks.data?.length ? (
          <p className="text-[13px] text-muted dark:text-muted-dark">{t("social.noBlocked")}</p>
        ) : (
          <Card className="divide-y divide-border p-0 dark:divide-border-dark">
            {blocks.data.map((b) => (
              <div key={b.userId} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="truncate text-[14px]">{b.displayName ?? "—"} {b.handle && <span className="text-muted dark:text-muted-dark">@{b.handle}</span>}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => unblock.mutate({ userId: b.userId, block: false })}>
                  {t("social.unblock")}
                </Button>
              </div>
            ))}
          </Card>
        )}
        <Link to="/support#topluluk" className="text-[13px] text-muted underline-offset-4 hover:underline dark:text-muted-dark" onClick={(e) => { e.preventDefault(); window.open("https://mototracker.mehditerzi.com/support#topluluk", "_blank"); }}>
          {t("social.rules.title")}
        </Link>
      </section>
    </form>
  );
}
