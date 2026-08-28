import { useEffect, useState, lazy, Suspense, type ReactNode } from "react";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { registerNativePush } from "@/lib/nativePush";
import { syncPurchasesSilently } from "@/lib/nativeIap";
import { queryClient } from "@/lib/queryClient";
import { withFleetLocale } from "@/lib/fleetLocale";
import { AppShell } from "@/components/AppShell";
import { useMe } from "@/hooks/useMe";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/toaster";
import { InstallBanner } from "@/components/InstallBanner";
import { ConfirmProvider } from "@/components/ConfirmSheet";

// Every page is its own chunk. Statically importing all of them put the map,
// the document scanner and every form into the entry bundle, so opening the
// dashboard downloaded the whole app. React.lazy only accepts a default export,
// hence the `.then` unwrapping of our named page exports.
const LandingPage = lazy(() => import("@/pages/LandingPage").then((m) => ({ default: m.LandingPage })));
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage })));
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })));
const MagicLinkSentPage = lazy(() => import("@/pages/MagicLinkSentPage").then((m) => ({ default: m.MagicLinkSentPage })));
const AuthCallbackPage = lazy(() => import("@/pages/AuthCallbackPage").then((m) => ({ default: m.AuthCallbackPage })));
const BikesPage = lazy(() => import("@/pages/BikesPage").then((m) => ({ default: m.BikesPage })));
const BikeFormPage = lazy(() => import("@/pages/BikeFormPage").then((m) => ({ default: m.BikeFormPage })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const TripsPage = lazy(() => import("@/pages/TripsPage").then((m) => ({ default: m.TripsPage })));
const FuelPage = lazy(() => import("@/pages/FuelPage").then((m) => ({ default: m.FuelPage })));
const MapPage = lazy(() => import("@/pages/MapPage").then((m) => ({ default: m.MapPage })));
const DatedItemFormPage = lazy(() => import("@/pages/DatedItemFormPage").then((m) => ({ default: m.DatedItemFormPage })));
const DatedItemDetailPage = lazy(() => import("@/pages/DatedItemDetailPage").then((m) => ({ default: m.DatedItemDetailPage })));
const DocumentCapturePage = lazy(() => import("@/pages/DocumentCapturePage").then((m) => ({ default: m.DocumentCapturePage })));
const DocumentReviewPage = lazy(() => import("@/pages/DocumentReviewPage").then((m) => ({ default: m.DocumentReviewPage })));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const MaintenanceFormPage = lazy(() => import("@/pages/MaintenanceFormPage").then((m) => ({ default: m.MaintenanceFormPage })));

// Fleet. Split exactly like every other page so none of it reaches a consumer's
// entry bundle — a user with no organization never downloads a byte of it,
// which is the bundle-size half of "fleet is invisible to consumers" (§1). The
// membership gate itself lives in FleetLayout, which is lazy too.
const FleetLayout = lazy(() => withFleetLocale(() => import("@/components/fleet/FleetLayout")).then((m) => ({ default: m.FleetLayout })));
const FleetBoardPage = lazy(() => import("@/pages/fleet/FleetBoardPage").then((m) => ({ default: m.FleetBoardPage })));
const FleetVehiclesPage = lazy(() => import("@/pages/fleet/FleetVehiclesPage").then((m) => ({ default: m.FleetVehiclesPage })));
const FleetVehicleDetailPage = lazy(() => import("@/pages/fleet/FleetVehicleDetailPage").then((m) => ({ default: m.FleetVehicleDetailPage })));
const FleetCostsPage = lazy(() => import("@/pages/fleet/FleetCostsPage").then((m) => ({ default: m.FleetCostsPage })));
const FleetPeoplePage = lazy(() => import("@/pages/fleet/FleetPeoplePage").then((m) => ({ default: m.FleetPeoplePage })));
const FleetCustomersPage = lazy(() => import("@/pages/fleet/FleetCustomersPage").then((m) => ({ default: m.FleetCustomersPage })));
const FleetImportPage = lazy(() => import("@/pages/fleet/FleetImportPage").then((m) => ({ default: m.FleetImportPage })));
// Not a child of FleetLayout (an invitee is not a member yet), so it registers
// the fleet strings itself.
const FleetInvitePage = lazy(() => withFleetLocale(() => import("@/pages/fleet/FleetInvitePage")).then((m) => ({ default: m.FleetInvitePage })));

function RequireAuth({ children }: { children: React.ReactNode }) {
  // Use our own /api/me TanStack Query rather than BetterAuth's useSession —
  // useSession's initial render flashes `data: null, isPending: false` which
  // causes a false redirect before the fetch resolves.
  const me = useMe();
  // Once signed in, register for native APNs push (no-op on web / off-device).
  const authed = !!me.data;
  useEffect(() => {
    if (authed) {
      void registerNativePush();
      // Reconcile App Store subscriptions on launch (native only, silent).
      void syncPurchasesSilently();
    }
  }, [authed]);
  if (me.isPending) {
    return <SessionPending />;
  }
  if (me.isError || !me.data) {
    // Logged-out users always enter through onboarding; its Skip / Get Started
    // lead to /sign-in.
    return <Navigate to="/welcome" replace />;
  }
  return <>{children}</>;
}

/** The app's one full-screen pending treatment, shared by the session check and
 *  by a cold chunk fetch on a standalone (pre-auth) route. */
function FullPagePending() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted dark:text-muted-dark">…</p>
    </div>
  );
}

/** How long the session check may sit silent before we offer a way out. */
const SESSION_STUCK_MS = 8000;

/**
 * The same treatment, plus an escape.
 *
 * `/api/me` has no timeout of its own, so a request that never settles (captive
 * wifi, a dead connection in a tunnel) leaves `isPending` true indefinitely —
 * and this branch renders before AppShell, so there is no header, no tab bar
 * and nothing at all to tap. Force-quitting the app was the only way out.
 */
function SessionPending() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStuck(true), SESSION_STUCK_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 pb-safe pl-safe pr-safe pt-safe text-center">
      <p className="text-sm text-muted dark:text-muted-dark">…</p>
      {stuck && <StuckEscape />}
    </div>
  );
}

/** Split out purely so `useTranslation` is not paid for on every cold start. */
function StuckEscape() {
  const { t } = useTranslation();
  return (
    <Button variant="outline" onClick={() => window.location.reload()}>
      {t("common.retry")}
    </Button>
  );
}

/** Pending treatment for a route rendered inside AppShell: the header and tab
 *  bar stay put, only the content area holds the page's shape. */
function PanePending() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  );
}

const standalone = (element: ReactNode) => (
  <Suspense fallback={<FullPagePending />}>{element}</Suspense>
);
const pane = (element: ReactNode) => <Suspense fallback={<PanePending />}>{element}</Suspense>;

const router = createBrowserRouter([
  { path: "/welcome", element: standalone(<OnboardingPage />) },
  { path: "/sign-in", element: standalone(<LandingPage mode="signin" />) },
  { path: "/sign-up", element: standalone(<LandingPage mode="signup" />) },
  { path: "/forgot-password", element: standalone(<ForgotPasswordPage />) },
  { path: "/reset-password", element: standalone(<ResetPasswordPage />) },
  { path: "/magic-link-sent", element: standalone(<MagicLinkSentPage />) },
  { path: "/auth/callback", element: standalone(<AuthCallbackPage />) },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: pane(<DashboardPage />) },
      { path: "bikes", element: pane(<BikesPage />) },
      { path: "trips", element: pane(<TripsPage />) },
      { path: "fuel", element: pane(<FuelPage />) },
      { path: "map", element: pane(<MapPage />) },
      { path: "bikes/new", element: pane(<BikeFormPage />) },
      { path: "bikes/:id/edit", element: pane(<BikeFormPage />) },
      {
        path: "bikes/:bikeId/dated-items/new",
        element: pane(<DatedItemFormPage mode="new" />),
      },
      { path: "dated-items/:id", element: pane(<DatedItemDetailPage />) },
      { path: "dated-items/:id/edit", element: pane(<DatedItemFormPage mode="edit" />) },
      { path: "capture", element: pane(<DocumentCapturePage />) },
      { path: "documents/:id/review", element: pane(<DocumentReviewPage />) },
      { path: "settings", element: pane(<SettingsPage />) },
      {
        path: "bikes/:bikeId/maintenance/new",
        element: pane(<MaintenanceFormPage mode="new" />),
      },
      {
        path: "bikes/:bikeId/maintenance/:id",
        element: pane(<MaintenanceFormPage mode="edit" />),
      },
      // Declared before the /fleet tree: redeeming an invitation is the one
      // fleet URL whose visitor is deliberately NOT a member yet, so it must not
      // pass through FleetLayout's membership gate. The token arrives in the URL
      // fragment (never a query param — fragments are not sent to any server).
      { path: "fleet/invite", element: pane(<FleetInvitePage />) },
      {
        path: "fleet",
        element: pane(<FleetLayout />),
        children: [
          { index: true, element: pane(<FleetBoardPage />) },
          { path: "vehicles", element: pane(<FleetVehiclesPage />) },
          { path: "vehicles/:id", element: pane(<FleetVehicleDetailPage />) },
          { path: "costs", element: pane(<FleetCostsPage />) },
          { path: "people", element: pane(<FleetPeoplePage />) },
          { path: "customers", element: pane(<FleetCustomersPage />) },
          { path: "import", element: pane(<FleetImportPage />) },
        ],
      },
    ],
  },
  { path: "*", element: standalone(<NotFoundPage />) },
]);

export function Routes() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider
          router={router}
          // Navigations run inside startTransition, so React keeps the page you
          // are on visible while the next page's chunk downloads instead of
          // swapping it for a fallback — those are only seen on a cold start.
          future={{ v7_startTransition: true }}
        />
      </ConfirmProvider>
      <Toaster />
      <InstallBanner />
    </QueryClientProvider>
  );
}
