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
  Fuel,
  FolderLock,
  Wrench,
  MapPin,
  Siren,
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
  const location = useLocation();
  // Fleet chrome renders ONLY for an owner/manager/staff membership. A consumer
  // gets an empty array from /api/orgs and a driver is filtered out of
  // `fleetOrgs`, so neither ever sees a fleet nav entry (docs/fleet-design.md
  // §1, §3). This is the whole gate — there is no feature flag.
  const fleet = useFleetAccess();
  const disclosure = useFleetDisclosure();

  // Fleet is a desk tool (§6), so /fleet gets the wide column; consumer screens
  // keep a readable one.
  const wide = location.pathname === "/fleet" || location.pathname.startsWith("/fleet/");
  const container = wide ? "max-w-[1400px]" : "max-w-3xl";

  // The ride map is the one screen that is not a document: it takes the whole
  // viewport (beside the sidebar on a tablet), with its own floating chrome.
  const immersive = location.pathname === "/map";

  return (
    <div className={`${immersive ? "h-dvh overflow-hidden" : "min-h-dvh"} md:pl-64`}>
      {/* Trip recording is suspended while a monitoring notice is outstanding, so
          the acknowledgement genuinely happens BEFORE the first trip on a
          company vehicle rather than after it. */}
      {!disclosure.pending && <TripTracking />}

      {me.data && <Sidebar showFleet={fleet.canSeeFleet} />}

      {/* Phone header: brand and Settings only. Signing out lives in Settings —
          a one-tap sign-out in the corner of every screen was a mis-tap waiting
          to happen. */}
      {!immersive && (
        <header className="sticky top-0 z-30 border-b border-border/80 bg-bg/85 backdrop-blur-md dark:border-border-dark/80 dark:bg-bg-dark/75 md:hidden">
          <div className={`mx-auto flex ${container} items-center justify-between gap-2 px-4 pl-safe pr-safe pt-safe pb-3`}>
            <Link
              to="/dashboard"
              className="-m-1 rounded-md p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <BrandMark />
            </Link>
            {me.data && (
              <Link
                to="/settings"
                aria-label={t("nav.settings")}
                className="grid h-10 w-10 place-items-center rounded-full text-text transition active:scale-95 hover:bg-surface dark:text-text-dark dark:hover:bg-surface-elev-dark"
              >
                <Settings className="h-[19px] w-[19px]" />
              </Link>
            )}
          </div>
        </header>
      )}
      {immersive ? (
        // No motion wrapper: a transform on the ancestor of a live MapKit
        // canvas re-rasterises the whole map for the length of the animation.
        <main className="fixed inset-0 overflow-hidden md:left-64">
          <Outlet />
        </main>
      ) : (
        // Bottom padding is derived from the tab bar's real height
        // (`--tabbar-clear` in styles.css); with the sidebar there is no bar.
        <main className={`mx-auto ${container} px-4 pl-safe pr-safe pb-[var(--tabbar-clear)] pt-6 md:px-8 md:pb-16 md:pt-10`}>
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
      {me.data && <MobileNav showFleet={fleet.canSeeFleet} />}

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
 * Tablet / desktop navigation: the iPadOS-style sidebar. Labelled destinations
 * (an icon row with no words is a guessing game on a 13-inch screen), the
 * assistant's tools one tap away, and the account at the foot.
 */
function Sidebar({ showFleet }: { showFleet: boolean }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [signingOut, setSigningOut] = useState(false);
  const primary = [
    { to: "/dashboard", label: t("nav.home"), icon: LayoutDashboard },
    ...(showFleet ? [{ to: "/fleet", label: t("nav.fleet"), icon: Building2 }] : []),
    { to: "/bikes", label: t("nav.bikes"), icon: BikeIcon },
    { to: "/costs", label: t("nav.costs"), icon: Wallet },
    { to: "/map", label: t("nav.map"), icon: MapIcon },
    { to: "/assistant", label: t("nav.assistant"), icon: Sparkles },
  ];
  const tools = [
    { to: "/fuel", label: t("dashboard.action.fuel"), icon: Fuel },
    { to: "/glovebox", label: t("assistant.tools.glovebox.title"), icon: FolderLock },
    { to: "/mechanics", label: t("assistant.tools.mechanics.title"), icon: Wrench },
    { to: "/nearby", label: t("assistant.tools.nearby.title"), icon: MapPin },
    { to: "/sos", label: t("assistant.sos"), icon: Siren },
  ];
  const onSignOut = async () => {
    if (!(await confirm({ title: t("settings.signOutConfirm"), confirmLabel: t("settings.signOut"), destructive: true }))) return;
    setSigningOut(true);
    try {
      await signOut();
      navigate("/sign-in");
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <aside
      aria-label={t("nav.primary")}
      className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border/80 bg-bg/95 px-3 pb-4 pl-[max(0.75rem,env(safe-area-inset-left))] pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur-xl dark:border-border-dark/80 dark:bg-bg-dark/95 md:flex"
    >
      <Link to="/dashboard" className="mb-6 px-3">
        <BrandMark />
      </Link>
      <nav className="flex flex-col gap-0.5">
        {primary.map((i) => (
          <SideLink key={i.to} {...i} />
        ))}
      </nav>
      <div className="mt-6 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
        {t("nav.tools")}
      </div>
      <nav className="flex flex-col gap-0.5">
        {tools.map((i) => (
          <SideLink key={i.to} {...i} small />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3 dark:border-border-dark">
        <SideLink to="/settings" label={t("nav.settings")} icon={Settings} />
        <div className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{me.data?.user.name || me.data?.user.email}</div>
            {me.data?.user.name && (
              <div className="truncate text-[11.5px] text-muted dark:text-muted-dark">{me.data.user.email}</div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("nav.signOut")}
            onClick={() => void onSignOut()}
            disabled={signingOut}
            className="h-9 w-9 shrink-0 text-muted dark:text-muted-dark"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function SideLink({
  to,
  label,
  icon: Icon,
  small = false,
}: {
  to: string;
  label: string;
  icon: typeof Wallet;
  small?: boolean;
}) {
  const location = useLocation();
  const active =
    location.pathname === to ||
    location.pathname.startsWith(`${to}/`) ||
    (to === "/costs" && location.pathname === "/fuel" && !small);
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      onClick={() => {
        if (!active) hapticSelection();
      }}
      className={`relative flex items-center gap-3 rounded-xl px-3 ${small ? "py-2 text-[13.5px]" : "py-2.5 text-[14.5px]"} font-medium transition ${
        active ? "text-text dark:text-text-dark" : "text-muted hover:bg-surface hover:text-text dark:text-muted-dark dark:hover:bg-surface-elev-dark dark:hover:text-text-dark"
      }`}
    >
      {active && (
        <motion.span
          layoutId="side-active"
          aria-hidden
          className="absolute inset-0 rounded-xl bg-surface ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <Icon className={`relative ${small ? "h-4 w-4" : "h-[18px] w-[18px]"} ${active ? "text-accent-dim dark:text-accent" : ""}`} />
      <span className="relative truncate">{label}</span>
    </Link>
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

/** Screens reached from the Assistant hub — its tab stays lit on them. */
const ASSISTANT_ROUTES = ["/mechanics", "/glovebox", "/warning-lights", "/nearby", "/sos", "/trips", "/groups"];

function MobileNav({ showFleet }: { showFleet: boolean }) {
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-bg/90 px-safe pb-[var(--tabbar-pb)] backdrop-blur-xl dark:border-border-dark/80 dark:bg-bg-dark/90 md:hidden"
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
