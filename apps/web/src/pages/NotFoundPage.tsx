import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    // Rendered as a standalone route (no AppShell), so it carries its own safe
    // areas — otherwise the copy sat under the notch on a cold deep link.
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 pb-safe pl-safe pr-safe pt-safe text-center">
      <h1 className="text-balance text-2xl font-semibold tracking-tight">
        {t("notFound.title")}
      </h1>
      <p className="text-pretty text-sm text-muted dark:text-muted-dark">{t("notFound.sub")}</p>
      <Button asChild variant="accent">
        <Link to="/dashboard">{t("notFound.home")}</Link>
      </Button>
    </div>
  );
}
