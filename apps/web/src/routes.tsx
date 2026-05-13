import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AppShell } from "@/components/AppShell";
import { LandingPage } from "@/pages/LandingPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { MagicLinkSentPage } from "@/pages/MagicLinkSentPage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { BikesPage } from "@/pages/BikesPage";
import { BikeFormPage } from "@/pages/BikeFormPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DatedItemFormPage } from "@/pages/DatedItemFormPage";
import { DatedItemDetailPage } from "@/pages/DatedItemDetailPage";
import { DocumentCapturePage } from "@/pages/DocumentCapturePage";
import { DocumentReviewPage } from "@/pages/DocumentReviewPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { MaintenanceFormPage } from "@/pages/MaintenanceFormPage";
import { useMe } from "@/hooks/useMe";
import { Toaster } from "@/components/ui/toaster";
import { InstallBanner } from "@/components/InstallBanner";

function RequireAuth({ children }: { children: React.ReactNode }) {
  // Use our own /api/me TanStack Query rather than BetterAuth's useSession —
  // useSession's initial render flashes `data: null, isPending: false` which
  // causes a false redirect before the fetch resolves.
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted dark:text-muted-dark">…</p>
      </div>
    );
  }
  if (me.isError || !me.data) {
    return <Navigate to="/sign-in" replace />;
  }
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: "/sign-in", element: <LandingPage mode="signin" /> },
  { path: "/sign-up", element: <LandingPage mode="signup" /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/magic-link-sent", element: <MagicLinkSentPage /> },
  { path: "/auth/callback", element: <AuthCallbackPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "bikes", element: <BikesPage /> },
      { path: "bikes/new", element: <BikeFormPage /> },
      { path: "bikes/:id/edit", element: <BikeFormPage /> },
      {
        path: "bikes/:bikeId/dated-items/new",
        element: <DatedItemFormPage mode="new" />,
      },
      { path: "dated-items/:id", element: <DatedItemDetailPage /> },
      { path: "dated-items/:id/edit", element: <DatedItemFormPage mode="edit" /> },
      { path: "capture", element: <DocumentCapturePage /> },
      { path: "documents/:id/review", element: <DocumentReviewPage /> },
      { path: "settings", element: <SettingsPage /> },
      {
        path: "bikes/:bikeId/maintenance/new",
        element: <MaintenanceFormPage mode="new" />,
      },
      {
        path: "bikes/:bikeId/maintenance/:id",
        element: <MaintenanceFormPage mode="edit" />,
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

export function Routes() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
      <InstallBanner />
    </QueryClientProvider>
  );
}
