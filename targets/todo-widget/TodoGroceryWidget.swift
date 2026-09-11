import WidgetKit
import SwiftUI
import AppIntents

struct GroceryEntry: TimelineEntry {
    let date: Date
    let result: WidgetLoadResult
    let configuration: GroceryWidgetIntent
}

struct GroceryProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> GroceryEntry {
        GroceryEntry(date: Date(), result: .noSnapshotYet, configuration: GroceryWidgetIntent())
    }

    func snapshot(for configuration: GroceryWidgetIntent, in context: Context) async -> GroceryEntry {
        GroceryEntry(date: Date(), result: loadWidgetSnapshot(), configuration: configuration)
    }

    func timeline(for configuration: GroceryWidgetIntent, in context: Context) async -> Timeline<GroceryEntry> {
        let result = loadWidgetSnapshot()
        let entry = GroceryEntry(date: Date(), result: result, configuration: configuration)
        // A trip's elapsed minutes are the one thing here that moves without
        // the app touching anything, so a live trip asks for a tighter refresh
        // than the app's own reload-on-write would give it. Everything else
        // rides the same 15-minute fallback the Today widget uses.
        let minutes = result.snapshot?.groceries?.tripStartedDate == nil ? 15 : 5
        let next = Calendar.current.date(byAdding: .minute, value: minutes, to: Date()) ?? Date()
        return Timeline(entries: [entry], policy: .after(next))
    }
}

struct GroceryWidgetEntryView: View {
    var entry: GroceryProvider.Entry
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.widgetFamily) var family

    private var groceries: WidgetGroceries? { entry.result.snapshot?.groceries }
    private var list: WidgetGroceryList? { groceries?.list(named: entry.configuration.listFilter) }
    private var remaining: Int { list?.remaining ?? 0 }
    private var items: [String] { list?.items ?? [] }

    /// The shop being walked right now, with how long it has been going.
    ///
    /// Rendered from the stamp rather than read as a phrase off the snapshot:
    /// the snapshot is written when the app changes something and the minutes
    /// keep running after that, so a string baked at write time is wrong by the
    /// time anyone looks at the widget.
    private var tripLine: String? {
        guard let groceries, let name = groceries.tripShopName, let started = groceries.tripStartedDate
        else { return nil }
        return "\(name) · \(describeElapsed(since: started, now: entry.date))"
    }

    private var emptyStateMessage: String {
        switch entry.result {
        case .noAppGroupAccess: return "Can't access shared data (App Group)"
        case .noSnapshotYet: return "Open the app to get started"
        case .decodeFailed: return "Couldn't read task data"
        case .success:
            // A grocery store that was never opened and an empty trolley are
            // different answers, and saying "Nothing to buy" for the first one
            // is a claim the widget can't back up.
            return groceries == nil ? "Open the app to get started" : "Nothing to buy"
        }
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(remaining == 0 ? "Nothing to buy" : "\(remaining) to buy")
        case .accessoryCircular:
            AccessoryRing(
                fraction: list?.boughtFraction ?? 0,
                label: "\(remaining)",
                caption: "buy"
            )
        case .accessoryRectangular:
            rectangularView
        default:
            listView
        }
    }

    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(list?.name ?? "Groceries")
                .font(.headline)
                .lineLimit(1)
            if let tripLine {
                Text(tripLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Text(remaining == 0 ? "Nothing to buy" : "\(remaining) to buy")
                .font(.caption)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var listView: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        let perColumn = WidgetLayout.rowsPerColumn(for: family)
        let columns = family == .systemSmall ? 1 : 2
        let shown = Array(items.prefix(perColumn * columns))
        let header = WidgetHeaderView(
            palette: palette,
            symbolName: tripLine == nil ? "cart.fill" : "figure.walk",
            symbolColor: tripLine == nil ? palette.accent : palette.green,
            title: tripLine ?? (list?.name ?? "Groceries"),
            countLabel: items.isEmpty ? nil : "\(remaining)",
            // Straight to the list rather than to a composer: there is no
            // grocery equivalent of quick add behind a URL, and `finish=1`
            // would be a destructive thing to put one tap from a home screen.
            actionURL: nil,
            actionLabel: "Open groceries"
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
        .widgetURL(groceriesURL)
    }

    private func column(_ names: [String], palette: WidgetPalette, rowHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(names, id: \.self) { name in
                WidgetTextRow(
                    palette: palette,
                    title: name,
                    detail: nil,
                    detailColor: nil,
                    bulletColor: palette.separator,
                    height: rowHeight
                )
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TodoGroceryWidget: Widget {
    let kind: String = "TodoGroceryWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: GroceryWidgetIntent.self, provider: GroceryProvider()) { entry in
            GroceryWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(UIColor.secondarySystemGroupedBackground)
                }
        }
        .configurationDisplayName("Groceries")
        .description("What's left to buy, and the shop you're walking.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryRectangular, .accessoryCircular, .accessoryInline,
        ])
        .contentMarginsDisabled()
    }
}
