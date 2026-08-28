import { z } from "zod";
import { orgModeSchema, orgRoleSchema, type OrgMode } from "./organization.js";

/**
 * Fleet operations — the shapes the dispatch-board screens exchange with the API.
 *
 * `organization.ts` describes the TENANCY (orgs, members, invites, assignments,
 * contracts). This file describes what the fleet SCREENS ask for and get back:
 * the triage board, the inventory table, the cost rollup and the CSV importer.
 *
 * Everything here is derived data. There is no `fleetTriageRow` table — a triage
 * row is a dated item, a maintenance interval or a rental due date rendered
 * through one lens, which is exactly why the shape belongs in one shared file
 * rather than being re-invented in the client.
 */

// ─── org settings ─────────────────────────────────────────────────────────────

/**
 * What an owner/manager may change about their own organization.
 *
 * `mode` is here even though the design doc calls it "effectively permanent":
 * an org provisioned in the wrong mode by the operator must be fixable without a
 * database console. The API refuses the switch while anything of the outgoing
 * mode is still open, so the change can never orphan a live assignment/contract.
 *
 * Deliberately absent: `maxVehicles`. The ceiling is what the customer pays for,
 * so it moves only through `setOrgMaxVehicles` (lib/entitlement.ts), never
 * through a route a customer can call.
 */
export const orgSettingsUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    mode: orgModeSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.mode !== undefined, {
    message: "empty_update",
  });
export type OrgSettingsUpdateInput = z.infer<typeof orgSettingsUpdateSchema>;

/** The org as its own members see it, with the caller's standing in it. */
export const orgDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: orgModeSchema,
  maxVehicles: z.number().int().nonnegative(),
  activeVehicles: z.number().int().nonnegative(),
  memberCount: z.number().int().nonnegative(),
  /** The CALLER's role — the client mirrors permissions from this. */
  role: orgRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrgDetail = z.infer<typeof orgDetailSchema>;

export const orgMemberRoleUpdateSchema = z.object({ role: orgRoleSchema });
export type OrgMemberRoleUpdateInput = z.infer<typeof orgMemberRoleUpdateSchema>;

// ─── shared vocabulary for the board ──────────────────────────────────────────

/**
 * The same four states as the consumer app's `StatusChip`, with the same
 * thresholds (expired < 0 ≤ danger ≤ 7 < soon ≤ 30 < ok). A manager who also
 * uses the consumer app must be able to read a fleet row without relearning it.
 * `unset` means there is no deadline recorded at all.
 */
export const fleetStatusSchema = z.enum(["expired", "danger", "soon", "ok", "unset"]);
export type FleetStatus = z.infer<typeof fleetStatusSchema>;

/**
 * What kind of deadline a triage row is. The four `dated_item` types keep their
 * own names (the client already translates them); `maintenance` covers a service
 * interval coming due, `contract_due` a rental that is due back.
 */
export const fleetDueKindSchema = z.enum([
  "sigorta",
  "kasko",
  "muayene",
  "mtv",
  "maintenance",
  "contract_due",
]);
export type FleetDueKind = z.infer<typeof fleetDueKindSchema>;

/**
 * Who has the vehicle right now. One shape for both modes — the design doc is
 * explicit that there is ONE vehicle row whose holder cell renders differently,
 * not two parallel UIs.
 */
export interface FleetHolder {
  type: "driver" | "customer";
  /** user id in fleet mode, fleet_customer id in rental mode. */
  id: string;
  name: string;
  /** When the vehicle went out. */
  since: string;
  /** rental mode only: agreed return date, if one was set. */
  dueBack?: string | null;
  /** rental mode only: the contract, so the row can link to it. */
  contractId?: string;
}

/** One line on the triage board. */
export interface FleetTriageRow {
  bikeId: string;
  plate: string | null;
  nickname: string;
  make: string | null;
  model: string | null;
  kind: FleetDueKind;
  /** For `maintenance`, the custom label or the kind; null otherwise. */
  label: string | null;
  /** The id of the underlying record, for deep-linking. Null for a contract. */
  recordId: string | null;
  dueOn: string;
  /** Signed: negative means overdue by that many days. */
  daysRemaining: number;
  status: FleetStatus;
  holder: FleetHolder | null;
}

export interface FleetSummary {
  totalVehicles: number;
  /** Vehicles with an open assignment (fleet mode) or open contract (rental). */
  inUse: number;
  idle: number;
  /** Archived — withdrawn from the fleet but still on the books. */
  archived: number;
  documentsPendingOcr: number;
  overdueCount: number;
  dueSoonCount: number;
}

export interface FleetTriageResponse {
  orgId: string;
  mode: OrgMode;
  /** The calendar day every `daysRemaining` was computed against. */
  today: string;
  horizonDays: number;
  summary: FleetSummary;
  overdue: FleetTriageRow[];
  upcoming: FleetTriageRow[];
}

// ─── inventory ────────────────────────────────────────────────────────────────

export const fleetInventorySortSchema = z.enum(["plate", "expiry", "km", "status", "nickname"]);
export type FleetInventorySort = z.infer<typeof fleetInventorySortSchema>;

export const fleetInventoryQuerySchema = z.object({
  /** Free text over plate / nickname / make / model. Plate spacing is ignored. */
  q: z.string().max(120).optional(),
  status: fleetStatusSchema.optional(),
  /** `assigned` / `idle`, or a specific holder id (user or customer). */
  holder: z.string().max(60).optional(),
  sort: fleetInventorySortSchema.default("expiry"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  // NOT z.coerce.boolean(): Boolean("false") is true, so a coerced flag can only
  // ever be turned on. Compare the literal the client actually sends.
  includeArchived: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type FleetInventoryQuery = z.infer<typeof fleetInventoryQuerySchema>;

export interface FleetInventoryRow {
  bikeId: string;
  plate: string | null;
  nickname: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicleType: "motorcycle" | "car";
  currentKm: number | null;
  archived: boolean;
  /** The soonest deadline of any kind, or null when nothing is recorded. */
  nextDue: {
    kind: FleetDueKind;
    label: string | null;
    dueOn: string;
    daysRemaining: number;
  } | null;
  /**
   * The most urgent KM-based service interval. It has no due DATE, so it cannot
   * be placed on a board sorted by days remaining — but "due in 800 km" is how
   * a courier fleet actually schedules an oil change, so it rides along here.
   * Negative `kmRemaining` means already overdue.
   */
  kmDue: { label: string; kmRemaining: number } | null;
  status: FleetStatus;
  holder: FleetHolder | null;
  documentsPendingOcr: number;
}

export interface FleetInventoryResponse {
  orgId: string;
  mode: OrgMode;
  today: string;
  total: number;
  limit: number;
  offset: number;
  items: FleetInventoryRow[];
}

// ─── costs ────────────────────────────────────────────────────────────────────

const monthRe = /^\d{4}-\d{2}$/;

export const fleetCostQuerySchema = z.object({
  /** Inclusive month bounds, `YYYY-MM`. Defaults to the last 12 months. */
  from: z.string().regex(monthRe).optional(),
  to: z.string().regex(monthRe).optional(),
});
export type FleetCostQuery = z.infer<typeof fleetCostQuerySchema>;

export interface FleetCostBucket {
  fuelCost: number;
  fuelLiters: number;
  maintenanceCost: number;
  /** Insurance / inspection / tax — `dated_item.cost`. */
  complianceCost: number;
  totalCost: number;
  distanceKm: number;
  /** null when distance is unknown; the UI must not render ₺/0. */
  costPerKm: number | null;
}

export interface FleetCostVehicle extends FleetCostBucket {
  bikeId: string;
  plate: string | null;
  nickname: string;
  /**
   * costPerKm ÷ the fleet median. >1 is dearer than the typical vehicle; null
   * when either side is unknown. This is the number the outlier badge reads.
   */
  ratioToMedian: number | null;
  outlier: boolean;
  months: (FleetCostBucket & { month: string })[];
}

export interface FleetCostResponse {
  orgId: string;
  from: string;
  to: string;
  currency: string;
  fleet: FleetCostBucket & { medianCostPerKm: number | null; outlierThreshold: number };
  months: (FleetCostBucket & { month: string })[];
  vehicles: FleetCostVehicle[];
}

// ─── CSV import ───────────────────────────────────────────────────────────────

/**
 * The file arrives as text in a JSON body rather than as a multipart upload: a
 * fleet spreadsheet is a few kilobytes, the client has already read it to show a
 * preview, and this keeps the endpoint free of multer and of any path on disk.
 */
export const fleetImportSchema = z.object({
  csv: z.string().min(1).max(1_000_000),
  /** Override the sniffed delimiter when a pathological file fools detection. */
  delimiter: z.enum([",", ";", "\t", "|"]).optional(),
});
export type FleetImportInput = z.infer<typeof fleetImportSchema>;

/** The vehicle fields the importer understands, in preview/commit order. */
export const fleetImportFieldSchema = z.enum([
  "plate",
  "nickname",
  "make",
  "model",
  "year",
  "currentKm",
  "vehicleType",
  "color",
  "chassisNo",
  "engineNo",
  "fuelType",
  "firstRegistrationDate",
  "sigorta",
  "kasko",
  "muayene",
  "mtv",
]);
export type FleetImportField = z.infer<typeof fleetImportFieldSchema>;

export interface FleetImportRowError {
  field: FleetImportField | null;
  /** Machine code — `invalid_date`, `plate_exists`, … The client translates. */
  code: string;
}

export interface FleetImportRow {
  /** 1-based index among DATA rows (the header is not row 1). */
  row: number;
  /** 1-based line in the file, so an error points at what the user sees. */
  line: number;
  values: Partial<Record<FleetImportField, string | number | null>>;
  errors: FleetImportRowError[];
}

export interface FleetImportPreview {
  orgId: string;
  delimiter: string;
  /** Header cells as they appeared, and what each mapped to (null = ignored). */
  columns: { raw: string; field: FleetImportField | null }[];
  /** Fields the importer supports that this file does not carry. */
  missingFields: FleetImportField[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  maxVehicles: number;
  currentVehicles: number;
  /** True when committing would breach `organization.max_vehicles`. */
  wouldExceedLimit: boolean;
  rows: FleetImportRow[];
}

export interface FleetImportResult {
  orgId: string;
  created: number;
  bikeIds: string[];
  datedItemsCreated: number;
}
