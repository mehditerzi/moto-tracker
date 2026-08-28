import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";

/** How long we sit on "…" before admitting the session check is not coming back. */
const STUCK_MS = 8000;

export function AuthCallbackPage() {
  const { t } = useTranslation();
  const me = useMe();
  useEffect(() => {
    // Hard navigation so the SPA re-mounts with the freshly-set magic-link
    // cookie; soft routing keeps useSession()'s pre-callback `data: null`.
    if (me.isSuccess) window.location.replace("/dashboard");
    if (me.isError) window.location.replace("/sign-in");
  }, [me.isSuccess, me.isError]);

  /**
   * A request that never settles (captive wifi, a dropped connection in a
   * tunnel) resolves neither branch above, and this screen has no chrome of its
   * own — so the user who just tapped a link in their mail app was left staring
   * at a centred "Yükleniyor…" with no tab bar, no back button and nothing to
   * tap. After eight seconds, offer the way out.
   */
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStuck(true), STUCK_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 pb-safe pl-safe pr-safe pt-safe text-center">
      <p className="text-muted dark:text-muted-dark">{t("common.loading")}</p>
      {stuck && (
        <Button asChild variant="outline">
          <Link to="/sign-in">{t("auth.backToSignIn")}</Link>
        </Button>
      )}
    </div>
  );
}
