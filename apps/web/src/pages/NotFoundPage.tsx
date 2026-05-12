import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
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
