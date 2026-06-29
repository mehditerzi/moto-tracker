import Foundation
import Capacitor
import WidgetKit

/// Custom Capacitor plugin: lets the web app hand the "next deadline" to the
/// home-screen widget. Writes JSON into the shared App Group and reloads the
/// widget timeline. Called from apps/web/src/lib/widget.ts (native only).
///
/// SETUP (see docs/ios-widget.md): add this file to the App target, and add the
/// App Group capability `group.com.mehditerzi.mototracker` to BOTH the App and
/// the widget targets.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setNextDeadline", returnType: CAPPluginReturnPromise)
    ]

    static let appGroup = "group.com.mehditerzi.mototracker"
    static let key = "nextDeadline"

    @objc func setNextDeadline(_ call: CAPPluginCall) {
        let data = call.getString("data") ?? "null"
        UserDefaults(suiteName: WidgetBridgePlugin.appGroup)?.set(data, forKey: WidgetBridgePlugin.key)
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }
}
