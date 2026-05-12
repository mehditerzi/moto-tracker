import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";
import { signIn } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";

export function SignInPage() {
  const { t } = useTranslation();
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
    window.location.assign("/dashboard");
  });

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 pl-safe pr-safe pt-safe pb-safe">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center gap-1">
          <BrandMark />
          <p className="label-micro mt-2 text-muted dark:text-muted-dark">
            sigorta · kasko · muayene · bakım
          </p>
        </div>
        <Card className="p-6 sm:p-7">
          <CardHeader>
            <CardTitle className="text-balance text-[26px] tracking-tight">
              {t("auth.welcomeBack")}
            </CardTitle>
            <CardDescription>{t("auth.welcomeBackSub")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <FieldGroup
                id="email"
                label={t("auth.email")}
                error={form.formState.errors.email?.message}
              >
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
              </FieldGroup>
              <FieldGroup
                id="password"
                label={t("auth.password")}
                error={form.formState.errors.password?.message}
              >
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
                    className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:text-muted-dark dark:hover:bg-surface-elev-dark dark:hover:text-text-dark"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FieldGroup>
              <Button type="submit" variant="accent" size="lg" disabled={busy} className="mt-1">
                {t("auth.signIn")}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted dark:text-muted-dark">
              {t("auth.noAccountYet")}{" "}
              <Link
                to="/sign-up"
                className="font-medium text-text underline-offset-4 hover:underline dark:text-text-dark"
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

function FieldGroup({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="label-micro text-muted dark:text-muted-dark">
        {label}
      </Label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
