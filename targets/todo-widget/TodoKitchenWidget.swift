import WidgetKit
import SwiftUI
import AppIntents

struct KitchenEntry: TimelineEntry {
    let date: Date
    let result: WidgetLoadResult
    let configuration: KitchenWidgetIntent
}

struct KitchenProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> KitchenEntry {
        KitchenEntry(date: Date(), result: .noSnapshotYet, configuration: KitchenWidgetIntent())
    }

    func snapshot(for configuration: KitchenWidgetIntent, in context: Context) async -> KitchenEntry {
        KitchenEntry(date: Date(), result: loadWidgetSnapshot(), configuration: configuration)
    }

    func timeline(for configuration: KitchenWidgetIntent, in context: Context) async -> Timeline<KitchenEntry> {
        let entry = KitchenEntry(date: Date(), result: loadWidgetSnapshot(), configuration: configuration)
        // Everything on this widget is dated to a *day*, so the one thing that
        // changes it unprompted is the day rolling over. Refreshing at the next
        // midnight rather than on a fixed interval is what stops "Today" still
        // reading Today at ten past one in the morning.
        let midnight = Calendar.current.nextDate(
            after: Date(),
            matching: DateComponents(hour: 0, minute: 1),
            matchingPolicy: .nextTime
        ) ?? Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        return Timeline(entries: [entry], policy: .after(midnight))
    }
}

/// One line on the widget, from either half of it.
///
/// **The two halves need telling apart on sight**, which is what `isMeal` is
/// for. In "Both" mode a meal and a use-up row are the same shape — a name and
/// a short word on the right — so "Spinach · Yesterday" sitting under
/// "Overnight oats · Breakfast" reads as a meal somebody missed rather than as
/// a bag of spinach about to go off. The bullet is what separates them, and it
/// is the cheapest thing on the row that can.
private struct KitchenLine: Identifiable {
    let id: String
    let title: String
    let detail: String?
    let isMeal: Bool
    /// Red once a use-by has already passed, so "2 days ago" isn't the only
    /// thing saying so — a date in the past is the whole reason this row is
    /// worth a home-screen slot.
    let overdue: Bool
}

struct KitchenWidgetEntryView: View {
    var entry: KitchenProvider.Entry
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.widgetFamily) var family

    private var meals: [WidgetMeal] { entry.result.snapshot?.meals ?? [] }
    private var useUp: [WidgetKitchenItem] { entry.result.snapshot?.kitchen ?? [] }

    private var showsMeals: Bool { entry.configuration.mode != .useUp }
    private var showsUseUp: Bool { entry.configuration.mode != .meals }

    private var lines: [KitchenLine] {
        var out: [KitchenLine] = []
        if showsMeals {
            out += meals.map {
                KitchenLine(
                    id: "meal:" + $0.id,
                    title: $0.title,
                    detail: $0.slotLabel,
                    isMeal: true,
                    overdue: false
                )
            }
        }
        if showsUseUp {
            out += useUp.map { item in
                KitchenLine(
                    id: "use:" + item.id,
                    title: item.title,
                    detail: describeUseBy(item.useBy, now: entry.date),
                    isMeal: false,
                    overdue: isPast(item.useBy)
                )
            }
        }
        return out
    }

    private func isPast(_ key: String?) -> Bool {
        guard let key, let date = dayKeyDate(key) else { return false }
        let calendar = Calendar.current
        return calendar.startOfDay(for: date) < calendar.startOfDay(for: entry.date)
    }

    private var title: String {
        switch entry.configuration.mode {
        case .meals: return "Today's meals"
        case .useUp: return "Use up soon"
        case .both: return "Kitchen"
        }
    }

    private var emptyStateMessage: String {
        switch entry.result {
        case .noAppGroupAccess: return "Can't access shared data (App Group)"
        case .noSnapshotYet: return "Open the app to get started"
        case .decodeFailed: return "Couldn't read task data"
        case .success:
            switch entry.configuration.mode {
            case .meals: return "Nothing planned today"
            case .useUp: return "Nothing needs using up"
            case .both: return "Nothing planned, nothing to use up"
            }
        }
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(inlineText)
        case .accessoryRectangular:
            rectangularView
        default:
            listView
        }
    }

    private var inlineText: String {
        if showsMeals, let next = meals.first { return "\(next.slotLabel): \(next.title)" }
        if showsUseUp, let first = useUp.first { return "Use up \(first.title)" }
        return "Nothing planned"
    }

    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.headline)
                .lineLimit(1)
            ForEach(lines.prefix(2)) { line in
                Text(line.detail == nil ? line.title : "\(line.title) · \(line.detail!)")
                    .font(.caption)
                    .lineLimit(1)
            }
            if lines.isEmpty {
                Text(emptyStateMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var listView: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        let perColumn = WidgetLayout.rowsPerColumn(for: family)
        let columns = family == .systemSmall ? 1 : 2
        let shown = Array(lines.prefix(perColumn * columns))
        let header = WidgetHeaderView(
            palette: palette,
            symbolName: entry.configuration.mode == .useUp ? "clock.badge.exclamationmark" : "fork.knife",
            symbolColor: entry.configuration.mode == .useUp ? palette.orange : palette.green,
            title: title,
            countLabel: nil,
            actionURL: nil,
            actionLabel: "Open kitchen"
        )

        return GeometryReader { geo in
            let rowHeight = WidgetLayout.rowHeight(forWidgetHeight: geo.size.height, rows: perColumn)
            let gridHeight = rowHeight * CGFloat(perColumn)

            WidgetFrame(header: header, holdsTop: !shown.isEmpty) {
                Group {
                    if shown.isEmpty {
                        WidgetEmptyState(palette: palette, message: emptyStateMessage)
                    } else {
                        HStack(alignment: .top, spacing: WidgetLayout.columnGap) {
                            column(Array(shown.prefix(perColumn)), palette: palette, rowHeight: rowHeight)
                            if columns > 1 {
                                column(Array(shown.dropFirst(perColumn)), palette: palette, rowHeight: rowHeight)
                            }
                        }
                        .frame(height: gridHeight, alignment: .top)
                    }
                }
            }
        }
        // The meal plan when that's all this shows, the pantry otherwise — a
        // tap should land where the thing it just showed you lives.
        .widgetURL(entry.configuration.mode == .meals ? mealPlanURL : kitchenURL)
    }

    private func bulletColor(for row: KitchenLine, palette: WidgetPalette) -> Color? {
        guard entry.configuration.mode == .both else { return nil }
        if row.isMeal { return palette.green }
        return row.overdue ? palette.red : palette.orange
    }

    private func column(
        _ rows: [KitchenLine],
        palette: WidgetPalette,
        rowHeight: CGFloat
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                WidgetTextRow(
                    palette: palette,
                    title: row.title,
                    detail: row.detail,
                    detailColor: row.overdue ? palette.red : nil,
                    // Green for a meal, orange for something to use up, red
                    // once that has already run out. Only drawn in "Both" mode:
                    // on a widget showing one kind there is nothing to tell
                    // apart, and a column of identical dots is just noise.
                    bulletColor: bulletColor(for: row, palette: palette),
                    height: rowHeight
                )
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TodoKitchenWidget: Widget {
    let kind: String = "TodoKitchenWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: KitchenWidgetIntent.self, provider: KitchenProvider()) { entry in
            KitchenWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(UIColor.secondarySystemGroupedBackground)
                }
        }
        .configurationDisplayName("Kitchen")
        .description("What you planned to eat, and what needs using up.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryRectangular, .accessoryInline,
        ])
        .contentMarginsDisabled()
    }
}
