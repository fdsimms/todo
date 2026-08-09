import WidgetKit
import SwiftUI
import AppIntents

struct TodoEntry: TimelineEntry {
    let date: Date
    let result: WidgetLoadResult
    let pendingCompletionIds: Set<String>
}

struct TodoTodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodoEntry {
        TodoEntry(date: Date(), result: .noSnapshotYet, pendingCompletionIds: [])
    }

    func getSnapshot(in context: Context, completion: @escaping (TodoEntry) -> Void) {
        completion(TodoEntry(date: Date(), result: loadWidgetSnapshot(), pendingCompletionIds: loadPendingCompletionIds()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodoEntry>) -> Void) {
        let entry = TodoEntry(date: Date(), result: loadWidgetSnapshot(), pendingCompletionIds: loadPendingCompletionIds())
        // The app calls WidgetCenter.reloadAllTimelines() after every task
        // mutation (and CompleteTaskIntent does the same), so this fallback
        // only matters if the app hasn't been opened in a while.
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

// Every fixed measurement the layout is built from. They're collected here
// because they have to add up: the grid is what's left after the header and
// the padding are taken out of the widget's height, so changing one without
// looking at the rest is how rows end up clipped off the bottom edge again.
private enum WidgetLayout {
    /// Own padding, in place of the container margins the widget opts out of.
    static let horizontalPadding: CGFloat = 14
    static let topPadding: CGFloat = 12
    static let bottomPadding: CGFloat = 12
    /// The header's own height — the add button, the tallest thing in it.
    static let headerHeight: CGFloat = 22
    /// Gap between the header and the first row of tasks.
    static let headerGap: CGFloat = 8
    /// Gap between the two task columns.
    static let columnGap: CGFloat = 6
    static let rowsPerColumn = 4
    /// A row can't go below the checkbox plus a hairline, or grow tall enough
    /// on a big device that the grid stops reading as a grid.
    static let minRowHeight: CGFloat = 22
    static let maxRowHeight: CGFloat = 30

    /// Splits whatever height is left after the header and padding into
    /// `rowsPerColumn` equal slots. Measured rather than hardcoded because a
    /// medium widget is ~141pt tall on a 4" phone and ~170pt on a Max — a
    /// single row height that fits the tallest clips the shortest.
    static func rowHeight(forWidgetHeight height: CGFloat) -> CGFloat {
        let available = height - topPadding - bottomPadding - headerHeight - headerGap
        return min(maxRowHeight, max(minRowHeight, available / CGFloat(rowsPerColumn)))
    }
}

struct TaskRowView: View {
    let task: WidgetTask
    let palette: WidgetPalette
    let isPendingCompletion: Bool
    let height: CGFloat

    var body: some View {
        HStack(spacing: 8) {
            Button(intent: CompleteTaskIntent(taskId: task.id)) {
                ZStack {
                    // Rounded square, matching the app's checkbox — .continuous
                    // is the same superellipse RN draws with borderCurve.
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .stroke(palette.separator, lineWidth: 2)
                    if isPendingCompletion {
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(palette.accent)
                        Image(systemName: "checkmark")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
                .frame(width: 16, height: 16)
                // Padding here (not on the row) widens the actual tap target
                // beyond the visible box without affecting layout. Vertically
                // it takes the whole row rather than a fixed inset, so the
                // target doesn't shrink with the row on a smaller device.
                .padding(.horizontal, 6)
                .frame(height: height)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Text(task.title)
                .font(.system(size: 12))
                .foregroundColor(isPendingCompletion ? palette.textTertiary : palette.text)
                .strikethrough(isPendingCompletion)
                .lineLimit(1)
                .truncationMode(.tail)

            if task.pinned && !isPendingCompletion {
                Image(systemName: "pin.fill")
                    .foregroundColor(Color(hex: "FF9F0A"))
                    .font(.system(size: 8))
            }

            Spacer(minLength: 0)
        }
        .frame(height: height)
    }
}

// Opens the app straight into quick add — `dundundun://add` with no title,
// handled by isQuickAddUrl in src/utils/deepLinks.ts.
private let quickAddURL = URL(string: "dundundun://add")!

struct WidgetHeaderView: View {
    let palette: WidgetPalette
    let countLabel: String?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "sun.max.fill")
                .foregroundColor(Color(hex: "FF9F0A"))
                .font(.system(size: 12))
            Text("Today")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(palette.textSecondary)

            Spacer(minLength: 8)

            if let countLabel {
                Text(countLabel)
                    .font(.system(size: 12))
                    .foregroundColor(palette.textSecondary)
            }

            // A Link rather than an AppIntent: there's nothing for the
            // extension to do on its own, the whole point is to land in the
            // app's composer. Sized to the header so the header's height
            // never depends on which of these pieces is showing.
            Link(destination: quickAddURL) {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: WidgetLayout.headerHeight, height: WidgetLayout.headerHeight)
                    .background(Circle().fill(palette.accent))
                    .contentShape(Circle())
            }
            // Home Screen's tinted/monochrome appearance strips widget colors
            // down to a single tone unless a view opts back in — without this,
            // the accent-filled circle and the white plus glyph both render as
            // the same flat tint and the plus disappears into its own button.
            .widgetAccentable()
            .accessibilityLabel("Add task")
        }
        .frame(height: WidgetLayout.headerHeight)
    }
}

struct TodoTodayWidgetEntryView: View {
    var entry: TodoTodayProvider.Entry
    @Environment(\.colorScheme) var colorScheme

    var emptyStateMessage: String {
        switch entry.result {
        case .noAppGroupAccess: return "Can't access shared data (App Group)"
        case .noSnapshotYet: return "Open the app to get started"
        case .decodeFailed: return "Couldn't read task data"
        case .success: return "All clear"
        }
    }

    var body: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        let snapshot: WidgetSnapshot? = {
            if case .success(let snapshot) = entry.result { return snapshot }
            return nil
        }()
        let allTasks = snapshot?.visibleTasks ?? []
        let perColumn = WidgetLayout.rowsPerColumn
        // Two columns of up to `perColumn` rows each.
        let shown = Array(allTasks.prefix(perColumn * 2))
        let leftColumn = Array(shown.prefix(perColumn))
        let rightColumn = Array(shown.dropFirst(perColumn))
        let remaining = max(0, allTasks.count - entry.pendingCompletionIds.count)

        GeometryReader { geo in
            let rowHeight = WidgetLayout.rowHeight(forWidgetHeight: geo.size.height)
            // The grid keeps all four slots whether or not they're filled, so
            // a two-task day and an eight-task day put the header, the first
            // row and the bottom edge in exactly the same places.
            let gridHeight = rowHeight * CGFloat(perColumn)

            VStack(alignment: .leading, spacing: 0) {
                // First child of the VStack, not an overlay sibling: there is
                // then nothing below it that can push it down.
                WidgetHeaderView(
                    palette: palette,
                    countLabel: allTasks.isEmpty ? nil
                        : (remaining == 1 ? "1 task" : "\(remaining) tasks")
                )

                Group {
                    if shown.isEmpty {
                        Text(emptyStateMessage)
                            .font(.system(size: 13))
                            .foregroundColor(palette.textTertiary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .frame(height: gridHeight)
                    } else {
                        // Both columns are always laid out, even when the
                        // right one is empty — otherwise the left column is
                        // full-width on a light day and half-width on a busy
                        // one, and titles truncate at a different point in
                        // each. Same reason the grid keeps its empty slots.
                        HStack(alignment: .top, spacing: WidgetLayout.columnGap) {
                            columnView(leftColumn, palette: palette, rowHeight: rowHeight)
                            columnView(rightColumn, palette: palette, rowHeight: rowHeight)
                        }
                        .frame(height: gridHeight, alignment: .top)
                    }
                }
                .padding(.top, WidgetLayout.headerGap)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, WidgetLayout.horizontalPadding)
            .padding(.top, WidgetLayout.topPadding)
            .padding(.bottom, WidgetLayout.bottomPadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .widgetURL(URL(string: "dundundun://"))
    }

    /// One half of the grid. Always half-width and always the grid's full
    /// height, however few rows it holds.
    private func columnView(
        _ tasks: [WidgetTask],
        palette: WidgetPalette,
        rowHeight: CGFloat
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(tasks) { task in
                TaskRowView(
                    task: task,
                    palette: palette,
                    isPendingCompletion: entry.pendingCompletionIds.contains(task.id),
                    height: rowHeight
                )
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TodoTodayWidget: Widget {
    let kind: String = "TodoTodayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodoTodayProvider()) { entry in
            TodoTodayWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(UIColor.secondarySystemGroupedBackground)
                }
        }
        .configurationDisplayName("Today")
        .description("Your tasks for today.")
        .supportedFamilies([.systemMedium])
        // The default container margins are ~16pt a side, and a medium widget
        // is only ~155pt tall — a header plus four rows doesn't fit inside
        // what's left, which is why the bottom row used to run off the edge.
        // Reclaiming them and paying the padding back explicitly (see
        // WidgetLayout) is what buys the bottom gutter.
        .contentMarginsDisabled()
    }
}
