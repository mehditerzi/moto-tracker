import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

/** The cached session identity. Kept in one place — the 401 handler drops it. */
const ME_KEY = ["me"] as const;

/**
 * A 401 from anywhere means the session died mid-flight: it expired, was
 * revoked from another device, or the native bearer token was cleared.
 *
 * Without this, the user is stranded. The failing screen toasts "your session
 * has ended", but the `me` query stays happily cached, so `RequireAuth` never
 * re-evaluates and nothing redirects — the app just sits there broken until a
 * manual reload.
 *
 * We DROP the cached identity rather than invalidating it: invalidating would
 * refetch `/api/me`, get another 401, and loop. Dropping it makes RequireAuth's
 * next render fall through to its unauthenticated branch and navigate away.
 *
 * The `me` query is excluded so its own 401 (the normal signed-out case, which
 * RequireAuth already handles) can never re-enter this handler.
 */
function handleUnauthorized(error: unknown, queryKey?: readonly unknown[]): void {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  if (queryKey?.[0] === ME_KEY[0]) return;
  queryClient.removeQueries({ queryKey: ME_KEY });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => handleUnauthorized(error, query.queryKey),
  }),
  mutationCache: new MutationCache({
    // Mutations carry no query key of their own — a 401 here is always worth
    // acting on, which is the case the user actually hits (tapping Save on a
    // screen that has been open since the session expired).
    onError: (error) => handleUnauthorized(error),
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});
