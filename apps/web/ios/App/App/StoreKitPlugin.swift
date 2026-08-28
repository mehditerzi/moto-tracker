import Foundation
import Capacitor
import StoreKit

/// Custom Capacitor plugin exposing StoreKit 2 to the web app (no third-party
/// billing SDK). It returns Apple's *signed* JWS transaction strings; the web
/// layer forwards them to the API (`/api/iap/verify`), which verifies the
/// signature against Apple's root CAs and grants the vehicle entitlement.
///
/// Called from apps/web/src/lib/nativeIap.ts. StoreKit 2 requires iOS 15+, so
/// each method guards on availability and rejects on older systems (where the
/// app simply keeps the free single-vehicle tier).
///
/// Two invariants matter for not losing a customer's money:
///
///  1. **A transaction is finished only after our server has recorded it.**
///     `purchase()` hands the JWS to JS and leaves the transaction UNFINISHED.
///     JS verifies it server-side and then calls `finishTransactions`. If the
///     app dies, the network drops, or verification fails, StoreKit redelivers
///     the transaction through `Transaction.updates` on the next launch, so the
///     purchase is recovered instead of silently vanishing. This matters most
///     for the non-renewing packs (2/3/5/10 yr): Apple does NOT list those in
///     `Transaction.currentEntitlements`, so "Restore purchases" can never get
///     them back — the purchase JWS is our only chance to see them.
///
///  2. **`Transaction.updates` is forwarded, never swallowed.** An Ask-to-Buy
///     approval or an SCA/bank-verified payment lands there minutes after the
///     purchase sheet closed. Those events are emitted to JS as the
///     `transactionsUpdated` listener event (retained until consumed, so an
///     event fired before the web layer attached is still delivered).
///
/// SETUP: add this file to the App target. Add the In-App Purchase capability to
/// the App target, and create the products in App Store Connect (docs/ios-iap.md).
@objc(StoreKitPlugin)
public class StoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPlugin"
    public let jsName = "StoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransactions", returnType: CAPPluginReturnPromise),
        // addListener / removeAllListeners are provided by the Capacitor bridge
        // itself (see JSExport.createPluginHeader) — declaring them here would
        // duplicate them in the generated JS shim.
    ]

    /// Event name for out-of-band transactions (deferred approvals, renewals,
    /// purchases made on another device). Must match nativeIap.ts.
    private static let updatesEvent = "transactionsUpdated"

    private var updatesTask: Task<Void, Never>?

    /// Resolved `Product` objects keyed by product id, so a purchase does not
    /// need a network round-trip before the payment sheet can appear. Typed as
    /// `Any` because the cache is a stored property and `Product` is iOS 15+;
    /// every read casts back inside an availability check.
    private var productCache: [String: Any] = [:]
    private let cacheLock = NSLock()

    private func cacheProducts(_ pairs: [(String, Any)]) {
        cacheLock.lock()
        for (id, product) in pairs { productCache[id] = product }
        cacheLock.unlock()
    }

    private func cachedProduct(_ id: String) -> Any? {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        return productCache[id]
    }

    override public func load() {
        guard #available(iOS 15.0, *) else { return }
        updatesTask = Task.detached { [weak self] in
            for await update in Transaction.updates {
                guard let self = self else { return }
                // Forward the signed JWS so the web layer can have the server
                // verify it. Do NOT finish here — JS finishes once the server
                // has recorded the entitlement (see invariant 1 above).
                var payload: [String: Any] = ["transactions": [update.jwsRepresentation]]
                if case .verified(let transaction) = update {
                    payload["transactionIds"] = [String(transaction.id)]
                    payload["productId"] = transaction.productID
                    payload["verified"] = true
                } else if case .unverified(let transaction, _) = update {
                    // Our server would reject the signature anyway; finish it so
                    // it does not redeliver forever, but still tell JS so the
                    // failure is visible in telemetry rather than silent.
                    payload["transactionIds"] = [String]()
                    payload["productId"] = transaction.productID
                    payload["verified"] = false
                    await transaction.finish()
                }
                self.notifyListeners(StoreKitPlugin.updatesEvent, data: payload, retainUntilConsumed: true)
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    // MARK: - Products

    /// Resolve product ids through StoreKit. Unlike `Product.products(for:)`,
    /// which quietly returns only what it could resolve, this reports the ids
    /// that came back MISSING — an unapproved / mis-typed / storefront-excluded
    /// product is then diagnosable from the paywall and from telemetry instead
    /// of showing up as a purchase that "just doesn't work".
    @objc func getProducts(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("iap_unsupported_os")
            return
        }
        guard let ids = call.getArray("productIds", String.self), !ids.isEmpty else {
            call.reject("iap_invalid_arguments", nil, nil, ["detail": "productIds required"])
            return
        }
        Task {
            do {
                let products = try await Product.products(for: ids)
                self.cacheProducts(products.map { ($0.id, $0 as Any) })
                let resolved = Set(products.map { $0.id })
                let missing = ids.filter { !resolved.contains($0) }
                let payload = products.map { product in
                    [
                        "id": product.id,
                        "displayName": product.displayName,
                        // Localized, currency-formatted for the user's storefront.
                        "displayPrice": product.displayPrice,
                    ]
                }
                let storefront = await Storefront.current
                call.resolve([
                    "products": payload,
                    "missing": missing,
                    "requested": ids.count,
                    "canMakePayments": AppStore.canMakePayments,
                    "storefront": storefront?.countryCode ?? "",
                ])
            } catch {
                let code = StoreKitPlugin.errorCode(error, fallback: "iap_products_failed")
                call.reject(code, nil, error, ["detail": String(describing: error)])
            }
        }
    }

    // MARK: - Purchase

    @objc func purchase(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("iap_unsupported_os")
            return
        }
        guard let productId = call.getString("productId") else {
            call.reject("iap_invalid_arguments", nil, nil, ["detail": "productId required"])
            return
        }
        // Parental controls / MDM restrictions: say so up front rather than
        // letting StoreKit fail with an opaque error after a sheet flash.
        guard AppStore.canMakePayments else {
            call.reject("iap_payment_not_allowed")
            return
        }
        // A UUID from our backend, echoed back in Apple's transactions/notifications
        // so the server can attribute renewals to this user.
        var purchaseOptions: Set<Product.PurchaseOption> = []
        if let tokenStr = call.getString("appAccountToken"), let uuid = UUID(uuidString: tokenStr) {
            purchaseOptions.insert(.appAccountToken(uuid))
        }
        Task {
            let product: Product
            do {
                product = try await self.resolveProduct(productId)
            } catch let error as ResolveError {
                call.reject(error.code)
                return
            } catch {
                call.reject(StoreKitPlugin.errorCode(error, fallback: "iap_products_failed"),
                            nil, error, ["detail": String(describing: error)])
                return
            }

            do {
                let result = try await product.purchase(options: purchaseOptions)
                switch result {
                case .success(let verification):
                    // Send the raw signed JWS to the backend regardless of the
                    // local verification result — the server does the real check.
                    var payload: [String: Any] = [
                        "outcome": "success",
                        "transactions": [verification.jwsRepresentation],
                        "productId": productId,
                    ]
                    if case .verified(let transaction) = verification {
                        // Left UNFINISHED on purpose — JS calls finishTransactions
                        // after the server has granted the entitlement, so an
                        // interrupted verify is redelivered instead of lost.
                        payload["transactionIds"] = [String(transaction.id)]
                        payload["verified"] = true
                    } else if case .unverified(let transaction, _) = verification {
                        payload["transactionIds"] = [String]()
                        payload["verified"] = false
                        await transaction.finish()
                    }
                    call.resolve(payload)
                case .userCancelled:
                    // The user dismissed the sheet. NOT an error, and NOT the
                    // same thing as `.pending`.
                    call.resolve(["outcome": "cancelled", "transactions": [String]()])
                case .pending:
                    // Deferred: Ask to Buy, SCA/bank verification, or a payment
                    // method that needs action. The purchase may complete minutes
                    // later and will arrive via `Transaction.updates`.
                    call.resolve(["outcome": "pending", "transactions": [String]()])
                @unknown default:
                    call.resolve(["outcome": "unknown", "transactions": [String]()])
                }
            } catch {
                let code = StoreKitPlugin.errorCode(error, fallback: "iap_purchase_failed")
                call.reject(code, nil, error, ["detail": String(describing: error), "productId": productId])
            }
        }
    }

    private struct ResolveError: Error {
        let code: String
    }

    /// Cached lookup with one retry. A transient network blip must not surface
    /// as `product_not_found`, which reads to the user as "this pack does not
    /// exist" when it is really "we could not reach the App Store just now".
    @available(iOS 15.0, *)
    private func resolveProduct(_ productId: String) async throws -> Product {
        if let cached = cachedProduct(productId), let product = cached as? Product {
            return product
        }
        var lastError: Error?
        for attempt in 0..<2 {
            if attempt > 0 {
                try? await Task.sleep(nanoseconds: 700_000_000)
            }
            do {
                let products = try await Product.products(for: [productId])
                cacheProducts(products.map { ($0.id, $0 as Any) })
                if let product = products.first(where: { $0.id == productId }) {
                    return product
                }
                // StoreKit answered and simply does not know this id — retrying
                // will not help. This is an App Store Connect problem.
                throw ResolveError(code: "iap_product_not_found")
            } catch let error as ResolveError {
                throw error
            } catch {
                lastError = error
            }
        }
        if let lastError = lastError {
            throw ResolveError(code: StoreKitPlugin.errorCode(lastError, fallback: "iap_products_failed"))
        }
        throw ResolveError(code: "iap_product_not_found")
    }

    // MARK: - Restore

    @objc func restore(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("iap_unsupported_os")
            return
        }
        Task {
            // currentEntitlements reflects the signed-in Apple ID's active
            // subscriptions across devices — no prompt, no AppStore.sync() needed.
            // NOTE: it never contains the non-renewing packs; those live on our
            // server, which is why the purchase JWS must not be lost.
            var jwsList: [String] = []
            var seen: Set<String> = []
            for await result in Transaction.currentEntitlements {
                if seen.insert(result.jwsRepresentation).inserted {
                    jwsList.append(result.jwsRepresentation)
                }
            }
            // Anything still unfinished (a purchase whose verification never
            // completed) is worth re-sending too, or it stays stuck forever.
            // This is the recovery path for a dropped network mid-verify.
            var pendingIds: [String] = []
            for await result in Transaction.unfinished {
                if seen.insert(result.jwsRepresentation).inserted {
                    jwsList.append(result.jwsRepresentation)
                }
                if case .verified(let transaction) = result {
                    pendingIds.append(String(transaction.id))
                }
            }
            call.resolve(["transactions": jwsList, "transactionIds": pendingIds])
        }
    }

    // MARK: - Finish

    /// Mark transactions as delivered. Called by JS ONLY after `/api/iap/verify`
    /// has recorded them, so an interrupted verification is retried rather than
    /// dropped.
    @objc func finishTransactions(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["finished": 0])
            return
        }
        let ids = call.getArray("transactionIds", String.self) ?? []
        guard !ids.isEmpty else {
            call.resolve(["finished": 0])
            return
        }
        let wanted = Set(ids)
        Task {
            var finished = 0
            for await result in Transaction.unfinished {
                if case .verified(let transaction) = result, wanted.contains(String(transaction.id)) {
                    await transaction.finish()
                    finished += 1
                }
            }
            call.resolve(["finished": finished])
        }
    }

    // MARK: - Error mapping

    /// Collapse StoreKit's error zoo into stable, ACTIONABLE codes. Each one has
    /// its own `errors.*` string in the web app, and each one is distinguishable
    /// in server-side telemetry — the previous single `iap_purchase_failed` made
    /// a production failure impossible to diagnose without a device in hand.
    private static func errorCode(_ error: Error, fallback: String) -> String {
        if #available(iOS 15.0, *) {
            if let storeKitError = error as? StoreKitError {
                switch storeKitError {
                case .userCancelled:
                    return "iap_cancelled"
                case .networkError:
                    return "iap_network_error"
                case .notAvailableInStorefront:
                    return "iap_not_available_in_storefront"
                case .notEntitled:
                    return "iap_not_entitled"
                default:
                    return "iap_store_error"
                }
            }
            if let purchaseError = error as? Product.PurchaseError {
                switch purchaseError {
                case .productUnavailable:
                    return "iap_product_unavailable"
                case .purchaseNotAllowed:
                    return "iap_payment_not_allowed"
                case .ineligibleForOffer:
                    return "iap_ineligible_for_offer"
                default:
                    return fallback
                }
            }
        }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            return "iap_network_error"
        }
        if nsError.domain == SKErrorDomain, let skCode = SKError.Code(rawValue: nsError.code) {
            switch skCode {
            case .paymentCancelled:
                return "iap_cancelled"
            case .paymentNotAllowed:
                return "iap_payment_not_allowed"
            case .storeProductNotAvailable:
                return "iap_product_unavailable"
            case .cloudServiceNetworkConnectionFailed:
                return "iap_network_error"
            default:
                return fallback
            }
        }
        return fallback
    }
}
