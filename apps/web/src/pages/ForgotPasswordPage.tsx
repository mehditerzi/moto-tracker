import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";
import { authClient } from "@/lib/authClient";
import { CheckCircle2 } from "lucide-react";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setError(t("auth.emailRequired")); return; }
    setBusy(true);
    setError("");
    const res = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? t("auth.forgotFailed")); return; }
    setSent(true);
  };

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
        </div>

        <Card className="p-6 sm:p-7">
          <CardHeader>
            <CardTitle className="text-[22px] tracking-tight">{t("auth.forgotTitle")}</CardTitle>
            <CardDescription>{t("auth.forgotSub")}</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="h-10 w-10 text-success" />
                <p className="font-medium">{t("auth.forgotSentTitle")}</p>
                <p className="text-sm text-muted dark:text-muted-dark">{t("auth.forgotSentSub")}</p>
                <Button asChild variant="ghost" className="mt-2">
                  <Link to="/sign-in">{t("auth.signIn")}</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email" className="label-micro text-muted dark:text-muted-dark">
                    {t("auth.email")}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="ornek@mail.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  />
                  {error && <p className="text-xs text-danger">{error}</p>}
                </div>

                <Button type="submit" variant="accent" size="lg" disabled={busy}>
                  {t("auth.forgotSend")}
                </Button>

                <p className="text-center text-sm text-muted dark:text-muted-dark">
                  <Link to="/sign-in" className="font-medium text-text underline-offset-4 hover:underline dark:text-text-dark">
                    {t("auth.backToSignIn")}
                  </Link>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
