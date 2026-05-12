import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogOut, Settings, Bike as BikeIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { signOut } from "@/lib/authClient";

export function AppShell() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();

  const onSignOut = async () => {
    await signOut();
    navigate("/sign-in");
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur-md dark:border-border-dark dark:bg-bg-dark/75">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 pl-safe pr-safe pt-safe pb-3">
          <Link
            to="/dashboard"
            className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <BrandMark />
          </Link>
          {me.data && (
            <nav className="flex items-center gap-1">
              <Button asChild variant="ghost" size="icon" aria-label={t("nav.bikes")}>
                <Link to="/bikes">
                  <BikeIcon className="h-5 w-5" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="icon" aria-label={t("nav.settings")}>
                <Link to="/settings">
                  <Settings className="h-5 w-5" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("nav.signOut")}
                onClick={onSignOut}
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pl-safe pr-safe pb-12 pt-6">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
