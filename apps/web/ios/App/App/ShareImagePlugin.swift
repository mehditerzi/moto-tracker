import Foundation
import Capacitor
import UIKit

/// The system share sheet for an image the web layer rendered (a ride or
/// stats card): Instagram Stories, WhatsApp, Messages, Save Image — whatever
/// the phone has. `navigator.share({ files })` is not reliable inside
/// WKWebView, and a long-press "Save" is not a share flow.
///
/// share({ image: base64 PNG/JPEG, text?: String, url?: String }) → { completed, activity? }
///
/// "Save Image" writes to the photo library, which is why Info.plist carries
/// NSPhotoLibraryAddUsageDescription — without it that one tap crashes the app.
@objc(ShareImagePlugin)
public class ShareImagePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareImagePlugin"
    public let jsName = "ShareImage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
    ]

    @objc func share(_ call: CAPPluginCall) {
        guard let b64 = call.getString("image"),
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data) else {
            call.reject("share_bad_image")
            return
        }
        var items: [Any] = [image]
        if let text = call.getString("text"), !text.isEmpty { items.append(text) }
        if let link = call.getString("url"), let url = URL(string: link) { items.append(url) }

        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("share_no_window")
                return
            }
            let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
            vc.completionWithItemsHandler = { activity, completed, _, error in
                if let error = error {
                    call.reject("share_failed", nil, error)
                    return
                }
                call.resolve(["completed": completed, "activity": activity?.rawValue ?? ""])
            }
            // iPad presents the sheet as a popover; it needs an anchor or UIKit
            // throws. The bottom centre of the web view is where the button is.
            if let pop = vc.popoverPresentationController {
                pop.sourceView = presenter.view
                let b = presenter.view.bounds
                pop.sourceRect = CGRect(x: b.midX, y: b.maxY - 80, width: 1, height: 1)
                pop.permittedArrowDirections = [.down]
            }
            presenter.present(vc, animated: true)
        }
    }
}
