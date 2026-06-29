import WidgetKit
import SwiftUI

// "Next deadline at a glance" widget. Reads the JSON the app writes via
// WidgetBridgePlugin into the shared App Group. See docs/ios-widget.md.

private let appGroup = "group.com.mehditerzi.mototracker"

struct Deadline: Codable {
    let label: String
    let date: String
    let vehicle: String
    let daysRemaining: Int
}

struct DeadlineEntry: TimelineEntry {
    let date: Date
    let deadline: Deadline?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> DeadlineEntry {
        DeadlineEntry(
            date: Date(),
            deadline: Deadline(label: "Muayene", date: "2026-11-04", vehicle: "Monster", daysRemaining: 12)
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (DeadlineEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DeadlineEntry>) -> Void) {
        // The app reloads the timeline whenever data changes; this is a fallback
        // refresh so day-counts stay roughly current.
        let next = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date()
        completion(Timeline(entries: [loadEntry()], policy: .after(next)))
    }

    private func loadEntry() -> DeadlineEntry {
        let raw = UserDefaults(suiteName: appGroup)?.string(forKey: "nextDeadline")
        var deadline: Deadline?
        if let raw, raw != "null", let data = raw.data(using: .utf8) {
            deadline = try? JSONDecoder().decode(Deadline.self, from: data)
        }
        return DeadlineEntry(date: Date(), deadline: deadline)
    }
}

struct GarajimWidgetEntryView: View {
    var entry: DeadlineEntry

    var body: some View {
        if let d = entry.deadline {
            VStack(alignment: .leading, spacing: 4) {
                Text(d.vehicle).font(.caption2).foregroundColor(.secondary).lineLimit(1)
                Text(d.label).font(.headline).lineLimit(1)
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text("\(d.daysRemaining)").font(.system(size: 28, weight: .bold))
                    Text("gün").font(.caption).foregroundColor(.secondary)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else {
            VStack(spacing: 2) {
                Text("Garajım").font(.headline)
                Text("Yaklaşan tarih yok").font(.caption).foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

@main
struct GarajimWidget: Widget {
    let kind = "GarajimWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                GarajimWidgetEntryView(entry: entry)
                    .containerBackground(.fill.tertiary, for: .widget)
            } else {
                GarajimWidgetEntryView(entry: entry)
            }
        }
        .configurationDisplayName("Garajım")
        .description("Yaklaşan muayene / sigorta / vergi tarihi.")
        .supportedFamilies([.systemSmall])
    }
}
