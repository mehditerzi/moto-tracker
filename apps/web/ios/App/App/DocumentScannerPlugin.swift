import Foundation
import Capacitor
import UIKit
import Vision
import VisionKit

/// The system document scanner, with the reading done on the phone.
///
/// `scan()` opens VisionKit's VNDocumentCameraViewController: it finds the
/// card's edges, fires the shutter by itself when the card is steady, corrects
/// the perspective, and lets the user keep going — one card after another — in
/// a single session. That is the "point it, done, next" capture the web
/// viewfinder could never do.
///
/// Every page is then read by Apple Vision on-device (≈0.2–0.4 s each, in
/// parallel with nothing else) and returned as a JPEG plus the recognised
/// lines WITH their positions. The app sends both; the server's layout reader
/// turns the lines into fields in milliseconds, so the review screen opens
/// already filled in. The photo still travels — it is the record — but no OCR
/// has to run on the server at all.
///
/// Result: { pages: [{ image: base64 JPEG, width, height, ms, lines: [{t,x,y,w,h}] }], cancelled }
/// Coordinates are unit (0..1), top-left origin, in reading order.
@objc(DocumentScannerPlugin)
public class DocumentScannerPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "DocumentScannerPlugin"
    public let jsName = "DocumentScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise),
    ]

    private var pending: CAPPluginCall?
    /// Long edge of the JPEG we hand back — the server keeps 1024 px greyscale
    /// for OCR records anyway; this leaves headroom for the glovebox and zoom.
    private let maxEdge: CGFloat = 2200

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": VNDocumentCameraViewController.isSupported])
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("scanner_unsupported")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("scanner_no_window")
                return
            }
            self.pending = call
            let vc = VNDocumentCameraViewController()
            vc.delegate = self
            presenter.present(vc, animated: true)
        }
    }

    /// OCR an image the user picked from the gallery (base64 JPEG/PNG in, lines out).
    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("image"), let data = Data(base64Encoded: b64), let img = UIImage(data: data) else {
            call.reject("recognize_bad_image")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let page = Self.read(img)
            call.resolve(["width": page.size.width, "height": page.size.height, "ms": page.ms, "lines": page.lines])
        }
    }

    // MARK: - VNDocumentCameraViewControllerDelegate

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let images = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
        controller.dismiss(animated: true)
        guard let call = pending else { return }
        pending = nil
        DispatchQueue.global(qos: .userInitiated).async {
            // Pages are read concurrently: a five-card session costs about one card.
            var pages = [[String: Any]](repeating: [:], count: images.count)
            let lock = NSLock()
            DispatchQueue.concurrentPerform(iterations: images.count) { i in
                let scaled = Self.scaled(images[i], maxEdge: self.maxEdge)
                let page = Self.read(scaled)
                let jpeg = scaled.jpegData(compressionQuality: 0.82) ?? Data()
                let entry: [String: Any] = [
                    "image": jpeg.base64EncodedString(),
                    "width": scaled.size.width * scaled.scale,
                    "height": scaled.size.height * scaled.scale,
                    "ms": page.ms,
                    "lines": page.lines,
                ]
                lock.lock()
                pages[i] = entry
                lock.unlock()
            }
            call.resolve(["pages": pages, "cancelled": false])
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        pending?.resolve(["pages": [], "cancelled": true])
        pending = nil
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        pending?.reject("scanner_failed", nil, error)
        pending = nil
    }

    // MARK: - Vision

    private struct Page {
        let lines: [[String: Any]]
        let ms: Int
        let size: CGSize
    }

    private static func read(_ image: UIImage) -> Page {
        let t0 = Date()
        guard let cg = image.cgImage else { return Page(lines: [], ms: 0, size: .zero) }
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        // Plates, VINs and motor numbers are not words; correction "fixes" them.
        req.usesLanguageCorrection = false
        if #available(iOS 16.0, *) {
            req.automaticallyDetectsLanguage = false
        }
        let supported = (try? req.supportedRecognitionLanguages()) ?? []
        req.recognitionLanguages = ["tr-TR", "en-US"].filter { supported.contains($0) }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        try? VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:]).perform([req])
        let lines: [[String: Any]] = (req.results ?? []).compactMap { o in
            guard let s = o.topCandidates(1).first?.string else { return nil }
            let r = o.boundingBox
            return ["t": s, "x": r.minX, "y": 1 - r.maxY, "w": r.width, "h": r.height]
        }.sorted { a, b in
            let ay = a["y"] as! CGFloat, by = b["y"] as! CGFloat
            if abs(ay - by) > 0.012 { return ay < by }
            return (a["x"] as! CGFloat) < (b["x"] as! CGFloat)
        }
        return Page(lines: lines, ms: Int(Date().timeIntervalSince(t0) * 1000), size: image.size)
    }

    private static func scaled(_ image: UIImage, maxEdge: CGFloat) -> UIImage {
        let w = image.size.width * image.scale, h = image.size.height * image.scale
        let k = min(1, maxEdge / max(w, h))
        if k >= 1 && image.imageOrientation == .up { return image }
        let size = CGSize(width: (w * k).rounded(), height: (h * k).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}

private extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
