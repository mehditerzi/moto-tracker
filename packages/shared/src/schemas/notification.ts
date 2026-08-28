import { z } from "zod";

export const notifItemTypeSchema = z.enum(["sigorta", "kasko", "muayene", "maintenance", "mtv"]);
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

/**
 * Notification CATEGORIES — the transactional half of the notification system.
 *
 * A `NotifItemType` above answers "how far ahead of an expiry do you want to be
 * warned". A category answers "do you want to hear about this kind of thing at
 * all", has no lead time, and is fired by something a person did rather than by
 * the calendar. They are separate types because they are separate decisions:
 * somebody who muted insurance reminders has said nothing whatsoever about
 * whether they want to know that a stranger is claiming to have bought their
 * car, and a single toggle covering both would have made the quietest
 * reasonable setting in the app silence a security-relevant message.
 *
 * Not everything in a category is mutable. Requests filed against a vehicle YOU
 * hold are always delivered — see MUTABLE_KINDS in apps/api/src/notify/events.ts
 * — because they start a 21-day window whose whole design assumes you were
 * told.
 */
export const notifCategorySchema = z.enum(["sharing"]);
export type NotifCategory = z.infer<typeof notifCategorySchema>;

export const notifCategoryPreferenceSchema = z.object({
  category: notifCategorySchema,
  enabled: z.boolean(),
});
export type NotifCategoryPreference = z.infer<typeof notifCategoryPreferenceSchema>;

export const notifCategoryPreferenceUpdateSchema = z.object({ enabled: z.boolean() });
export type NotifCategoryPreferenceUpdateInput = z.infer<
  typeof notifCategoryPreferenceUpdateSchema
>;

export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

// Native push (APNs) device token, registered by the Capacitor iOS app.
export const deviceTokenInputSchema = z.object({
  platform: z.literal("ios"),
  token: z.string().min(8).max(200),
});
export type DeviceTokenInput = z.infer<typeof deviceTokenInputSchema>;
