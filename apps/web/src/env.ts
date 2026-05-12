import { z } from "zod";

const Env = z.object({
  /**
   * Origin where the API lives. Empty string (default) means same-origin — the
   * production build is served by the API itself, so all `fetch("/api/...")`
   * requests are relative. Set to e.g. "http://localhost:8787" only when running
   * the Vite dev server on a different port than the API.
   */
  VITE_API_URL: z
    .string()
    .default("")
    .refine((v) => v === "" || /^https?:\/\//.test(v), {
      message: "VITE_API_URL must be empty or an absolute http(s) URL",
    }),
});

export const env = Env.parse(import.meta.env);
