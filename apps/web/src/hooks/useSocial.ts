import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FeedPage,
  FeedPost,
  MyProfile,
  PostDetail,
  ProfileInput,
  ReportInput,
  RiderProfile,
  RiderSummary,
} from "@mototracker/shared";
import { api } from "@/lib/api";

const ME = ["social", "me"];
const FEED = ["social", "feed"];

export function useMyProfile() {
  return useQuery<MyProfile>({ queryKey: ME, queryFn: () => api<MyProfile>("/api/social/me") });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) => api<MyProfile>("/api/social/me", { method: "PUT", json: input }),
    onSuccess: (p) => {
      qc.setQueryData(ME, p);
      void qc.invalidateQueries({ queryKey: ["social", "profile"] });
    },
  });
}

export function useFeed() {
  return useInfiniteQuery<FeedPage>({
    queryKey: FEED,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<FeedPage>(`/api/social/feed${pageParam ? `?before=${encodeURIComponent(String(pageParam))}` : ""}`),
    getNextPageParam: (last) => last.next,
  });
}

export function useProfile(handle: string | undefined) {
  return useQuery<RiderProfile>({
    queryKey: ["social", "profile", handle],
    queryFn: () => api<RiderProfile>(`/api/social/profiles/${encodeURIComponent(handle!)}`),
    enabled: !!handle,
  });
}

export function useProfilePosts(handle: string | undefined) {
  return useInfiniteQuery<FeedPage>({
    queryKey: ["social", "profilePosts", handle],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<FeedPage>(
        `/api/social/profiles/${encodeURIComponent(handle!)}/posts${pageParam ? `?before=${encodeURIComponent(String(pageParam))}` : ""}`,
      ),
    getNextPageParam: (last) => last.next,
    enabled: !!handle,
  });
}

export function usePeople(handle: string | undefined, which: "followers" | "following") {
  return useQuery<RiderSummary[]>({
    queryKey: ["social", which, handle],
    queryFn: () => api<RiderSummary[]>(`/api/social/profiles/${encodeURIComponent(handle!)}/${which}`),
    enabled: !!handle,
  });
}

export function useSearchRiders(q: string) {
  return useQuery<RiderSummary[]>({
    queryKey: ["social", "search", q],
    queryFn: () => api<RiderSummary[]>(`/api/social/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
}

export function useSuggestions(enabled = true) {
  return useQuery<RiderSummary[]>({
    queryKey: ["social", "suggestions"],
    queryFn: () => api<RiderSummary[]>("/api/social/suggestions"),
    enabled,
  });
}

/** Follow/unfollow; every list that shows the person is refreshed. */
export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ handle, follow }: { handle: string; follow: boolean }) =>
      api<{ following: boolean }>(`/api/social/profiles/${encodeURIComponent(handle)}/follow`, {
        method: follow ? "POST" : "DELETE",
        json: follow ? {} : undefined,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["social"] }),
  });
}

export function usePost(id: string | undefined) {
  return useQuery<PostDetail>({
    queryKey: ["social", "post", id],
    queryFn: () => api<PostDetail>(`/api/social/posts/${id}`),
    enabled: !!id,
  });
}

/** Write the fresh post into every cached feed page that holds it. */
function patchPost(qc: ReturnType<typeof useQueryClient>, post: FeedPost) {
  qc.setQueriesData<{ pages: FeedPage[]; pageParams: unknown[] }>({ queryKey: ["social"] }, (data) => {
    if (!data || !Array.isArray((data as { pages?: unknown }).pages)) return data;
    return { ...data, pages: data.pages.map((p) => ({ ...p, posts: p.posts.map((x) => (x.id === post.id ? post : x)) })) };
  });
  qc.setQueryData<PostDetail>(["social", "post", post.id], (d) => (d ? { ...d, ...post } : d));
}

export function useKudos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      api<FeedPost>(`/api/social/posts/${id}/kudos`, { method: on ? "POST" : "DELETE", json: on ? {} : undefined }),
    onMutate: ({ id, on }) => {
      // Optimistic: the flame lights the moment it is tapped.
      qc.setQueriesData<{ pages: FeedPage[]; pageParams: unknown[] }>({ queryKey: ["social"] }, (data) => {
        if (!data || !Array.isArray((data as { pages?: unknown }).pages)) return data;
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            posts: p.posts.map((x) =>
              x.id === id && x.kudosByMe !== on ? { ...x, kudosByMe: on, kudos: x.kudos + (on ? 1 : -1) } : x,
            ),
          })),
        };
      });
    },
    onSuccess: (post) => patchPost(qc, post),
    onError: () => void qc.invalidateQueries({ queryKey: ["social"] }),
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { tripId: string; caption: string | null; showRoute: boolean }) =>
      api<FeedPost>("/api/social/posts", { method: "POST", json: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["social"] }),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/social/posts/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["social"] }),
  });
}

export function useComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api<{ id: string }>(`/api/social/posts/${postId}/comments`, { method: "POST", json: { body } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["social"] }),
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/social/comments/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["social"] }),
  });
}

export function useReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: ReportInput) => api<{ ok: boolean }>("/api/social/reports", { method: "POST", json: r }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["social"] }),
  });
}

export function useBlocks() {
  return useQuery<{ userId: string; handle: string | null; displayName: string | null }[]>({
    queryKey: ["social", "blocks"],
    queryFn: () => api("/api/social/blocks"),
  });
}

export function useBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, block }: { userId: string; block: boolean }) =>
      api<{ blocked: boolean }>(`/api/social/blocks/${userId}`, {
        method: block ? "POST" : "DELETE",
        json: block ? {} : undefined,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["social"] }),
  });
}
