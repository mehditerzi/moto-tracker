import { z } from "zod";

/**
 * The vehicle assistant: expenses, mechanics, the glovebox and SOS contacts.
 * Every record belongs to the user who entered it (see migration 030).
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor");

// ─── expenses ─────────────────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES = [
  "repair",
  "parts",
  "tires",
  "wash",
  "parking",
  "toll",
  "fine",
  "tax",
  "insurance",
  "accessory",
  "other",
] as const;
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const expenseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  bikeId: z.string(),
  category: expenseCategorySchema,
  amount: z.number(),
  spentOn: z.string(),
  odometerKm: z.number().int().nullable(),
  vendor: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type Expense = z.infer<typeof expenseSchema>;

export const expenseCreateSchema = z.object({
  bikeId: z.string().min(1),
  category: expenseCategorySchema,
  amount: z.number().nonnegative().max(10_000_000),
  spentOn: isoDate,
  odometerKm: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
  vendor: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

export const expenseUpdateSchema = expenseCreateSchema.omit({ bikeId: true }).partial();
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;

/** Where a cost line came from — the report is the union of four tables. */
export const COST_SOURCES = ["fuel", "maintenance", "document", "expense"] as const;
export type CostSource = (typeof COST_SOURCES)[number];

/** One month of spend, split by source. `month` is YYYY-MM. */
export const costMonthSchema = z.object({
  month: z.string(),
  fuel: z.number(),
  maintenance: z.number(),
  document: z.number(),
  expense: z.number(),
  total: z.number(),
});
export type CostMonth = z.infer<typeof costMonthSchema>;

/** GET /api/expenses/summary — everything the cost screen draws. */
export const costSummarySchema = z.object({
  bikeId: z.string(),
  /** Inclusive range the totals cover (YYYY-MM-DD). */
  from: z.string(),
  to: z.string(),
  total: z.number(),
  bySource: z.object({
    fuel: z.number(),
    maintenance: z.number(),
    document: z.number(),
    expense: z.number(),
  }),
  /** Expense-table spend by category (fuel etc. are their own sources). */
  byCategory: z.record(z.string(), z.number()),
  months: z.array(costMonthSchema),
  /** km covered inside the range, from odometer readings; null if unknown. */
  distanceKm: z.number().nullable(),
  /** total / distanceKm, when both are known. */
  costPerKm: z.number().nullable(),
});
export type CostSummary = z.infer<typeof costSummarySchema>;

// ─── mechanics ────────────────────────────────────────────────────────────────

export const MECHANIC_SPECIALTIES = [
  "general",
  "electric",
  "tires",
  "body",
  "paint",
  "glass",
  "tow",
  "motorcycle",
  "dealer",
  "other",
] as const;
export const mechanicSpecialtySchema = z.enum(MECHANIC_SPECIALTIES);
export type MechanicSpecialty = z.infer<typeof mechanicSpecialtySchema>;

/** Loose on purpose: people type "0532 123 45 67", "+90 (532) …", "444 0 123". */
const phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+\d][\d\s().-]{2,}$/, "Geçerli bir telefon numarası girin");

export const mechanicSchema = z.object({
  id: z.string(),
  name: z.string(),
  specialty: mechanicSpecialtySchema,
  phone: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  notes: z.string().nullable(),
  favorite: z.boolean(),
  createdAt: z.string(),
});
export type Mechanic = z.infer<typeof mechanicSchema>;

export const mechanicCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  specialty: mechanicSpecialtySchema.default("general"),
  phone: phone.nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  favorite: z.boolean().optional(),
});
export type MechanicCreateInput = z.input<typeof mechanicCreateSchema>;
export const mechanicUpdateSchema = mechanicCreateSchema.partial();
export type MechanicUpdateInput = z.input<typeof mechanicUpdateSchema>;

// ─── glovebox (attachments) ───────────────────────────────────────────────────

export const ATTACHMENT_KINDS = [
  "registration",
  "license",
  "insurance",
  "kasko",
  "inspection",
  "invoice",
  "service",
  "warranty",
  "other",
] as const;
export const attachmentKindSchema = z.enum(ATTACHMENT_KINDS);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  bikeId: z.string().nullable(),
  kind: attachmentKindSchema,
  title: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  expiresOn: z.string().nullable(),
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** Multipart fields that accompany the file on POST /api/attachments. */
export const attachmentMetaSchema = z.object({
  bikeId: z.string().min(1).nullable().optional(),
  kind: attachmentKindSchema.default("other"),
  title: z.string().trim().min(1).max(120),
  expiresOn: isoDate.nullable().optional(),
});

export const attachmentUpdateSchema = z.object({
  kind: attachmentKindSchema.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  expiresOn: isoDate.nullable().optional(),
});

/** Free accounts may keep this many glovebox files; Pro is unlimited. */
export const FREE_ATTACHMENT_LIMIT = 5;

// ─── SOS ──────────────────────────────────────────────────────────────────────

export const sosContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
});
export type SosContact = z.infer<typeof sosContactSchema>;

export const sosContactCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone,
});
export type SosContactCreateInput = z.infer<typeof sosContactCreateSchema>;

/** A handful is plenty; a long list is a list nobody calls. */
export const MAX_SOS_CONTACTS = 5;
