import { z } from "zod";

const Env = z.object({
  VITE_API_URL: z.string().url().default("http://localhost:8787"),
});

export const env = Env.parse(import.meta.env);
