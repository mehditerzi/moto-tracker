import { Suspense, lazy, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LogOut,
  Settings,
  Bike as BikeIcon,
  Wallet,
  Sparkles,
  Map as MapIcon,
  LayoutDashboard,
  Building2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { useTripTracker } from "@/hooks/useTripTracker";
import { useFleetAccess } from "@/hooks/useOrgs";
import { useFleetDisclosure } from "@/hooks/useFleetDisclosure";
import { withFleetLocale } from "@/lib/fleetLocale";
import { signOut } from "@/lib/authClient";
import { useConfirm } from "@/components/ConfirmSheet";
import { hapticSelection } from "@/lib/haptics";

// Only ever mounted for a member of an organization who has not acknowledged the
// monitoring notice yet, so a consumer never downloads it.
const OrgTripDisclosure = lazy(() =>
  withFleetLocale(() => import("@/components/fleet/OrgTripDisclosure")).then((m) => ({
    default: m.OrgTripDisclosure,
  })),
);

export function AppShell() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const [signingOut, setSigningOut] = useState(false);
  // Fleet chrome renders ONLY for an owner/manager/staff membership. A consumer
  // gets an empty array from /api/orgs and a driver is filtered out of
  // `fleetOrgs`, so neither ever sees a fleet nav entry (docs/fleet-design.md
  // §1, §3). This is the whole gate — there is no feature flag.
  const fleet = useFleetAccess();
  const disclosure = useFleetDisclosure();

  const onSignOut = async () => {
    const confirmed = await confirm({
      title: t("settings.signOutConfirm"),
      confirmLabel: t("settings.signOut"),
      destructive: true,
    });
    if (!confirmed) return;
    setSigningOut(true);
    try {
      await signOut();
      navigate("/sign-in");
    } finally {
      setSigningOut(false);
    }
  };

  // The consumer app is a phone layout at any width. Fleet is not: a dispatch
  // board has to be genuinely good at a desk (§6), so /fleet — and only /fleet —
  // gets the wide container. Consumer routes keep their max-w-3xl exactly.
  const wide = location.pathname === "/fleet" || location.pathname.startsWith("/fleet/");
  const container = wide ? "max-w-[1400px]" : "max-w-3xl";

  // The ride map is the one screen that is not a document: a rider needs the
  // road edge to edge, so /map — and only /map — drops the header and the
  // content column and takes the whole viewport, with its own chrome floating
  // over the map. The tab bar stays (it is the way back), and because there is
  // no header to navigate from at desktop widths it stops being phone-only here.
  const immersive = location.pathname === "/map";

  return (
    <div className={immersive ? "h-dvh overflow-hidden" : "min-h-dvh"}>
      {/* Trip recording is suspended while a monitoring notice is outstanding, so
          the acknowledgement genuinely happens BEFORE the first trip on a
          company vehicle rather than after it. */}
      {!disclosure.pending && <TripTracking />}

      {!immersive && (
      <header className="sticky top-0 z-30 border-b border-border/80 bg-bg/85 backdrop-blur-md dark:border-border-dark/80 dark:bg-bg-dark/75">
        <div className={`mx-auto flex ${container} items-center justify-between gap-2 px-4 pl-safe pr-safe pt-safe pb-3`}>
          <Link
            to="/dashboard"
            className="-m-1 rounded-md p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <BrandMark />
          </Link>
          {me.data && (
            <>
              <nav className="hidden items-center gap-0.5 sm:flex" aria-label={t("nav.primary")}>
                {fleet.canSeeFleet && (
                  <NavIconLink to="/fleet" label={t("nav.fleet")} icon={<Building2 className="h-[18px] w-[18px]" />} />
                )}
                <NavIconLink to="/bikes" label={t("nav.bikes")} icon={<BikeIcon className="h-[18px] w-[18px]" />} />
                <NavIconLink to="/costs" label={t("nav.costs")} icon={<Wallet className="h-[18px] w-[18px]" />} />
                <NavIconLink to="/map" label={t("nav.map")} icon={<MapIcon className="h-[18px] w-[18px]" />} />
                <NavIconLink to="/assistant" label={t("nav.assistant")} icon={<Sparkles className="h-[18px] w-[18px]" />} />
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
              <div className="flex items-center gap-0.5 sm:hidden">
                <NavIconLink to="/settings" label={t("nav.settings")} icon={<Settings className="h-[18px] w-[18px]" />} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("nav.signOut")}
                  onClick={onSignOut}
                  disabled={signingOut}
                  className="h-10 w-10"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                </Button>
              </div>
            </>
          )}
        </div>
      </header>
      )}
      {immersive ? (
        // No motion wrapper: a transform on the ancestor of a live MapKit
        // canvas re-rasterises the whole map for the length of the animation.
        <main className="fixed inset-0 overflow-hidden">
          <Outlet />
        </main>
      ) : (
        // Bottom padding is derived from the tab bar's real height
        // (`--tabbar-clear` in styles.css) rather than a hard-coded `pb-28`,
        // which over-reserved by ~19px and had no way of tracking the bar.
        <main className={`mx-auto ${container} px-4 pl-safe pr-safe pb-[var(--tabbar-clear)] pt-6 sm:pb-16 sm:pt-8`}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      )}
      {me.data && <MobileNav showFleet={fleet.canSeeFleet} alwaysVisible={immersive} />}

      {disclosure.pending && (
        <Suspense fallback={null}>
          <OrgTripDisclosure
            orgName={disclosure.pending.name}
            onAcknowledge={() => disclosure.acknowledge(disclosure.pending!.orgId)}
          />
        </Suspense>
      )}
    </div>
  );
}

/**
 * App-wide GPS trip auto-detection (a no-op unless the user enabled it).
 *
 * It lives in a component rather than a bare hook call so the shell can simply
 * not render it while a monitoring acknowledgement is outstanding — unmounting
 * stops the watch, which is the honest way to say "we are not recording yet".
 */
function TripTracking() {
  useTripTracker();
  return null;
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
  const location = useLocation();
  const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      aria-label={label}
      className={active ? "h-9 w-9 bg-surface-elev dark:bg-surface-elev-dark" : "h-9 w-9"}
    >
      <Link to={to} aria-current={active ? "page" : undefined}>{icon}</Link>
    </Button>
  );
}

/** Screens reached from the Assistant hub — its tab stays lit on them. */
const ASSISTANT_ROUTES = ["/mechanics", "/glovebox", "/warning-lights", "/nearby", "/sos", "/trips", "/groups"];

function MobileNav({
  showFleet,
  alwaysVisible = false,
}: {
  showFleet: boolean;
  /** On the full-screen map there is no header, so the tab bar is the only nav. */
  alwaysVisible?: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const items = [
    { to: "/dashboard", label: t("nav.home"), icon: LayoutDashboard },
    ...(showFleet ? [{ to: "/fleet", label: t("nav.fleet"), icon: Building2 }] : []),
    { to: "/bikes", label: t("nav.bikes"), icon: BikeIcon },
    { to: "/costs", label: t("nav.costs"), icon: Wallet, also: ["/fuel"] },
    { to: "/map", label: t("nav.map"), icon: MapIcon },
    { to: "/assistant", label: t("nav.assistant"), icon: Sparkles, also: ASSISTANT_ROUTES },
  ] as { to: string; label: string; icon: typeof Wallet; also?: string[] }[];

  return (
    // The background is flush to the screen edge (`bottom-0` + viewport-fit=cover
    // + Capacitor `contentInset: "never"`), and `--tabbar-pb` — NOT `pb-safe` —
    // supplies the home-indicator clearance. `pb-safe` reserves the full 34px
    // inset under the touch rows, which is the empty band that reads as a gap
    // between the bar and the bottom of the screen. See styles.css.
    // If `pt-1.5` or `min-h-[52px]` below change, update `--tabbar-h` too.
    <nav
      aria-label={t("nav.primary")}
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-bg/90 px-safe pb-[var(--tabbar-pb)] backdrop-blur-xl dark:border-border-dark/80 dark:bg-bg-dark/90 ${
        alwaysVisible ? "" : "sm:hidden"
      }`}
    >
      <div
        className={`mx-auto grid max-w-md px-2 pt-1.5 ${showFleet ? "grid-cols-6" : "grid-cols-5"}`}
      >
        {items.map(({ to, label, icon: Icon, also }) => {
          const active = [to, ...(also ?? [])].some(
            (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
          );
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (!active) hapticSelection();
              }}
              className={`relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-95 ${
                active
                  ? "text-text dark:text-text-dark"
                  : "text-muted dark:text-muted-dark"
              }`}
            >
              {/* One indicator that slides between tabs instead of one per tab
                  blinking on and off — the bar reads as a single control. */}
              {active && (
                <motion.span
                  layoutId="tab-indicator"
                  aria-hidden
                  className="absolute top-0 h-[3px] w-7 rounded-full bg-accent-dim dark:bg-accent"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              <motion.span
                key={active ? "on" : "off"}
                initial={active ? { scale: 0.8, y: 2 } : false}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 600, damping: 18 }}
              >
                <Icon className={`h-5 w-5 ${active ? "text-accent-dim dark:text-accent" : ""}`} strokeWidth={active ? 2.3 : 1.8} />
              </motion.span>
              <span className="max-w-full truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
