import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** The quiet "← Back" that sits above a sub-page's title. */
export function BackLink({ to, label }: { to: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="-mb-2 -mt-2 flex items-center">
      <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted dark:text-muted-dark">
        <Link to={to}>
          <ArrowLeft className="h-4 w-4" /> {label ?? t("common.back")}
        </Link>
      </Button>
    </div>
  );
}
