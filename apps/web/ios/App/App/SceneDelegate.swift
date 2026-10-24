import UIKit
import Capacitor

/// The app's one window, created the UIScene way.
///
/// iOS/iPadOS 27 turned "app does not adopt the UIScene lifecycle" from a
/// console warning into an assert: build 13 of 1.4 crashed on launch in App
/// Review (iPad Air M3, iPadOS 27.0) inside
/// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, before a
/// single line of our code ran. Every pre-1.4 binary has the same problem on
/// iOS 27. The window therefore lives here now, not in AppDelegate, and
/// Info.plist declares this class in UIApplicationSceneManifest.
///
/// Under scenes UIKit delivers URL opens and user activities to the SCENE, not
/// to `application(_:open:options:)`, so both are forwarded to Capacitor's
/// ApplicationDelegateProxy — that is what keeps `appUrlOpen` (and with it the
/// Sign in with Apple / magic-link return) working.
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        // Built in code, not from a storyboard — see the note that used to live
        // in AppDelegate: a compile-time reference fails the build, a storyboard
        // class name fails at launch.
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = MainViewController()
        window.makeKeyAndVisible()
        self.window = window
        // Some plugins still look for the window on the app delegate.
        (UIApplication.shared.delegate as? AppDelegate)?.window = window

        // A cold launch from a link or an activity arrives in the options.
        for context in connectionOptions.urlContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
        for activity in connectionOptions.userActivities {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity) { _ in }
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
            if let source = context.options.sourceApplication { options[.sourceApplication] = source }
            options[.openInPlace] = context.options.openInPlace
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity) { _ in }
    }
}
