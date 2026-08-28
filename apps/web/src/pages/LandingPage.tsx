import { useState, forwardRef } from "react";
// A raw <a> to /forgot-password used to hard-reload the SPA — on the Capacitor
// wrap that means re-bootstrapping the entire app to reach one form.
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Eye, EyeOff, Apple, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field as UiField, type FieldProps } from "@/components/ui/field";
import { BrandMark } from "@/components/BrandMark";
import { signIn, signUp } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";
import { usePublicConfig } from "@/hooks/usePublicConfig";

/** Minimal shape of the translator we need — mirrors lib/apiError.ts. */
type Translate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * BetterAuth answers with English server messages ("Invalid email or password"),
 * which are both the wrong language and the wrong register for a Turkish-first
 * app. Map the codes we can and fall back to our own generic copy — never to an
 * empty description, which is exactly what an offline submit used to produce.
 */
function authErrorMessage(error: { code?: string; message?: string } | undefined, t: Translate): string {
  switch (error?.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return t("auth.invalidCredentials");
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return t("auth.emailTaken");
    case "PASSWORD_TOO_SHORT":
      return t("auth.passwordTooShort");
    default:
      return error?.message || t("errors.generic");
  }
}

function SocialButtons() {
  const { t } = useTranslation();
  const cfg = usePublicConfig();
  // The OAuth hand-off is a full-page navigation that can take a beat to start.
  // Without this the button looked inert and invited a second tap.
  const [pending, setPending] = useState<"apple" | "google" | null>(null);
  if (!cfg.data?.appleSignIn && !cfg.data?.googleSignIn) return null;
  const go = (provider: "apple" | "google") => {
    setPending(provider);
    void signIn
      .social({ provider, callbackURL: `${window.location.origin}/dashboard` })
      .catch(() => setPending(null));
  };
  return (
    <div className="mt-5 flex flex-col gap-2">
      <div className="my-1 flex items-center gap-3">
        <span className="h-px flex-1 bg-border dark:bg-border-dark" />
        <span className="text-[11px] uppercase tracking-wider text-muted dark:text-muted-dark">
          {t("auth.or")}
        </span>
        <span className="h-px flex-1 bg-border dark:bg-border-dark" />
      </div>
      {cfg.data.appleSignIn && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => go("apple")}
          disabled={pending !== null}
        >
          <Apple className="h-4 w-4" /> {t("auth.continueApple")}
        </Button>
      )}
      {cfg.data.googleSignIn && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => go("google")}
          disabled={pending !== null}
        >
          {t("auth.continueGoogle")}
        </Button>
      )}
    </div>
  );
}

interface Props {
  mode: "signin" | "signup";
}

export function LandingPage({ mode }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-bg dark:bg-bg-dark">
      {/* Ignition glow — the one splash of colour, like an LED behind the cluster */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55dvh] [mask-image:radial-gradient(75%_60%_at_50%_0%,#000,transparent)]"
      >
        <div className="absolute left-1/2 top-[-20%] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[110px] dark:bg-accent/20" />
      </div>
      {/* Hairline grid for instrument-cluster depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 text-border-strong opacity-[0.06] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:38px_38px] [mask-image:radial-gradient(80%_50%_at_50%_0%,#000,transparent)] dark:text-border"
      />

      <main className="relative mx-auto flex h-[100dvh] max-w-md flex-col justify-center gap-8 px-6 pb-10 pl-safe pr-safe pt-safe">
        {/* ── compact brand header ── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex flex-col items-center gap-3 text-center"
        >
          <div className="relative">
            <div aria-hidden className="absolute inset-0 -z-10 rounded-[1.4rem] bg-accent/30 blur-2xl" />
            <div className="grid h-[68px] w-[68px] place-items-center rounded-[1.4rem] border border-border bg-surface text-text shadow-card dark:border-border-dark dark:bg-surface-dark dark:text-text-dark">
              <BrandMark showWordmark={false} className="[&>svg]:h-9 [&>svg]:w-auto" />
            </div>
          </div>
          <span className="text-[13px] font-semibold uppercase tracking-micro text-muted dark:text-muted-dark">
            Garajım
          </span>
        </motion.div>

        {/* ── auth ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, delay: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 gap-1 bg-surface-elev p-1 dark:bg-surface-elev-dark">
              <TabBtn label={t("auth.signIn")} active={mode === "signin"} onClick={() => navigate("/sign-in")} />
              <TabBtn label={t("auth.signUp")} active={mode === "signup"} onClick={() => navigate("/sign-up")} />
            </div>
            <CardContent className="p-6">
              {mode === "signin" ? <SignInForm /> : <SignUpForm />}
              <SocialButtons />
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
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const schema = z.object({
    email: z.string().email(t("auth.emailRequired")),
    password: z.string().min(8, t("auth.passwordTooShort")),
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  // A rejected call (offline, DNS, a throw inside the auth client) used to skip
  // every `setBusy(false)` below, leaving the button disabled for good with
  // nothing on screen to explain it — a reload was the only way out.
  const onSubmit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const res = await signIn.email({ email: v.email, password: v.password });
      if (res.error) {
        setBusy(false);
        pushToast({
          variant: "danger",
          title: t("auth.signInFailed"),
          description: authErrorMessage(res.error, t),
        });
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setBusy(false);
      pushToast({
        variant: "danger",
        title: t("auth.signInFailed"),
        description: t("errors.generic"),
      });
    }
  });

  /**
   * Passwordless sign-in. The magic-link plugin is wired end to end — server
   * plugin, client plugin, the /magic-link-sent screen and its copy — but until
   * now nothing in the UI could trigger it, so the whole path was unreachable.
   * It reuses the email already typed above and the field's own validation, so
   * a bad address is reported under the input instead of in a toast.
   */
  const onMagicLink = async () => {
    if (!(await form.trigger("email"))) return;
    setMagicBusy(true);
    try {
      const res = await signIn.magicLink({
        email: form.getValues("email"),
        callbackURL: `${window.location.origin}/dashboard`,
      });
      if (res.error) {
        pushToast({
          variant: "danger",
          title: t("auth.magicFailed"),
          description: authErrorMessage(res.error, t),
        });
        return;
      }
      navigate("/magic-link-sent");
    } catch {
      pushToast({
        variant: "danger",
        title: t("auth.magicFailed"),
        description: t("errors.generic"),
      });
    } finally {
      // Also gates the submit button above — leaking `true` disabled both.
      setMagicBusy(false);
    }
  };

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

      <Button
        type="submit"
        variant="accent"
        size="lg"
        disabled={busy || magicBusy}
        className="mt-1 shadow-ignite"
      >
        {t("auth.signIn")}
      </Button>

      <Button
        type="button"
        variant="ghost"
        onClick={() => void onMagicLink()}
        disabled={busy || magicBusy}
        className="text-muted dark:text-muted-dark"
      >
        <Mail className="h-4 w-4" /> {t("auth.magicLink")}
      </Button>

      <p className="text-center text-sm">
        <Link to="/forgot-password" className="text-muted underline-offset-4 hover:underline dark:text-muted-dark">
          {t("auth.forgotPassword")}
        </Link>
      </p>
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
    try {
      const res = await signUp.email({ email: v.email, password: v.password, name: v.name });
      if (res.error) {
        setBusy(false);
        pushToast({
          variant: "danger",
          title: t("auth.signUpFailed"),
          description: authErrorMessage(res.error, t),
        });
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setBusy(false);
      pushToast({
        variant: "danger",
        title: t("auth.signUpFailed"),
        description: t("errors.generic"),
      });
    }
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

/** The shared Field in this screen's micro-caps label treatment. All the aria
 *  wiring (invalid state, error announcement) comes from the shared one. */
function Field(props: Omit<FieldProps, "labelClassName">) {
  return <UiField {...props} labelClassName="label-micro text-muted dark:text-muted-dark" />;
}

const PasswordInput = forwardRef<HTMLInputElement, {
  id: string;
  autoComplete: string;
  show: boolean;
  onToggle: () => void;
  toggleLabel: string;
} & React.InputHTMLAttributes<HTMLInputElement>>(
  ({ id, autoComplete, show, onToggle, toggleLabel, ...rest }, ref) => (
    <div className="relative">
      <Input ref={ref} id={id} type={show ? "text" : "password"} autoComplete={autoComplete} className="pr-11" {...rest} />
      <button
        type="button"
        onClick={onToggle}
        aria-label={toggleLabel}
        className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:text-muted-dark dark:hover:bg-surface-elev-dark dark:hover:text-text-dark"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  ),
);
