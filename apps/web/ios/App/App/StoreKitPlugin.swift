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
/// SETUP: add this file to the App target. Add the In-App Purchase capability to
/// the App target, and create the auto-renewable subscription products in App
/// Store Connect (see docs/ios-iap.md).
@objc(StoreKitPlugin)
public class StoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPlugin"
    public let jsName = "StoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
    ]

    /// Keep StoreKit happy by finishing transactions that arrive out-of-band
    /// (e.g. a renewal or an Ask-to-Buy approval while the app is running). The
    /// server webhook is the source of truth for entitlement, so here we only
    /// need to mark them finished.
    private var updatesTask: Task<Void, Never>?

    override public func load() {
        if #available(iOS 15.0, *) {
            updatesTask = Task.detached { [weak self] in
                guard self != nil else { return }
                for await update in Transaction.updates {
                    if case .verified(let transaction) = update {
                        await transaction.finish()
                    }
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    @objc func getProducts(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("iap_unsupported_os")
            return
        }
        guard let ids = call.getArray("productIds", String.self), !ids.isEmpty else {
            call.reject("productIds required")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: ids)
                let payload = products.map { product in
                    [
                        "id": product.id,
                        "displayName": product.displayName,
                        // Localized, currency-formatted for the user's storefront.
                        "displayPrice": product.displayPrice,
                    ]
                }
                call.resolve(["products": payload])
            } catch {
                call.reject("iap_products_failed", nil, error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("iap_unsupported_os")
            return
        }
        guard let productId = call.getString("productId") else {
            call.reject("productId required")
            return
        }
        // A UUID from our backend, echoed back in Apple's transactions/notifications
        // so the server can attribute renewals to this user.
        var purchaseOptions: Set<Product.PurchaseOption> = []
        if let tokenStr = call.getString("appAccountToken"), let uuid = UUID(uuidString: tokenStr) {
            purchaseOptions.insert(.appAccountToken(uuid))
        }
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    call.reject("product_not_found")
                    return
                }
                let result = try await product.purchase(options: purchaseOptions)
                switch result {
                case .success(let verification):
                    // Send the raw signed JWS to the backend regardless of the
                    // local verification result — the server does the real check.
                    let jws = verification.jwsRepresentation
                    if case .verified(let transaction) = verification {
                        await transaction.finish()
                    }
                    call.resolve(["transactions": [jws]])
                case .userCancelled:
                    call.resolve(["transactions": []])
                case .pending:
                    // Deferred (e.g. Ask to Buy). Resolve empty; the webhook /
                    // next launch reconciles once it's approved.
                    call.resolve(["transactions": []])
                @unknown default:
                    call.resolve(["transactions": []])
                }
            } catch {
                call.reject("iap_purchase_failed", nil, error)
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("iap_unsupported_os")
            return
        }
        Task {
            // currentEntitlements reflects the signed-in Apple ID's active
            // subscriptions across devices — no prompt, no AppStore.sync() needed.
            var jwsList: [String] = []
            for await result in Transaction.currentEntitlements {
                jwsList.append(result.jwsRepresentation)
            }
            call.resolve(["transactions": jwsList])
        }
    }
}
