import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Register for remote (push) notifications on launch.
        // The actual permission prompt is handled by the Capacitor Push Notifications plugin
        // when your web app calls PushNotifications.requestPermissions().
        return true
    }

    // MARK: - App Lifecycle

    func applicationWillResignActive(_ application: UIApplication) {}

    func applicationDidEnterBackground(_ application: UIApplication) {}

    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {}

    func applicationWillTerminate(_ application: UIApplication) {}

    // MARK: - URL / Universal Links

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Forwards URL opens to Capacitor's App plugin for deep link / URL scheme support.
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication,
                     continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Forwards Universal Links to Capacitor's App plugin.
        return ApplicationDelegateProxy.shared.application(application,
                                                           continue: userActivity,
                                                           restorationHandler: restorationHandler)
    }

    // MARK: - Remote Notifications (APNs)

    /// Called when APNs successfully registers the device and provides a token.
    /// Capacitor's Push Notifications plugin picks this up automatically via swizzling,
    /// but we forward it explicitly for safety.
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    /// Called when APNs registration fails (e.g., running on Simulator, no entitlement).
    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }
}
