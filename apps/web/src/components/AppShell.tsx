import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { signOut } from "@/lib/authClient";

export function AppShell() {
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur dark:border-border-dark dark:bg-bg-dark/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="flex items-center gap-3">
            <BrandMark />
          </Link>
          {me.data && (
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link to="/bikes">Motosikletler</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await signOut();
                  navigate("/sign-in");
                }}
              >
                <LogOut className="h-4 w-4" /> Çıkış
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
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
