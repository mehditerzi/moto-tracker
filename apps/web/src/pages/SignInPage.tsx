import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Eye, EyeOff, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";
import { signIn } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";

export function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const schema = z.object({
    email: z.string().email(t("auth.emailRequired")),
    password: z.string().min(8, t("auth.passwordTooShort")),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (v) => {
    setBusy(true);
    const res = await signIn.email({ email: v.email, password: v.password });
    if (res.error) {
      setBusy(false);
      pushToast({
        variant: "danger",
        title: t("auth.signInFailed"),
        description: res.error.message,
      });
      return;
    }
    // Hard navigation so the SPA re-mounts with the fresh session cookie;
    // useSession()'s cached `data: null` from before sign-in otherwise
    // bounces RequireAuth straight back to /sign-in.
    window.location.assign("/dashboard");
  });

  const onMagic = async () => {
    const email = form.getValues("email");
    if (!email) {
      form.setError("email", { message: t("auth.emailFirst") });
      return;
    }
    setBusy(true);
    const res = await signIn.magicLink({ email, callbackURL: "/auth/callback" });
    setBusy(false);
    if (res.error) {
      pushToast({
        variant: "danger",
        title: t("auth.magicFailed"),
        description: res.error.message,
      });
      return;
    }
    navigate("/magic-link-sent");
  };

  const onGoogle = async () => {
    setBusy(true);
    await signIn.social({ provider: "google", callbackURL: "/auth/callback" });
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 pl-safe pr-safe pt-safe pb-safe">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-6 flex justify-center">
          <BrandMark className="text-lg" />
        </div>
        <Card className="p-6 sm:p-7">
          <CardHeader>
            <CardTitle className="text-balance text-2xl tracking-tight">
              {t("auth.welcomeBack")}
            </CardTitle>
            <CardDescription>{t("auth.welcomeBackSub")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="ornek@mail.com"
                  {...form.register("email")}
                />
                {form.formState.errors.email && (
                  <p className="text-xs text-danger">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="pr-11"
                    {...form.register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted transition hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {form.formState.errors.password && (
                  <p className="text-xs text-danger">{form.formState.errors.password.message}</p>
                )}
              </div>
              <Button type="submit" variant="accent" size="lg" disabled={busy}>
                {t("auth.signIn")}
              </Button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
              <div className="h-px flex-1 bg-border dark:bg-border-dark" />
              {t("auth.or")}
              <div className="h-px flex-1 bg-border dark:bg-border-dark" />
            </div>

            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={onMagic} disabled={busy}>
                <Mail className="h-4 w-4" /> {t("auth.magicLink")}
              </Button>
              <Button variant="outline" onClick={onGoogle} disabled={busy}>
                <GoogleIcon /> {t("auth.google")}
              </Button>
            </div>

            <p className="mt-5 text-center text-sm text-muted dark:text-muted-dark">
              {t("auth.noAccountYet")}{" "}
              <Link
                to="/sign-up"
                className="font-medium text-text underline-offset-2 hover:underline dark:text-text-dark"
              >
                {t("auth.signUp")}
              </Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.61Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.27c-.81.55-1.85.87-3.04.87-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
