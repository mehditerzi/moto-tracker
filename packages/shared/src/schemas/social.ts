import { z } from "zod";

/** @handle: 3–20 chars, letters/digits/underscore/dot, starts with a letter. */
export const HANDLE_RE = /^[a-z][a-z0-9_.]{2,19}$/;

export const profileInputSchema = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HANDLE_RE, "invalid_handle"),
  displayName: z.string().trim().min(2).max(40),
  bio: z.string().trim().max(160).nullable().optional(),
  city: z.string().trim().max(40).nullable().optional(),
  showGarage: z.boolean().default(true),
  /** Must be true the first time: the community rules (App Review 1.2). */
  acceptRules: z.boolean().optional(),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const postInputSchema = z.object({
  tripId: z.string().min(1),
  caption: z.string().trim().max(280).nullable().optional(),
  showRoute: z.boolean().default(true),
});
export type PostInput = z.infer<typeof postInputSchema>;

export const commentInputSchema = z.object({ body: z.string().trim().min(1).max(500) });

export const reportInputSchema = z.object({
  kind: z.enum(["post", "comment", "user"]),
  targetId: z.string().min(1),
  reason: z.string().trim().max(200).optional(),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

export interface RiderSummary {
  userId: string;
  handle: string;
  displayName: string;
  city: string | null;
  isFollowing: boolean;
  /** Why we suggest them ("rode together", "followed by …"). */
  reason?: string | null;
}

export interface GarageVehicle {
  id: string;
  vehicleType: "motorcycle" | "car";
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  cylinderCc: number | null;
  nickname: string;
}

export interface RiderProfile extends RiderSummary {
  bio: string | null;
  isMe: boolean;
  followsMe: boolean;
  blocked: boolean;
  showGarage: boolean;
  followers: number;
  following: number;
  stats: { posts: number; km: number; rides: number };
  garage: GarageVehicle[];
}

export interface MyProfile {
  profile: {
    handle: string;
    displayName: string;
    bio: string | null;
    city: string | null;
    showGarage: boolean;
    rulesAccepted: boolean;
  } | null;
  /** Prefill for a first profile. */
  suggestedHandle: string;
  suggestedName: string;
}

export interface FeedPost {
  id: string;
  author: { userId: string; handle: string; displayName: string };
  isMine: boolean;
  caption: string | null;
  distanceKm: number;
  durationMin: number;
  startedAt: string;
  route: string | null;
  vehicle: {
    vehicleType: "motorcycle" | "car" | null;
    make: string | null;
    model: string | null;
    color: string | null;
    name: string | null;
  };
  kudos: number;
  kudosByMe: boolean;
  comments: number;
  createdAt: string;
}

export interface PostComment {
  id: string;
  author: { userId: string; handle: string; displayName: string };
  body: string;
  isMine: boolean;
  createdAt: string;
}

export interface PostDetail extends FeedPost {
  commentList: PostComment[];
  kudosBy: { handle: string; displayName: string }[];
}

export interface FeedPage {
  posts: FeedPost[];
  /** Pass as ?before= to load older posts; null at the end. */
  next: string | null;
}
