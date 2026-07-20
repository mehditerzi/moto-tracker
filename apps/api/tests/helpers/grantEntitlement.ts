import { getDb } from "../../src/db/index.js";

/**
 * Test helper: grant a user an active subscription tier so tests that need more
 * than the free single vehicle can create them. Defaults to the 10-vehicle tier.
 */
export function grantEntitlement(
  userId: string,
  productId = "com.mehditerzi.mototracker.garage.10.yearly",
  maxVehicles = 10,
): void {
  const oneYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO entitlement (user_id, product_id, tier, max_vehicles, status, original_transaction_id, expires_at, environment)
       VALUES (?, ?, 'test', ?, 'active', ?, ?, 'Sandbox')
       ON CONFLICT(user_id) DO UPDATE SET product_id = excluded.product_id, max_vehicles = excluded.max_vehicles, status = 'active', expires_at = excluded.expires_at`,
    )
    .run(userId, productId, maxVehicles, `otx_${userId}`, oneYear);
}
