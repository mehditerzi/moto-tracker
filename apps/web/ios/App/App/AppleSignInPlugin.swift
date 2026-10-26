import Foundation
import Capacitor
import AuthenticationServices
import CryptoKit

/// Sign in with Apple, the native way: Apple's own sheet (Face ID / Touch ID,
/// no web page, no redirect).
///
/// The web flow in a WKWebView depends on a Services ID and a return URL being
/// configured exactly right on Apple's side; when they were not, App Review saw
/// Apple's "invalid_client" page and rejected the app. The native flow does not
/// touch any of that — its token is issued for the app's own bundle ID — and it
/// is the experience Apple expects inside an iOS app.
///
/// `signIn()` resolves with the identity token (a JWT for the server to verify)
/// and the SHA-256 of the nonce that was sent, which is what Apple embeds in
/// the token's `nonce` claim. The name and email arrive only on the very first
/// authorisation, so they are passed along when present.
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
    ]

    private var pending: CAPPluginCall?
    private var hashedNonce: String = ""
    /// Held for the life of the request; a local would be released mid-sheet.
    private var controller: ASAuthorizationController?

    @objc func signIn(_ call: CAPPluginCall) {
        let raw = Self.randomNonce()
        let hashed = SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
        DispatchQueue.main.async {
            self.pending = call
            self.hashedNonce = hashed
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = hashed
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        self.controller = nil
        guard let call = pending else { return }
        pending = nil
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            call.reject("apple_no_token")
            return
        }
        var result: [String: Any] = ["identityToken": token, "nonce": hashedNonce, "user": cred.user]
        if let email = cred.email { result["email"] = email }
        if let given = cred.fullName?.givenName { result["givenName"] = given }
        if let family = cred.fullName?.familyName { result["familyName"] = family }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        self.controller = nil
        guard let call = pending else { return }
        pending = nil
        if let e = error as? ASAuthorizationError, e.code == .canceled {
            call.reject("apple_cancelled")
        } else {
            call.reject("apple_failed", nil, error)
        }
    }

    private static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        return String(bytes.map { charset[Int($0) % charset.count] })
    }
}
