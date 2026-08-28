import { useState, forwardRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";
import { authClient } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";

const ERROR_ID = "reset-error";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!token) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <p className="text-center text-muted dark:text-muted-dark">{t("auth.resetInvalidLink")}</p>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError(t("auth.passwordTooShort")); return; }
    if (password !== confirm) { setError(t("auth.passwordMismatch")); return; }
    setBusy(true);
    setError("");
    const res = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? t("auth.resetFailed")); return; }
    pushToast({ variant: "success", title: t("auth.resetSuccess") });
    navigate("/sign-in");
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
            <CardTitle className="text-[22px] tracking-tight">{t("auth.resetTitle")}</CardTitle>
            <CardDescription>{t("auth.resetSub")}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Validation here is about the pair of fields (too short / mismatch),
                so the one message is described by both inputs rather than sitting
                under either of them. */}
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw" className="label-micro text-muted dark:text-muted-dark">
                  {t("auth.newPassword")}
                </Label>
                <PwInput
                  id="pw"
                  autoComplete="new-password"
                  show={showPw}
                  onToggle={() => setShowPw((v) => !v)}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? ERROR_ID : undefined}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm" className="label-micro text-muted dark:text-muted-dark">
                  {t("auth.confirmPassword")}
                </Label>
                <Input
                  id="confirm"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? ERROR_ID : undefined}
                />
              </div>

              {error && (
                <p id={ERROR_ID} role="alert" className="text-xs text-danger">
                  {error}
                </p>
              )}

              <Button type="submit" variant="accent" size="lg" disabled={busy} className="shadow-ignite">
                {t("auth.resetSave")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

const PwInput = forwardRef<HTMLInputElement, {
  id: string; autoComplete: string; show: boolean; onToggle: () => void;
} & React.InputHTMLAttributes<HTMLInputElement>>(
  ({ id, autoComplete, show, onToggle, ...rest }, ref) => (
    <div className="relative">
      <Input ref={ref} id={id} type={show ? "text" : "password"} autoComplete={autoComplete} className="pr-11" {...rest} />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-text dark:text-muted-dark dark:hover:bg-surface-elev-dark dark:hover:text-text-dark"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  ),
);
