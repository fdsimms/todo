import SwiftUI
import WidgetKit

// The watch face complication: how many of today's tasks are left, and the
// next one.
//
// It reads what the watch app keeps in the watch's App Group: the snapshot
// (widget_data.json, through the shared TodoWidgetData.swift) and the taps made
// on the watch that the iPhone hasn't applied yet (WatchTaps.swift). It never
// talks to the phone itself. The watch app reloads it whenever either changes,
// including when WatchConnectivity wakes the app in the background, and its own
// timeline covers what changes with no new data: a deferred task arriving, the
// day turning over, the snapshot going stale.

struct ComplicationEntry: TimelineEntry {
    let date: Date
    /// Nil when there is nothing trustworthy to count: no snapshot yet, or a
    /// stale one. Shown as a dash, never as zero.
    let remaining: Int?
    let next: String?
}

struct ComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(date: Date(), remaining: 3, next: "Water the plants")
    }

    func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
        completion(Self.entries(from: Date()).first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ComplicationEntry>) -> Void) {
        // `.never`: every new snapshot and every tap reloads this explicitly,
        // and the entries already run to the snapshot going stale.
        completion(Timeline(entries: Self.entries(from: Date()), policy: .never))
    }

    private static func entries(from now: Date) -> [ComplicationEntry] {
        let snapshot = loadWidgetSnapshot().snapshot
        let local = LocalTapState(WatchTapLog.load())
        let dates = [now] + (snapshot?.changeDates(after: now) ?? [])
        return dates.prefix(50).map { (date: Date) -> ComplicationEntry in
            guard let snapshot, !snapshot.isStale(at: date) else {
                return ComplicationEntry(date: date, remaining: nil, next: nil)
            }
            let open = snapshot.todayRows(at: date).filter { !local.isDone($0) }
            return ComplicationEntry(date: date, remaining: open.count, next: open.first?.title)
        }
    }
}

struct ComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ComplicationEntry

    var body: some View {
        content.containerBackground(for: .widget) { Color.clear }
    }

    private var count: String {
        entry.remaining.map { "\($0)" } ?? "–"
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "checklist")
                        .font(.caption)
                    Text(count)
                        .font(.headline)
                }
            }
        case .accessoryCorner:
            Image(systemName: "checklist")
                .widgetLabel(cornerLabel)
        case .accessoryInline:
            Text(inlineText)
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text(headline)
                    .font(.headline)
                    .widgetAccentable()
                if let next = entry.next {
                    Text(next)
                        .font(.body)
                        .lineLimit(2)
                } else if entry.remaining == nil {
                    Text("Open dundundun on your iPhone")
                        .font(.footnote)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var headline: String {
        guard let remaining = entry.remaining else { return "Today" }
        return remaining == 0 ? "All done today" : "\(remaining) left today"
    }

    private var inlineText: String {
        guard let remaining = entry.remaining else { return "dundundun" }
        return remaining == 1 ? "1 task left" : "\(remaining) tasks left"
    }

    private var cornerLabel: String {
        guard let remaining = entry.remaining else { return "Today" }
        return "\(remaining) left"
    }
}

@main
struct TodoWatchComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodoWatchToday", provider: ComplicationProvider()) { entry in
            ComplicationView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("How many of today's tasks are left, and the next one.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}
