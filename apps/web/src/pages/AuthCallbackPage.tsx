import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMe } from "@/hooks/useMe";

export function AuthCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  useEffect(() => {
    if (me.isSuccess) navigate("/dashboard", { replace: true });
    if (me.isError) navigate("/sign-in", { replace: true });
  }, [me.isSuccess, me.isError, navigate]);
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-center text-muted dark:text-muted-dark">{t("common.loading")}</p>
    </div>
  );
}
