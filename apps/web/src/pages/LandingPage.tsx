import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Eye, EyeOff, ScanLine, Bell, Wrench, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";
import { signIn, signUp } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";

interface Props {
  mode: "signin" | "signup";
}

const FEATURES = [
  { Icon: ScanLine, key: "scan" },
  { Icon: Bell,     key: "remind" },
  { Icon: Wrench,   key: "maintain" },
  { Icon: Gauge,    key: "km" },
] as const;

export function LandingPage({ mode }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-bg dark:bg-bg-dark">
      {/* ── nav ── */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 pb-3 pl-safe pr-safe pt-safe">
        <BrandMark />
      </header>

      {/* ── two-column layout ── */}
      <main className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-6 pb-20 pt-6 pl-safe pr-safe lg:grid-cols-2 lg:items-start lg:gap-14 lg:pt-12">

        {/* ── LEFT: hero + features ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex flex-col gap-8"
        >
          {/* hero */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {(["sigorta", "kasko", "muayene", "bakım"] as const).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-micro text-muted dark:border-border-dark dark:text-muted-dark"
                >
                  {tag}
                </span>
              ))}
            </div>

            <h1 className="text-balance text-[30px] font-semibold leading-[1.15] tracking-tight sm:text-[38px]">
              {t("landing.headline")}
            </h1>

            <p className="max-w-prose text-[15px] leading-relaxed text-muted dark:text-muted-dark">
              {t("landing.sub")}
            </p>
          </div>

          {/* feature grid */}
          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map(({ Icon, key }, i) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.08 + i * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
                className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-4 dark:border-border-dark dark:bg-surface-dark"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15">
                  <Icon className="h-4 w-4 text-accent-dim" />
                </div>
                <p className="text-sm font-semibold leading-snug">
                  {t(`landing.features.${key}`)}
                </p>
                <p className="text-xs leading-relaxed text-muted dark:text-muted-dark">
                  {t(`landing.features.${key}Sub`)}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ── RIGHT: auth card ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
          className="lg:sticky lg:top-10"
        >
          <Card className="overflow-hidden">
            {/* tab switcher */}
            <div className="grid grid-cols-2 gap-1 bg-surface-elev p-1 dark:bg-surface-elev-dark">
              <TabBtn
                label={t("auth.signIn")}
                active={mode === "signin"}
                onClick={() => navigate("/sign-in")}
              />
              <TabBtn
                label={t("auth.signUp")}
                active={mode === "signup"}
                onClick={() => navigate("/sign-up")}
              />
            </div>

            <CardContent className="p-6">
              {mode === "signin" ? <SignInForm /> : <SignUpForm />}
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}

// ─── tab button ──────────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl py-2 text-[13px] font-medium transition ${
        active
          ? "bg-surface shadow-card text-text dark:bg-surface-dark dark:text-text-dark"
          : "text-muted dark:text-muted-dark"
      }`}
    >
      {label}
    </button>
  );
}

// ─── sign-in form ────────────────────────────────────────────────────────────

function SignInForm() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const schema = z.object({
    email: z.string().email(t("auth.emailRequired")),
    password: z.string().min(8, t("auth.passwordTooShort")),
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (v) => {
    setBusy(true);
    const res = await signIn.email({ email: v.email, password: v.password });
    if (res.error) {
      setBusy(false);
      pushToast({ variant: "danger", title: t("auth.signInFailed"), description: res.error.message });
      return;
    }
    window.location.assign("/dashboard");
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field id="si-email" label={t("auth.email")} error={form.formState.errors.email?.message}>
        <Input
          id="si-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ornek@mail.com"
          {...form.register("email")}
        />
      </Field>

      <Field id="si-pw" label={t("auth.password")} error={form.formState.errors.password?.message}>
        <PasswordInput
          id="si-pw"
          autoComplete="current-password"
          show={showPw}
          onToggle={() => setShowPw((v) => !v)}
          toggleLabel={showPw ? t("auth.hidePassword") : t("auth.showPassword")}
          {...form.register("password")}
        />
      </Field>

      <Button type="submit" variant="accent" size="lg" disabled={busy} className="mt-1 shadow-ignite">
        {t("auth.signIn")}
      </Button>
    </form>
  );
}

// ─── sign-up form ────────────────────────────────────────────────────────────

function SignUpForm() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const schema = z.object({
    name: z.string().min(1, t("auth.nameRequired")),
    email: z.string().email(t("auth.emailRequired")),
    password: z.string().min(8, t("auth.passwordTooShort")),
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (v) => {
    setBusy(true);
    const res = await signUp.email({ email: v.email, password: v.password, name: v.name });
    if (res.error) {
      setBusy(false);
      pushToast({ variant: "danger", title: t("auth.signUpFailed"), description: res.error.message });
      return;
    }
    window.location.assign("/dashboard");
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field id="su-name" label={t("auth.name")} error={form.formState.errors.name?.message}>
        <Input id="su-name" autoComplete="name" autoCapitalize="words" {...form.register("name")} />
      </Field>

      <Field id="su-email" label={t("auth.email")} error={form.formState.errors.email?.message}>
        <Input
          id="su-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ornek@mail.com"
          {...form.register("email")}
        />
      </Field>

      <Field id="su-pw" label={t("auth.password")} error={form.formState.errors.password?.message}>
        <PasswordInput
          id="su-pw"
          autoComplete="new-password"
          show={showPw}
          onToggle={() => setShowPw((v) => !v)}
          toggleLabel={showPw ? t("auth.hidePassword") : t("auth.showPassword")}
          {...form.register("password")}
        />
      </Field>

      <Button type="submit" variant="accent" size="lg" disabled={busy} className="mt-1 shadow-ignite">
        {t("auth.signUp")}
      </Button>
    </form>
  );
}

// ─── shared primitives ───────────────────────────────────────────────────────

function Field({
  id, label, error, children,
}: {
  id: string; label: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="label-micro text-muted dark:text-muted-dark">{label}</Label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

const PasswordInput = ({
  id, autoComplete, show, onToggle, toggleLabel, ...rest
}: {
  id: string;
  autoComplete: string;
  show: boolean;
  onToggle: () => void;
  toggleLabel: string;
} & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className="relative">
    <Input id={id} type={show ? "text" : "password"} autoComplete={autoComplete} className="pr-11" {...rest} />
    <button
      type="button"
      onClick={onToggle}
      aria-label={toggleLabel}
      className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:text-muted-dark dark:hover:bg-surface-elev-dark dark:hover:text-text-dark"
    >
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  </div>
);
