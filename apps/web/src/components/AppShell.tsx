import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogOut, Settings, Bike as BikeIcon, Navigation } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { useTripTracker } from "@/hooks/useTripTracker";
import { signOut } from "@/lib/authClient";

export function AppShell() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  // App-wide GPS trip auto-detection (no-op unless the user enabled it).
  useTripTracker();

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate("/sign-in");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-bg/85 backdrop-blur-md dark:border-border-dark/80 dark:bg-bg-dark/75">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 pl-safe pr-safe pt-safe pb-3">
          <Link
            to="/dashboard"
            className="-m-1 rounded-md p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <BrandMark />
          </Link>
          {me.data && (
            <nav className="flex items-center gap-0.5">
              <NavIconLink to="/bikes" label={t("nav.bikes")} icon={<BikeIcon className="h-[18px] w-[18px]" />} />
              <NavIconLink to="/trips" label={t("nav.trips")} icon={<Navigation className="h-[18px] w-[18px]" />} />
              <NavIconLink to="/settings" label={t("nav.settings")} icon={<Settings className="h-[18px] w-[18px]" />} />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("nav.signOut")}
                onClick={onSignOut}
                disabled={signingOut}
                className="h-9 w-9"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </Button>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pl-safe pr-safe pb-16 pt-6 sm:pt-8">
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

function NavIconLink({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Button asChild variant="ghost" size="icon" aria-label={label} className="h-9 w-9">
      <Link to={to}>{icon}</Link>
    </Button>
  );
}
