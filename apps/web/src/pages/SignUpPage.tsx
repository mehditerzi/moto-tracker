import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";
import { signUp } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";

export function SignUpPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const schema = z.object({
    name: z.string().min(1, t("auth.nameRequired")),
    email: z.string().email(t("auth.emailRequired")),
    password: z.string().min(8, t("auth.passwordTooShort")),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (v) => {
    setBusy(true);
    const res = await signUp.email({ email: v.email, password: v.password, name: v.name });
    setBusy(false);
    if (res.error) {
      pushToast({
        variant: "danger",
        title: t("auth.signUpFailed"),
        description: res.error.message,
      });
      return;
    }
    navigate("/dashboard");
  });

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
              {t("auth.newAccount")}
            </CardTitle>
            <CardDescription>{t("auth.newAccountSub")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">{t("auth.name")}</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  autoCapitalize="words"
                  {...form.register("name")}
                />
                {form.formState.errors.name && (
                  <p className="text-xs text-danger">{form.formState.errors.name.message}</p>
                )}
              </div>
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
                    autoComplete="new-password"
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
                {t("auth.signUp")}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm text-muted dark:text-muted-dark">
              {t("auth.haveAccount")}{" "}
              <Link
                to="/sign-in"
                className="font-medium text-text underline-offset-2 hover:underline dark:text-text-dark"
              >
                {t("auth.signIn")}
              </Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
