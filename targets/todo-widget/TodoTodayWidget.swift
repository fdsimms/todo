import WidgetKit
import SwiftUI
import AppIntents

struct TodoEntry: TimelineEntry {
    let date: Date
    let result: WidgetLoadResult
    let pendingCompletionIds: Set<String>
    let configuration: TodayWidgetIntent
}

struct TodoTodayProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TodoEntry {
        TodoEntry(
            date: Date(),
            result: .noSnapshotYet,
            pendingCompletionIds: [],
            configuration: TodayWidgetIntent()
        )
    }

    func snapshot(for configuration: TodayWidgetIntent, in context: Context) async -> TodoEntry {
        entry(for: configuration)
    }

    func timeline(for configuration: TodayWidgetIntent, in context: Context) async -> Timeline<TodoEntry> {
        // The app calls WidgetCenter.reloadAllTimelines() after every task
        // mutation (and CompleteTaskIntent does the same), so this fallback
        // only matters if the app hasn't been opened in a while.
        let current = entry(for: configuration)
        var nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        // Sooner when the next meeting starts first, so its row moves on to the
        // one after it at the moment it begins rather than up to 15 minutes late.
        if let start = current.result.snapshot?.nextEvent(after: current.date)?.startDate, start < nextRefresh {
            nextRefresh = start
        }
        return Timeline(entries: [current], policy: .after(nextRefresh))
    }

    private func entry(for configuration: TodayWidgetIntent) -> TodoEntry {
        TodoEntry(
            date: Date(),
            result: loadWidgetSnapshot(),
            pendingCompletionIds: loadPendingCompletionIds(),
            configuration: configuration
        )
    }
}

/// The next meeting, in the grid's last row slot: same height as a task row,
/// so the layout math in `WidgetLayout` is untouched. The glyph sits where a
/// checkbox would, since there is nothing to tick.
struct EventRowView: View {
    let event: WidgetEvent
    let palette: WidgetPalette
    let height: CGFloat

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "calendar")
                .font(.system(size: 11))
                .foregroundColor(palette.textSecondary)
                // The checkbox column's width (16 plus its 6 a side), so the
                // title lines up with the task titles above it.
                .frame(width: 28, height: height)
            if let start = event.startDate {
                Text(start, style: .time)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(palette.textSecondary)
                    .fixedSize()
            }
            Text(event.title.isEmpty ? "Event" : event.title)
                .font(.system(size: 12))
                .foregroundColor(palette.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(1)
            Spacer(minLength: 0)
        }
        .frame(height: height)
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
                            .fill(palette.done)
                        Image(systemName: "checkmark")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(palette.onDone)
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

            // layoutPriority, because the title is the one thing the row exists
            // to show and everything beside it is short and fixed. A row that
            // lets its trailing pieces claim width first truncates the title
            // instead — see the same rule in CLAUDE.md's design section.
            // The event a rule wrote this task for follows the title in the
            // dimmer colour, on the same line, so a row's height never changes.
            // Truncation takes the event's name before the task's own.
            (Text(task.title)
                .foregroundColor(isPendingCompletion ? palette.textTertiary : palette.text)
                + Text(task.eventTitle.map { " · " + $0 } ?? "")
                .foregroundColor(palette.textTertiary))
                .font(.system(size: 12))
                .strikethrough(isPendingCompletion)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(1)

            Spacer(minLength: 2)

            // The streak, if there's one worth mentioning. See taskRowDetail.
            // Fixed-size so a tight row shrinks the title (which already
            // truncates) rather than clipping these few short characters.
            if !isPendingCompletion, let detail = taskRowDetail(task) {
                HStack(spacing: 2) {
                    if let symbol = taskRowDetailSymbol(task) {
                        Image(systemName: symbol)
                            .font(.system(size: 8))
                            .foregroundColor(palette.orange)
                    }
                    Text(detail)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(palette.textSecondary)
                        .lineLimit(1)
                }
                .fixedSize()
            }
        }
        .frame(height: height)
    }
}

struct TodoTodayWidgetEntryView: View {
    var entry: TodoTodayProvider.Entry
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.widgetFamily) var family

    private var emptyStateMessage: String {
        switch entry.result {
        case .noAppGroupAccess: return "Can't access shared data (App Group)"
        case .noSnapshotYet: return "Open the app to get started"
        case .decodeFailed: return "Couldn't read task data"
        case .success:
            return entry.configuration.categoryFilter == nil ? "All clear" : "Nothing in this list"
        }
    }

    /// The rows this particular placed widget draws, after its own
    /// configuration. Filtered here rather than in the snapshot because there
    /// is one snapshot on disk and any number of widgets reading it.
    private var tasks: [WidgetTask] {
        guard let snapshot = entry.result.snapshot else { return [] }
        let base = entry.configuration.pinnedOnly
            ? snapshot.pinnedTasks
            : snapshot.visibleTasks
        guard let category = entry.configuration.categoryFilter else { return base }
        return base.filter { $0.category == category }
    }

    /// How many of the rows on screen are still outstanding.
    ///
    /// Intersected with the rows rather than subtracting the whole pending
    /// queue's size: that file is the app's, not this widget's, and it can hold
    /// ids for tasks this widget isn't showing (a different category, a tap
    /// whose snapshot has already been rewritten). Subtracting its raw count
    /// under-reported the tally, and did so by more the more the user tapped.
    private var remaining: Int {
        tasks.filter { !entry.pendingCompletionIds.contains($0.id) }.count
    }

    private var doneToday: Int { entry.result.snapshot?.doneToday ?? 0 }

    /// Today's next meeting, as of this entry. Only on the unfiltered Today
    /// widget: one configured for a category or for pins is about those.
    private var nextEvent: WidgetEvent? {
        guard entry.configuration.categoryFilter == nil, !entry.configuration.pinnedOnly else { return nil }
        return entry.result.snapshot?.nextEvent(after: entry.date)
    }

    /// A small widget's header already spends its 158pt on a glyph, a title
    /// and the add button — there's no room left for shortcut links too.
    private var showsShortcuts: Bool { family != .systemSmall }

    /// Where else this widget can jump straight to. Not every hub destination:
    /// these ride in the header alongside the add button, not a second nav
    /// menu, and every URL here is one an existing task link, widget or Live
    /// Activity already uses for the same trip — `groceriesURL`/`mealPlanURL`
    /// by the Grocery and Kitchen widgets, `moodURL`/`foodLogURL` by the
    /// mood check-in task and the deep link `isFoodLogUrl` handles.
    private var shortcuts: [WidgetHeaderShortcut] {
        guard showsShortcuts else { return [] }
        return [
            WidgetHeaderShortcut(symbolName: "cart.fill", label: "Groceries", destination: groceriesURL),
            WidgetHeaderShortcut(symbolName: "fork.knife", label: "Meal plan", destination: mealPlanURL),
            WidgetHeaderShortcut(symbolName: "face.smiling", label: "Mood", destination: moodURL),
            WidgetHeaderShortcut(symbolName: "fork.knife.circle", label: "Food log", destination: foodLogURL),
            // Opens QuickEventSheet — a separate glyph from the "+" add
            // button, since that one adds a *task* and this adds a calendar
            // event (see AddTaskFab's own "Event" row, its own entry beside
            // "Task" rather than a variant of it).
            WidgetHeaderShortcut(symbolName: "calendar.badge.plus", label: "Add event", destination: addEventURL),
        ]
    }

    private var header: WidgetHeaderView {
        WidgetHeaderView(
            palette: WidgetPalette.forScheme(colorScheme),
            symbolName: entry.configuration.pinnedOnly ? "pin.fill" : "sun.max.fill",
            symbolColor: WidgetPalette.forScheme(colorScheme).orange,
            title: entry.configuration.categoryFilter ?? (entry.configuration.pinnedOnly ? "Pinned" : "Today"),
            // A small widget's header holds a glyph, a title and the add
            // button in 158pt. The count is what gives way: it is the one piece
            // the rows below already imply.
            countLabel: tasks.isEmpty || family == .systemSmall ? nil : taskCountLabel(remaining),
            shortcutLinks: shortcuts,
            actionURL: quickAddURL,
            actionLabel: "Add task"
        )
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(remaining == 0 ? "All clear" : taskCountLabel(remaining))
        case .accessoryCircular:
            AccessoryRing(
                fraction: doneToday + remaining == 0 ? 0 : Double(doneToday) / Double(doneToday + remaining),
                label: "\(remaining)",
                caption: "left"
            )
        case .accessoryRectangular:
            rectangularView
        default:
            gridView
        }
    }

    /// Two lines of type on the Lock Screen: what the day holds, then the row
    /// at the top of it. No checkbox — an accessory family is a glance, and a
    /// tap target that small on a locked screen is a mis-tap waiting to happen.
    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(remaining == 0 ? "All clear" : taskCountLabel(remaining))
                .font(.headline)
                .lineLimit(1)
            // The task title before the agenda summary, deliberately: a
            // rectangular accessory is 172pt wide and something has to
            // truncate. "4 due · 2 carried over · 1 deadline" losing its tail
            // costs a number the headline above already implies; a task title
            // losing its tail costs the only actionable thing on the widget.
            if let first = tasks.first {
                Text(first.title)
                    .font(.caption)
                    .lineLimit(1)
            }
            // The next meeting takes the third line when there is one: it's
            // the thing on the day with a time attached, where the agenda line
            // restates counts the headline already gives.
            if let event = nextEvent, let start = event.startDate {
                (Text(start, style: .time) + Text(" " + (event.title.isEmpty ? "Event" : event.title)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else if let agenda = entry.result.snapshot?.agenda, let line = agendaLine(agenda) {
                Text(line)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// "3 due · 1 carried over · 2 deadlines", or nothing worth a line.
    /// Mirrors agendaBody in src/utils/dailyAgenda.ts, including its refusal to
    /// say anything at all when every count is zero.
    private func agendaLine(_ agenda: WidgetAgenda) -> String? {
        var parts: [String] = []
        if agenda.due > 0 { parts.append("\(agenda.due) due") }
        if agenda.carriedOver > 0 { parts.append("\(agenda.carriedOver) carried over") }
        if agenda.deadlines > 0 {
            parts.append("\(agenda.deadlines) deadline\(agenda.deadlines == 1 ? "" : "s")")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var gridView: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        let perColumn = WidgetLayout.rowsPerColumn(for: family)
        // Small is one column; medium and large are two.
        let columns = family == .systemSmall ? 1 : 2
        // The next meeting takes the grid's last slot, so one task fewer fits.
        let event = nextEvent
        let shown = Array(tasks.prefix(perColumn * columns - (event == nil ? 0 : 1)))
        let leftColumn = Array(shown.prefix(perColumn))
        let rightColumn = Array(shown.dropFirst(perColumn))

        return GeometryReader { geo in
            let rowHeight = WidgetLayout.rowHeight(forWidgetHeight: geo.size.height, rows: perColumn)
            // The grid keeps all its slots whether or not they're filled, so
            // a two-task day and an eight-task day put the header, the first
            // row and the bottom edge in exactly the same places.
            let gridHeight = rowHeight * CGFloat(perColumn)

            WidgetFrame(header: header, holdsTop: !shown.isEmpty) {
                Group {
                    if shown.isEmpty {
                        WidgetEmptyState(palette: palette, message: emptyStateMessage)
                    } else {
                        // Both columns are always laid out, even when the
                        // right one is empty — otherwise the left column is
                        // full-width on a light day and half-width on a busy
                        // one, and titles truncate at a different point in
                        // each. Same reason the grid keeps its empty slots.
                        HStack(alignment: .top, spacing: WidgetLayout.columnGap) {
                            columnView(leftColumn, palette: palette, rowHeight: rowHeight,
                                       footer: columns == 1 ? event : nil)
                            if columns > 1 {
                                columnView(rightColumn, palette: palette, rowHeight: rowHeight, footer: event)
                            }
                        }
                        .frame(height: gridHeight, alignment: .top)
                    }
                }
            }
        }
        .widgetURL(openAppURL)
    }

    /// One column of the grid. Always its share of the width and always the
    /// grid's full height, however few rows it holds.
    private func columnView(
        _ tasks: [WidgetTask],
        palette: WidgetPalette,
        rowHeight: CGFloat,
        footer: WidgetEvent? = nil
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
            // Pinned to the bottom slot, so it sits in the same place on a
            // light day and a full one.
            if let footer {
                EventRowView(event: footer, palette: palette, height: rowHeight)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TodoTodayWidget: Widget {
    let kind: String = "TodoTodayWidget"

    var body: some WidgetConfiguration {
        // AppIntentConfiguration rather than StaticConfiguration, so a placed
        // widget can be pointed at one category or at the pinned block. An
        // existing widget placed before this shipped keeps its slot and picks
        // up the parameter defaults, which are "every category, not pinned
        // only" — exactly what it was already showing.
        AppIntentConfiguration(kind: kind, intent: TodayWidgetIntent.self, provider: TodoTodayProvider()) { entry in
            TodoTodayWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(UIColor.secondarySystemGroupedBackground)
                }
        }
        .configurationDisplayName("Today")
        .description("Your tasks for today.")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryRectangular, .accessoryCircular, .accessoryInline,
        ])
        // The default container margins are ~16pt a side, and a medium widget
        // is only ~155pt tall — a header plus four rows doesn't fit inside
        // what's left, which is why the bottom row used to run off the edge.
        // Reclaiming them and paying the padding back explicitly (see
        // WidgetLayout) is what buys the bottom gutter.
        .contentMarginsDisabled()
    }
}
