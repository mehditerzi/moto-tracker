import { z } from "zod";

export const notifItemTypeSchema = z.enum(["sigorta", "kasko", "muayene", "maintenance"]);
export type NotifItemType = z.infer<typeof notifItemTypeSchema>;

export const notifPreferenceSchema = z.object({
  userId: z.string(),
  itemType: notifItemTypeSchema,
  leadDays: z.array(z.number().int().min(0).max(365)),
  enabled: z.boolean(),
});
export type NotifPreference = z.infer<typeof notifPreferenceSchema>;

export const notifPreferenceUpdateSchema = z.object({
  leadDays: z.array(z.number().int().min(0).max(365)).max(8),
  enabled: z.boolean(),
});
export type NotifPreferenceUpdateInput = z.infer<typeof notifPreferenceUpdateSchema>;

export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;
