import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface PublicConfig {
  appleSignIn: boolean;
  googleSignIn: boolean;
  mapkit: boolean;
}

/** Unauthenticated config for the sign-in screen (which social buttons to show). */
export function usePublicConfig() {
  return useQuery<PublicConfig>({
    queryKey: ["publicConfig"],
    queryFn: () => api<PublicConfig>("/api/public-config"),
    staleTime: Infinity,
  });
}
