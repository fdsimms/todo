import WidgetKit
import SwiftUI

// The Limits widget: today's food log against each nutrient the person set to
// Stay under in Nutrition, worded by the app (buildWidgetLimits in
// widgetSnapshot.ts) so this file formats no figures of its own.
//
// Home screen only, no lock-screen families, for the Medications widget's
// reason: what somebody ate is health information, and the lock screen is the
// one surface anybody holding the phone can read.

struct LimitsEntry: TimelineEntry {
    let date: Date
    let result: WidgetLoadResult
}

struct LimitsProvider: TimelineProvider {
    func placeholder(in context: Context) -> LimitsEntry {
        LimitsEntry(date: Date(), result: .noSnapshotYet)
    }

    func getSnapshot(in context: Context, completion: @escaping (LimitsEntry) -> Void) {
        completion(LimitsEntry(date: Date(), result: loadWidgetSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LimitsEntry>) -> Void) {
        // Nothing here changes with the clock except the day ending, which
        // empties it (`limitsToday(at:)`); every entry the app logs writes a fresh
        // snapshot and reloads this anyway.
        let now = Date()
        let result = loadWidgetSnapshot()
        var entries = [LimitsEntry(date: now, result: result)]
        if let start = result.snapshot?.nextDayStart.flatMap(isoDate), start > now {
            entries.append(LimitsEntry(date: start, result: result))
        }
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: now) ?? now
        completion(Timeline(entries: entries, policy: .after(next)))
    }
}

struct LimitsWidgetEntryView: View {
    var entry: LimitsProvider.Entry
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.widgetFamily) var family

    private var limits: [WidgetLimit] { entry.result.snapshot?.limitsToday(at: entry.date) ?? [] }

    private var emptyStateMessage: String {
        switch entry.result {
        case .noAppGroupAccess: return "Can’t access shared data (App Group)"
        case .noSnapshotYet: return "Open the app to get started"
        case .decodeFailed: return "Couldn’t read food log data"
        case .success(let snapshot):
            if snapshot.limits == nil { return "Open the app to get started" }
            if snapshot.isLaterDay(at: entry.date) { return "Open the app to see today" }
            return "Set a nutrition target to Stay under to see it here"
        }
    }

    var body: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        // Two rows fit a column: small is one column, medium two.
        let shown = Array(limits.prefix(family == .systemSmall ? 2 : 4))
        let header = WidgetHeaderView(
            palette: palette,
            symbolName: "chart.bar.fill",
            symbolColor: palette.accent,
            title: "Limits",
            countLabel: nil,
            actionURL: nil,
            actionLabel: "Open food log"
        )

        return WidgetFrame(header: header, holdsTop: !shown.isEmpty) {
            Group {
                if shown.isEmpty {
                    WidgetEmptyState(palette: palette, message: emptyStateMessage)
                } else {
                    HStack(alignment: .top, spacing: WidgetLayout.columnGap) {
                        column(Array(shown.prefix(2)), palette: palette)
                        if family != .systemSmall {
                            column(Array(shown.dropFirst(2)), palette: palette)
                        }
                    }
                }
            }
        }
        .widgetURL(foodLogURL)
    }

    private func column(_ rows: [WidgetLimit], palette: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(rows) { limit in
                LimitRowView(limit: limit, palette: palette)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One limit: its name and figures, a bar, and what is left or how far over.
/// The bar follows the Food log's: violet while there is room, orange once
/// close, red past the limit.
struct LimitRowView: View {
    let limit: WidgetLimit
    let palette: WidgetPalette

    private var over: Bool { limit.status == "over" }

    private var tint: Color {
        switch limit.status {
        case "over": return palette.red
        case "near": return palette.orange
        default: return palette.accent
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Text(limit.label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(palette.text)
                    .lineLimit(1)
                    .layoutPriority(1)
                Spacer(minLength: 4)
                Text(limit.value)
                    .font(.system(size: 11))
                    .foregroundColor(palette.textSecondary)
                    .lineLimit(1)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(palette.separator)
                    Capsule()
                        .fill(tint)
                        .frame(width: geo.size.width * CGFloat(min(max(limit.fraction, 0), 1)))
                }
            }
            .frame(height: 4)
            Text(limit.detail)
                .font(.system(size: 11, weight: over ? .semibold : .regular))
                .foregroundColor(over ? palette.red : palette.textSecondary)
                .lineLimit(1)
        }
    }
}

struct TodoLimitsWidget: Widget {
    let kind: String = "TodoLimitsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LimitsProvider()) { entry in
            LimitsWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    WidgetCardBackground()
                }
        }
        .configurationDisplayName("Limits")
        .description("Today’s food log against the nutrients you set to Stay under.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}
