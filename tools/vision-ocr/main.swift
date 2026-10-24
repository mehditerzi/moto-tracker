// garajim-vision-ocr — Apple Vision text recognition as a tiny local HTTP service.
//
// The API runs in Docker (Linux) and cannot call Vision; this runs on the macOS
// host, keeps the recognition models warm, and answers in ~0.3 s per document.
// No model download, no GPU queue shared with anyone else's LLMs, and nothing
// leaves the machine — the same privacy promise the Ollama path made.
//
//   POST /ocr      body: image bytes (JPEG/PNG/HEIC)  →  {"w","h","ms","lines":[{t,x,y,w,h}]}
//   GET  /health   →  ok
//
// Coordinates are unit (0..1), top-left origin, one entry per recognised line,
// in reading order. Binds 127.0.0.1 only. Port from GARAJIM_OCR_PORT (11470).
import Foundation
import Network
import Vision
import ImageIO

let port = UInt16(ProcessInfo.processInfo.environment["GARAJIM_OCR_PORT"] ?? "11470") ?? 11470
let maxBody = 20 * 1024 * 1024
let queue = DispatchQueue(label: "ocr", qos: .userInitiated, attributes: .concurrent)

func recognize(_ data: Data) -> [String: Any] {
    let t0 = Date()
    guard let src = CGImageSourceCreateWithData(data as CFData, nil),
          let cg = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCache: true] as CFDictionary) else {
        return ["error": "unreadable_image"]
    }
    // Honour EXIF orientation: a phone photo taken in portrait is stored sideways.
    let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
    let raw = (props?[kCGImagePropertyOrientation] as? UInt32) ?? 1
    let orientation = CGImagePropertyOrientation(rawValue: raw) ?? .up

    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    // Plates, VINs and motor numbers are not words; correction "fixes" them.
    req.usesLanguageCorrection = false
    req.recognitionLanguages = ["tr-TR", "en-US"]
    if #available(macOS 13.0, *) { req.automaticallyDetectsLanguage = false }
    do {
        try VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:]).perform([req])
    } catch {
        return ["error": "vision_failed", "detail": "\(error)"]
    }
    let lines: [[String: Any]] = (req.results ?? []).compactMap { o in
        guard let s = o.topCandidates(1).first?.string else { return nil }
        let r = o.boundingBox
        return ["t": s, "x": r.minX, "y": 1 - r.maxY, "w": r.width, "h": r.height]
    }.sorted { a, b in
        let ay = a["y"] as! CGFloat, by = b["y"] as! CGFloat
        if abs(ay - by) > 0.012 { return ay < by }
        return (a["x"] as! CGFloat) < (b["x"] as! CGFloat)
    }
    let upright = orientation.rawValue >= 5 // 90°/270°: width and height swap
    return [
        "w": upright ? cg.height : cg.width,
        "h": upright ? cg.width : cg.height,
        "ms": Int(Date().timeIntervalSince(t0) * 1000),
        "lines": lines,
    ]
}

func respond(_ c: NWConnection, _ status: String, _ body: Data, _ type: String = "application/json") {
    var head = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
    head += ""
    c.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in c.cancel() })
}

func handle(_ c: NWConnection) {
    var buffer = Data()
    func receive() {
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { data, _, done, err in
            if let data { buffer.append(data) }
            if buffer.count > maxBody + 8192 { respond(c, "413 Payload Too Large", Data()); return }
            guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
                if done || err != nil { c.cancel() } else { receive() }
                return
            }
            let header = String(decoding: buffer[..<headerEnd.lowerBound], as: UTF8.self)
            let firstLine = header.split(separator: "\r\n").first.map(String.init) ?? ""
            let length = header.split(separator: "\r\n")
                .first { $0.lowercased().hasPrefix("content-length:") }
                .flatMap { Int($0.split(separator: ":")[1].trimmingCharacters(in: .whitespaces)) } ?? 0
            let body = buffer[headerEnd.upperBound...]
            if firstLine.hasPrefix("GET /health") { respond(c, "200 OK", Data("ok".utf8), "text/plain"); return }
            guard firstLine.hasPrefix("POST /ocr") else { respond(c, "404 Not Found", Data()); return }
            if body.count < length {
                if done || err != nil { c.cancel() } else { receive() }
                return
            }
            queue.async {
                let result = recognize(Data(body.prefix(length)))
                let json = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
                respond(c, result["error"] == nil ? "200 OK" : "422 Unprocessable Entity", json)
            }
        }
    }
    receive()
}

let params = NWParameters.tcp
params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
let listener = try NWListener(using: params)
listener.newConnectionHandler = { c in
    c.start(queue: queue)
    handle(c)
}
listener.stateUpdateHandler = { state in
    if case .failed(let e) = state { FileHandle.standardError.write(Data("listener failed: \(e)\n".utf8)); exit(1) }
    if case .ready = state { print("garajim-vision-ocr listening on 127.0.0.1:\(port)") }
}
listener.start(queue: queue)
// Warm the models so the first real scan is not the slow one.
queue.async {
    let ctx = CGContext(data: nil, width: 64, height: 32, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    ctx.setFillColor(gray: 1, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: 64, height: 32))
    let req = VNRecognizeTextRequest()
    try? VNImageRequestHandler(cgImage: ctx.makeImage()!, options: [:]).perform([req])
}
dispatchMain()
