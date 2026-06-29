import { z } from "zod";

/** A single client telemetry event. Kept tiny and permissive — telemetry must
 *  never reject a real user action because a prop shape drifted. */
export const eventInputSchema = z.object({
  name: z.string().min(1).max(64),
  props: z.record(z.unknown()).optional(),
  sessionId: z.string().max(64).optional(),
  ts: z.string().max(40).optional(),
});
export type EventInput = z.infer<typeof eventInputSchema>;

/** Events are flushed in small batches to amortize requests. */
export const eventBatchSchema = z.object({
  events: z.array(eventInputSchema).min(1).max(50),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;
