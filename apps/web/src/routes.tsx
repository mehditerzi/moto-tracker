import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AppShell } from "@/components/AppShell";
import { SignInPage } from "@/pages/SignInPage";
import { SignUpPage } from "@/pages/SignUpPage";
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
import { useSession } from "@/lib/authClient";
import { Toaster } from "@/components/ui/toaster";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  if (isPending) return <p className="text-center text-muted dark:text-muted-dark">...</p>;
  if (!data) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: "/sign-in", element: <SignInPage /> },
  { path: "/sign-up", element: <SignUpPage /> },
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
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

export function Routes() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}
