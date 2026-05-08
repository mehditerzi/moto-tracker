import { z } from "zod";

export const profileSchema = z.object({
  userId: z.string(),
  language: z.enum(["tr", "en"]),
  timezone: z.string(),
  createdAt: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string().nullable(),
    image: z.string().url().nullable(),
  }),
  profile: profileSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;
