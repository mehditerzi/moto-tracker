import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMe } from "@/hooks/useMe";

export function AuthCallbackPage() {
  const { t } = useTranslation();
  const me = useMe();
  useEffect(() => {
    // Hard navigation so the SPA re-mounts with the freshly-set magic-link
    // cookie; soft routing keeps useSession()'s pre-callback `data: null`.
    if (me.isSuccess) window.location.replace("/dashboard");
    if (me.isError) window.location.replace("/sign-in");
  }, [me.isSuccess, me.isError]);
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-center text-muted dark:text-muted-dark">{t("common.loading")}</p>
    </div>
  );
}
