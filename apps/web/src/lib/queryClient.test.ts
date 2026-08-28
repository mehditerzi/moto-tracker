import { describe, it, expect, beforeEach } from "vitest";
import { queryClient } from "./queryClient";
import { ApiError } from "./api";

/**
 * A 401 mid-session used to strand the user: the screen toasted "your session
 * has ended" but the cached `me` survived, so RequireAuth never re-evaluated
 * and nothing redirected. These cover the drop, and — just as important — that
 * the handler cannot put `/api/me` into a refetch/401 loop.
 */

const FAKE_ME = { user: { id: "u1" } };

/** Drive a failing query through the cache so the real onError hook runs. */
async function failQuery(queryKey: unknown[], error: unknown): Promise<void> {
  await queryClient
    .fetchQuery({
      queryKey,
      queryFn: async () => {
        throw error;
      },
      retry: false,
      // The client's default staleTime is 10s, so without this fetchQuery would
      // hand back the data seeded in beforeEach and never call queryFn at all.
      staleTime: 0,
    })
    .catch(() => {
      /* expected */
    });
}

describe("queryClient 401 handling", () => {
  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(["me"], FAKE_ME);
  });

  it("drops the cached session when any other request 401s", async () => {
    await failQuery(["bikes"], new ApiError(401, "GET /api/bikes failed (401)"));
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
  });

  it("leaves the session alone for non-401 failures", async () => {
    await failQuery(["bikes"], new ApiError(500, "boom"));
    expect(queryClient.getQueryData(["me"])).toEqual(FAKE_ME);

    await failQuery(["trips"], new Error("network down"));
    expect(queryClient.getQueryData(["me"])).toEqual(FAKE_ME);
  });

  it("does not re-enter on the me query's own 401 (loop guard)", async () => {
    // RequireAuth already handles this case. If the handler acted here it would
    // remove → refetch → 401 → remove, forever.
    await failQuery(["me"], new ApiError(401, "GET /api/me failed (401)"));
    // Without the guard this 401 would have called removeQueries(["me"]) and
    // wiped the entry — the same call the first test asserts. That it survived
    // is the proof the handler declined to act on `me`'s own failure.
    expect(queryClient.getQueryData(["me"])).toEqual(FAKE_ME);
    expect((queryClient.getQueryState(["me"])?.error as ApiError).status).toBe(401);
  });
});
