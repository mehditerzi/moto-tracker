# In-app purchases — vehicle packs (auto-renewable subscriptions)

The **first vehicle is free**. More vehicles are sold as **packs** — the pack
size is the total active-vehicle ceiling. There's **no third-party billing
SDK** — we verify Apple's signed transactions ourselves against Apple's root
CAs.

Pricing is **₺20/vehicle/month** or **₺100/vehicle/year**, with a volume
discount baked into the pack price: **10% off at 10+, 20% at 20+, 30% from
30 up**. Apple has no per-quantity billing, so each pack × period is its own
product; all live in one subscription group, so a user is on exactly one.

Product ID pattern: `com.mehditerzi.mototracker.garage.<packSize>.<monthly|yearly>`

| Pack | Monthly | Yearly | Product IDs (`…garage.` prefix) |
|---|---|---|---|
| Free (1) | — | — | — |
| 3 | ₺60 | ₺300 | `3.monthly` / `3.yearly` |
| 5 | ₺100 | ₺500 | `5.monthly` / `5.yearly` |
| 10 (−10%) | ₺180 | ₺900 | `10.monthly` / `10.yearly` |
| 20 (−20%) | ₺320 | ₺1600 | `20.monthly` / `20.yearly` |
| 30 (−30%) | ₺420 | ₺2100 | `30.monthly` / `30.yearly` |
| 40 (−30%) | ₺560 | ₺2800 | `40.monthly` / `40.yearly` |
| 50 (−30%) | ₺700 | ₺3500 | `50.monthly` / `50.yearly` |

The formula and pack list live in
[`packages/shared/src/schemas/iap.ts`](../packages/shared/src/schemas/iap.ts).
The server resolves product IDs **by pattern**, so adding a pack size later
means: create the products in App Store Connect + add the size to `PACK_SIZES`
(paywall display only) — no entitlement logic changes. Prices in App Store
Connect should match the formula (Apple price points may round, e.g. ₺299.99).

## Pieces in this repo

**Backend**
- `apps/api/src/db/migrations/015_entitlement.sql` — `entitlement` (current
  allowance per user) + `iap_transaction` (audit / idempotency log).
- `apps/api/src/lib/entitlement.ts` — resolves the effective vehicle ceiling
  (past-due subs collapse to free instantly), applies verified transactions.
- `apps/api/src/lib/appstore.ts` — JWS verification via
  `@apple/app-store-server-library` against `certs/apple/*`.
- `apps/api/src/routes/iap.ts` — `POST /api/iap/verify` (client),
  `GET /api/iap/account-token` (the `appAccountToken` UUID for the purchase), and
  `POST /api/iap/webhook` (App Store Server Notifications V2, **unauthenticated**;
  the JWS signature is the auth).
- `apps/api/src/db/migrations/016_iap_account_token.sql` — the user↔UUID map so
  notifications attribute to a user even before the client verifies.
- `apps/api/src/routes/entitlement.ts` — `GET /api/entitlement` for the UI.
- The cap is enforced in `POST /api/bikes` → `403 { error: "vehicle_limit_reached" }`.

**Web**
- `apps/web/src/hooks/useEntitlement.ts`, `components/PaywallSheet.tsx`,
  `components/AddVehicleButton.tsx`, `lib/nativeIap.ts` (StoreKit bridge + silent
  launch reconcile).

**iOS (native)**
- `ios/App/App/StoreKitPlugin.swift` — StoreKit 2 Capacitor plugin
  (`getProducts` / `purchase` / `restore`), returns signed JWS.
- `ios/App/Garajim.storekit` — local test config (all 14 pack products).

## App Store Connect setup (one-time)

1. **Subscription group.** Features → In-App Purchases → **Subscription Group**,
   name it `Garaj Aboneliği`.
2. **Create the 14 auto-renewable subscriptions** (7 packs × monthly/yearly)
   with the product IDs above. For each: duration **1 month** or **1 year**,
   price per the table, a localized display name (`Garaj 3 Araç (Yıllık)`, …)
   and a reference name. **Type = Auto-Renewable Subscription** (NOT
   Consumable). Put the monthly and yearly of the same pack at the same
   **subscription level**, bigger packs at higher levels, so Apple offers
   upgrade/downgrade correctly.
3. **Paid Apps agreement** must be active (Agreements, Tax, and Banking),
   otherwise products never load.
4. **App-specific Shared Secret** is not needed — StoreKit 2 + JWS verification
   doesn't use the legacy `verifyReceipt` secret.
5. **In-App Purchase key (.p8).** Users and Access → Integrations → **In-App
   Purchase** → generate a key. (Only needed if you later call the App Store
   Server API for history/refund lookups; JWS verification alone doesn't require
   it.) Store it like the APNs key.
6. **App Store Server Notifications V2.** App → App Information → App Store Server
   Notifications → set the **Production** and **Sandbox** URLs both to
   `https://mototracker.mehditerzi.com/api/iap/webhook`, **Version 2**.

## Backend env (`apps/api`)

```
# Bundle id defaults to APNS_BUNDLE_ID — usually leave IAP_BUNDLE_ID unset.
IAP_APP_APPLE_ID=<numeric App Store app id>   # required to verify PRODUCTION notifications
# IAP_BUNDLE_ID=com.mehditerzi.mototracker    # only if different from APNS_BUNDLE_ID
# IAP_APPLE_ROOT_CA_DIR=./certs/apple         # default; contains AppleRootCA-G3.cer
# IAP_ENABLE_ONLINE_CHECKS=false              # set true for OCSP (needs outbound net)
```

IAP stays **off** (endpoints return `503 iap_unavailable`) until the root CAs are
present and a bundle id resolves — the app just runs on the free tier until then.
The Apple root certs are committed under `certs/apple/` (public, no secrets).

## Xcode wiring (one-time)

1. **Add the plugin**: drag `StoreKitPlugin.swift` into the **App** target
   (auto-registers via `CAPBridgedPlugin`, like the widget plugin).
2. **Capability**: add **In-App Purchase** to the App target.
3. **Local testing**: Product → Scheme → Edit Scheme → Run → Options →
   **StoreKit Configuration** → `Garajim.storekit`. Now the paywall works in the
   simulator with fake purchases (no sandbox account needed).
4. **Sandbox testing**: on a device, sign out of the App Store, run the app, and
   buy with a **Sandbox Apple ID** (App Store Connect → Users and Access →
   Sandbox). Renewals are accelerated (1 year ≈ 1 hour).

## How it flows

```
Tap "add 2nd vehicle" → PaywallSheet → StoreKit purchase → signed JWS
   → POST /api/iap/verify → verify vs Apple root CA → upsert entitlement
   → cap rises → vehicle can be added.

Renewal / cancel / refund → Apple → POST /api/iap/webhook (V2, verified JWS)
   → find user by originalTransactionId, else by appAccountToken (the UUID the
     client planted at purchase via GET /api/iap/account-token)
   → entitlement updated server-side, even with the app closed.

Launch (native) → syncPurchasesSilently() re-verifies currentEntitlements
   → reconciles cross-device / lapsed state without a "restore" tap.
```

A lapsed subscription **never deletes** vehicles — the user keeps them read-only
and simply can't add new ones until they renew or drop under the free limit.

## Notes

- `cap sync` does not manage the Swift plugin file or the `.storekit` config —
  add them once in Xcode; they persist across syncs.
- The `SignedDataVerifier` is offline by default. For OCSP revocation checks set
  `IAP_ENABLE_ONLINE_CHECKS=true` (the box must reach Apple).
- If Apple rotates root CAs, re-download into `certs/apple/` (see its README).
