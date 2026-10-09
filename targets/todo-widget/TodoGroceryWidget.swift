import WidgetKit
import SwiftUI
import AppIntents

struct GroceryEntry: TimelineEntry {
    let date: Date
    let result: WidgetLoadResult
    /// Rows ticked here that the app hasn't applied yet, keyed by
    /// `QueuedQuietTaps.groceryKey`.
    var queuedChecks: Set<String> = []
    let configuration: GroceryWidgetIntent
}

struct GroceryProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> GroceryEntry {
        GroceryEntry(date: Date(), result: .noSnapshotYet, configuration: GroceryWidgetIntent())
    }

    func snapshot(for configuration: GroceryWidgetIntent, in context: Context) async -> GroceryEntry {
        GroceryEntry(
            date: Date(),
            result: loadWidgetSnapshot(),
            queuedChecks: QueuedQuietTaps.load().groceries,
            configuration: configuration
        )
    }

    func timeline(for configuration: GroceryWidgetIntent, in context: Context) async -> Timeline<GroceryEntry> {
        let result = loadWidgetSnapshot()
        let entry = GroceryEntry(
            date: Date(),
            result: result,
            queuedChecks: QueuedQuietTaps.load().groceries,
            configuration: configuration
        )
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
    private var rows: [WidgetGroceryRow] { list?.rows ?? [] }

    private func isQueued(_ row: WidgetGroceryRow) -> Bool {
        guard row.canCheck else { return false }
        return entry.queuedChecks.contains(QueuedQuietTaps.groceryKey(itemId: row.id, listId: list?.id))
    }

    /// Less the rows ticked here and not yet applied. Counted against the rows
    /// on screen, the only ones the widget can tick.
    private var remaining: Int {
        max(0, (list?.remaining ?? 0) - rows.filter { isQueued($0) }.count)
    }

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
        case .noAppGroupAccess: return "Can’t access shared data (App Group)"
        case .noSnapshotYet: return "Open the app to get started"
        case .decodeFailed: return "Couldn’t read grocery data"
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
        let shown = Array(rows.prefix(perColumn * columns))
        let header = WidgetHeaderView(
            palette: palette,
            symbolName: tripLine == nil ? "cart.fill" : "figure.walk",
            symbolColor: tripLine == nil ? palette.accent : palette.green,
            title: tripLine ?? (list?.name ?? "Groceries"),
            countLabel: rows.isEmpty ? nil : "\(remaining)",
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

    /// Rows drawn by position, not by `WidgetGroceryRow.id`: a snapshot from
    /// before ids crossed gives every row the same empty one.
    private func column(_ rows: [WidgetGroceryRow], palette: WidgetPalette, rowHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GroceryRowView(
                    row: row,
                    listId: list?.id,
                    isChecked: isQueued(row),
                    palette: palette,
                    height: rowHeight
                )
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One unbought row. A checkbox puts it in the cart without opening the app
/// (`CheckGroceryItemIntent`), on the list this widget shows; the app applies
/// it the next time it comes forward. A row with nothing the widget can tick
/// (one side of an either/or, or a snapshot with no ids) keeps the plain dot.
struct GroceryRowView: View {
    let row: WidgetGroceryRow
    let listId: String?
    let isChecked: Bool
    let palette: WidgetPalette
    let height: CGFloat

    var body: some View {
        HStack(spacing: 8) {
            if row.canCheck {
                Button(intent: CheckGroceryItemIntent(itemId: row.id, listId: listId)) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .stroke(palette.separator, lineWidth: 2)
                        if isChecked {
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .fill(palette.done)
                            Image(systemName: "checkmark")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(palette.onDone)
                        }
                    }
                    .frame(width: 16, height: 16)
                    // The same widened target as the Today widget's checkbox.
                    .padding(.horizontal, 6)
                    .frame(height: height)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                Circle()
                    .fill(palette.separator)
                    .frame(width: 5, height: 5)
                    // Centred in the checkbox column, so names line up.
                    .frame(width: 28, height: height)
            }
            Text(row.name)
                .font(.system(size: 12))
                .foregroundColor(isChecked ? palette.textTertiary : palette.text)
                .strikethrough(isChecked)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(1)
            Spacer(minLength: 0)
        }
        .frame(height: height)
    }
}

struct TodoGroceryWidget: Widget {
    let kind: String = "TodoGroceryWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: GroceryWidgetIntent.self, provider: GroceryProvider()) { entry in
            GroceryWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    WidgetCardBackground()
                }
        }
        .configurationDisplayName("Groceries")
        .description("What’s left to buy, and the store you’re shopping at.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryRectangular, .accessoryCircular, .accessoryInline,
        ])
        .contentMarginsDisabled()
    }
}
