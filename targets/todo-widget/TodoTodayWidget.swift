import WidgetKit
import SwiftUI
import AppIntents

struct TodoEntry: TimelineEntry {
    let date: Date
    let result: WidgetLoadResult
    /// Tasks checked off here that the app hasn't applied yet, through either
    /// checkbox (the one that opens the app, and the quiet one).
    let pendingCompletionIds: Set<String>
    /// Units of a daily target queued by the quiet checkbox, per task id.
    let queuedUnits: [String: Int]
    let configuration: TodayWidgetIntent
}

struct TodoTodayProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TodoEntry {
        TodoEntry(
            date: Date(),
            result: .noSnapshotYet,
            pendingCompletionIds: [],
            queuedUnits: [:],
            configuration: TodayWidgetIntent()
        )
    }

    func snapshot(for configuration: TodayWidgetIntent, in context: Context) async -> TodoEntry {
        entry(for: configuration)
    }

    func timeline(for configuration: TodayWidgetIntent, in context: Context) async -> Timeline<TodoEntry> {
        // One entry now, then one at every moment the snapshot already knows
        // the widget will change (a deferred task arriving, a meeting starting,
        // the day turning over, the snapshot going stale) — so the widget keeps
        // up with the day while the app stays closed, rather than showing the
        // list as it stood at the last write until iOS next lets it reload.
        //
        // The app still calls WidgetCenter.reloadAllTimelines() after every
        // task mutation (and CompleteTaskIntent does the same), which replaces
        // all of this with a timeline built off the new snapshot.
        let now = Date()
        let result = loadWidgetSnapshot()
        let quiet = QueuedQuietTaps.load()
        let pending = loadPendingCompletionIds().union(quiet.completed)
        let dates = [now] + (result.snapshot?.changeDates(after: now) ?? [])
        // WidgetKit renders each entry up front, so a day with dozens of
        // deferred tasks is capped rather than built out in full; the reload
        // below picks up where the cap left off.
        let entries = dates.prefix(maxTimelineEntries).map {
            TodoEntry(
                date: $0,
                result: result,
                pendingCompletionIds: pending,
                queuedUnits: quiet.units,
                configuration: configuration
            )
        }
        // A fallback reload, for a snapshot rewritten by something that didn't
        // reload timelines (the background refresh task's first run after an
        // update, say). Never later than the last entry, so a capped timeline
        // can't run dry.
        var nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: now) ?? now
        if let last = entries.last?.date, last > now, last < nextRefresh { nextRefresh = last }
        return Timeline(entries: Array(entries), policy: .after(nextRefresh))
    }

    private func entry(for configuration: TodayWidgetIntent) -> TodoEntry {
        let quiet = QueuedQuietTaps.load()
        return TodoEntry(
            date: Date(),
            result: loadWidgetSnapshot(),
            pendingCompletionIds: loadPendingCompletionIds().union(quiet.completed),
            queuedUnits: quiet.units,
            configuration: configuration
        )
    }
}

/// How many entries one Today timeline holds at most.
private let maxTimelineEntries = 40

/// How many units of a daily target are queued and not yet applied: the quiet
/// checkbox's run of units, plus one for a tap on the checkbox that opens the
/// app (which the app also applies as one unit; see TaskItem's autoComplete).
func widgetQueuedUnits(_ task: WidgetTask, entry: TodoEntry) -> Int {
    (entry.queuedUnits[task.id] ?? 0) + (entry.pendingCompletionIds.contains(task.id) ? 1 : 0)
}

/// Whether a row reads as finished: an ordinary task once its tap is queued, a
/// daily target only once its queued units reach the target. A target below
/// that is still owed more, so it keeps its place in the count.
func widgetRowDone(_ task: WidgetTask, entry: TodoEntry) -> Bool {
    if task.tapsAreUnits, let target = task.targetCount {
        let queued = widgetQueuedUnits(task, entry: entry)
        return queued > 0 && task.progressCount + queued >= target
    }
    return entry.pendingCompletionIds.contains(task.id)
}

/// The colours of the app's priority bar (`PRIORITY_COLORS` in
/// src/types/index.ts), low to urgent. Nil for no priority.
func priorityColor(_ priority: Int) -> Color? {
    switch priority {
    case 1: return Color(hex: "30D158")
    case 2: return Color(hex: "FFD60A")
    case 3: return Color(hex: "FF9F0A")
    case 4: return Color(hex: "FF453A")
    default: return nil
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
    /// Units of a daily target tapped here and not yet applied.
    let queuedUnits: Int
    /// Whether the row draws as finished (`widgetRowDone`).
    let isDone: Bool
    let height: CGFloat

    /// The checkbox, wired to whichever intent this task's tap needs: the one
    /// that opens the app for a task that asks something on completion, the
    /// quiet one for everything else. `needsApp` is the app's call.
    @ViewBuilder private var checkboxButton: some View {
        if task.needsApp {
            Button(intent: CompleteTaskIntent(taskId: task.id)) { checkbox }
                .buttonStyle(.plain)
        } else {
            Button(intent: CompleteTaskQuietlyIntent(taskId: task.id, unit: task.tapsAreUnits)) { checkbox }
                .buttonStyle(.plain)
        }
    }

    private var checkbox: some View {
        ZStack {
            // Rounded square, matching the app's checkbox — .continuous
            // is the same superellipse RN draws with borderCurve.
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .stroke(palette.separator, lineWidth: 2)
            if isDone {
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
        // The app's priority bar, at the row's leading edge. Inside
        // the checkbox's padding, so it moves nothing.
        .overlay(alignment: .leading) {
            if let color = priorityColor(task.priority) {
                Capsule()
                    .fill(color)
                    .frame(width: 2.5, height: min(14, height * 0.6))
            }
        }
        .contentShape(Rectangle())
    }

    var body: some View {
        HStack(spacing: 8) {
            checkboxButton

            // layoutPriority, because the title is the one thing the row exists
            // to show and everything beside it is short and fixed. A row that
            // lets its trailing pieces claim width first truncates the title
            // instead — see the same rule in CLAUDE.md's design section.
            // The event a rule wrote this task for follows the title in the
            // dimmer colour, on the same line, so a row's height never changes.
            // Truncation takes the event's name before the task's own.
            (Text(task.title)
                .foregroundColor(isDone ? palette.textTertiary : palette.text)
                + Text(task.eventTitle.map { " · " + $0 } ?? "")
                .foregroundColor(palette.textTertiary))
                .font(.system(size: 12))
                .strikethrough(isDone)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(1)

            Spacer(minLength: 2)

            // A daily target's count, else the streak if there's one worth
            // mentioning. See taskRowDetail. Fixed-size so a tight row shrinks
            // the title (which already truncates) rather than clipping these
            // few short characters.
            // The reminder's clock time, as the app's row shows it. The one
            // fixed piece a row can carry beside the count, so it drops out
            // once the row is done rather than crowding a struck title.
            if !isDone, let reminder = task.reminderDate {
                Text(reminder, style: .time)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(palette.textSecondary)
                    .lineLimit(1)
                    .fixedSize()
            }
            if !isDone, let detail = taskRowDetail(task, queuedUnits: queuedUnits) {
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

/// The small widget's last slot when there are more rows than it can hold.
/// The small size drops the header count for room, so without this a list
/// cut off at four reads the same as a list of four.
struct MoreRowView: View {
    let count: Int
    let palette: WidgetPalette
    let height: CGFloat

    var body: some View {
        Text("+\(count) more")
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(palette.textSecondary)
            .lineLimit(1)
            // Lined up with the task titles, past the checkbox column.
            .padding(.leading, 28 + 8)
            .frame(height: height, alignment: .leading)
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
            if isStale { return staleMessage }
            return entry.configuration.categoryFilter == nil ? "All clear" : "Nothing in this list"
        }
    }

    /// Past the point the snapshot looked ahead to, the task rows would be
    /// missing a whole day's arrivals, and "All clear" would be a claim the
    /// widget can't back. It says so instead. Pinned rows ignore the clock
    /// gates in the app too (`pinnedTasks()`), so a pinned-only widget keeps
    /// showing them.
    private var isStale: Bool {
        guard !entry.configuration.pinnedOnly else { return false }
        return entry.result.snapshot?.isStale(at: entry.date) ?? false
    }

    // Computed rather than a stored `let`: a private stored property would make
    // the view's memberwise init private, and `TodoTodayWidget` builds it.
    private var staleMessage: String { "Open the app to update" }

    /// The rows this particular placed widget draws, after its own
    /// configuration. Filtered here rather than in the snapshot because there
    /// is one snapshot on disk and any number of widgets reading it.
    private var tasks: [WidgetTask] {
        guard let snapshot = entry.result.snapshot else { return [] }
        if isStale { return [] }
        let base = entry.configuration.pinnedOnly
            ? snapshot.pinnedTasks
            : snapshot.visibleTasks(at: entry.date)
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
        tasks.filter { !widgetRowDone($0, entry: entry) }.count
    }

    private var doneToday: Int { entry.result.snapshot?.doneToday(at: entry.date) ?? 0 }

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
            Text(headline)
        case .accessoryCircular:
            AccessoryRing(
                fraction: isStale || doneToday + remaining == 0 ? 0 : Double(doneToday) / Double(doneToday + remaining),
                // A dash rather than a 0, which would read as "nothing left".
                label: isStale ? "–" : "\(remaining)",
                caption: isStale ? "open" : "left"
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
            Text(headline)
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
            } else if let agenda = entry.result.snapshot?.agenda(at: entry.date), let line = agendaLine(agenda) {
                Text(line)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// The Lock Screen's one line about the day.
    private var headline: String {
        if isStale { return staleMessage }
        return remaining == 0 ? "All clear" : taskCountLabel(remaining)
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
        let capacity = perColumn * columns - (event == nil ? 0 : 1)
        // Only the small size says what's cut off. Its header has no count
        // (see `header`), so four rows of a twelve-task day look like the
        // whole day; medium and large already say "12 tasks" up top, and a
        // row spent repeating that would be one task fewer on screen.
        let overflows = family == .systemSmall && tasks.count > capacity
        let shown = Array(tasks.prefix(max(0, overflows ? capacity - 1 : capacity)))
        let moreCount = overflows ? tasks.count - shown.count : 0
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
                                       moreCount: moreCount, footer: columns == 1 ? event : nil)
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
        moreCount: Int = 0,
        footer: WidgetEvent? = nil
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(tasks) { task in
                TaskRowView(
                    task: task,
                    palette: palette,
                    queuedUnits: widgetQueuedUnits(task, entry: entry),
                    isDone: widgetRowDone(task, entry: entry),
                    height: rowHeight
                )
            }
            if moreCount > 0 {
                MoreRowView(count: moreCount, palette: palette, height: rowHeight)
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
                    WidgetCardBackground()
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
