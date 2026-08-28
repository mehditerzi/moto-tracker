import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { BrandMark } from "@/components/BrandMark";

export function MagicLinkSentPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 pl-safe pr-safe pt-safe pb-safe">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <Card className="p-6 sm:p-7">
          <CardHeader>
            <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent ring-1 ring-accent/30">
              <Mail className="h-5 w-5" strokeWidth={2} />
            </div>
            <CardTitle className="text-balance text-[24px] tracking-tight">
              {t("auth.magicSent")}
            </CardTitle>
            <CardDescription>{t("auth.magicSentSub")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted dark:text-muted-dark">{t("auth.magicSentBody")}</p>
            {/* Terminal screen with no navigation of its own: if the mail never
                arrives, or the address was wrong, this is the only way out. */}
            <Button asChild variant="outline" className="mt-1">
              <Link to="/sign-in">{t("auth.backToSignIn")}</Link>
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
