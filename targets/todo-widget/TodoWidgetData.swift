import Foundation
import SwiftUI

// Not `private` — the widgets in this target need these too.
let appGroupID = "group.com.fdsimms.dundundun"
let snapshotFileName = "widget_data.json"
// Must match the same literal in TodoWidgetBridgeModule.swift — a separate
// Xcode target/compilation unit, so the string can't be shared directly.
let pendingCompletionsFileName = "widget_pending_completions.json"

/// Every field the app added after the first version of this file shipped is
/// decoded with `decodeIfPresent` and a default.
///
/// **This is not defensiveness, it is the update order.** The app binary and
/// this extension update together, but the *snapshot* is a file on disk written
/// by whichever version last ran — so between installing an update and the next
/// time the app is opened, a widget built against the new shape is reading a
/// file written by the old one. Decoded strictly, every widget on the home
/// screen would sit at "Couldn't read task data" until the user happened to
/// launch the app, which is exactly the moment they don't need the widget.
/// A missing section decodes as absent and the widget says so in its own words.
struct WidgetTask: Codable, Identifiable {
    let id: String
    let title: String
    let priority: Int
    let pinned: Bool
    let dueDate: String?
    let category: String?
    let streakCount: Int
    let recurrenceType: String
    /// Non-nil only on a daily target. The widget draws the pair; it is
    /// deliberately not handed a pre-rendered "3/8" — the circular accessory
    /// family draws the same fact as a ring and never spells it out.
    let targetCount: Int?
    let progressCount: Int
    let targetUnit: String?
    /// The calendar event a rule wrote this task for, when there is one. Only
    /// the title crosses; the row dims it after the task's own title.
    let eventTitle: String?
    /// Set only on a row of `upcomingTasks`: when it reaches Today.
    let visibleAt: String?
    /// The reminder's instant, which the row shows as a clock time.
    let reminderTime: String?
    /// Whether the checkbox has to open the app (`widgetTapNeedsApp` in the
    /// app). True when absent: a snapshot from before the field existed gets
    /// the checkbox it always had.
    let needsApp: Bool

    enum CodingKeys: String, CodingKey {
        case id, title, priority, pinned, dueDate, category, streakCount, recurrenceType
        case targetCount, progressCount, targetUnit, eventTitle, visibleAt
        case reminderTime, needsApp
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        priority = try c.decodeIfPresent(Int.self, forKey: .priority) ?? 0
        pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
        dueDate = try c.decodeIfPresent(String.self, forKey: .dueDate)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        streakCount = try c.decodeIfPresent(Int.self, forKey: .streakCount) ?? 0
        recurrenceType = try c.decodeIfPresent(String.self, forKey: .recurrenceType) ?? "none"
        targetCount = try c.decodeIfPresent(Int.self, forKey: .targetCount)
        progressCount = try c.decodeIfPresent(Int.self, forKey: .progressCount) ?? 0
        targetUnit = try c.decodeIfPresent(String.self, forKey: .targetUnit)
        eventTitle = try c.decodeIfPresent(String.self, forKey: .eventTitle)
        visibleAt = try c.decodeIfPresent(String.self, forKey: .visibleAt)
        reminderTime = try c.decodeIfPresent(String.self, forKey: .reminderTime)
        needsApp = try c.decodeIfPresent(Bool.self, forKey: .needsApp) ?? true
    }

    var reminderDate: Date? { reminderTime.flatMap(isoDate) }

    /// A daily target whose tap is one unit rather than the whole task — the
    /// app's `isQuotaTask` for every target above one. A target of one is
    /// ticked like any task, and the app works out which it is.
    var tapsAreUnits: Bool { (targetCount ?? 0) > 1 }

    var visibleAtDate: Date? { visibleAt.flatMap(isoDate) }

    /// Whether this row is a daily target with something worth drawing.
    var isTarget: Bool {
        guard let targetCount else { return false }
        return targetCount > 0
    }
}

struct WidgetAgenda: Codable {
    let due: Int
    let carriedOver: Int
    let deadlines: Int

    static let empty = WidgetAgenda(due: 0, carriedOver: 0, deadlines: 0)

    enum CodingKeys: String, CodingKey { case due, carriedOver, deadlines }

    init(due: Int, carriedOver: Int, deadlines: Int) {
        self.due = due
        self.carriedOver = carriedOver
        self.deadlines = deadlines
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        due = try c.decodeIfPresent(Int.self, forKey: .due) ?? 0
        carriedOver = try c.decodeIfPresent(Int.self, forKey: .carriedOver) ?? 0
        deadlines = try c.decodeIfPresent(Int.self, forKey: .deadlines) ?? 0
    }
}

struct WidgetGroceryList: Codable, Identifiable {
    /// Null is the list at home, matching `GroceryListEntry.listId` in the app.
    let id: String?
    let name: String
    let remaining: Int
    /// Every row in the trolley, so `remaining` has a denominator. See the
    /// same field on the JS side for why `items.count` can't stand in.
    let total: Int
    let items: [String]
    /// The same rows with ids, for the checkbox. Built from `items` with no
    /// ids (so no checkbox) when the snapshot predates the field.
    let rows: [WidgetGroceryRow]

    /// How much of the list is already in the trolley, 0...1.
    var boughtFraction: Double {
        total > 0 ? Double(total - remaining) / Double(total) : 0
    }

    enum CodingKeys: String, CodingKey { case id, name, remaining, total, items, rows }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        remaining = try c.decodeIfPresent(Int.self, forKey: .remaining) ?? 0
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? 0
        // Through a local: the `??` fallback is an autoclosure, and reading
        // `self.items` there captures self before `rows` is set.
        let decodedItems = try c.decodeIfPresent([String].self, forKey: .items) ?? []
        items = decodedItems
        rows = try c.decodeIfPresent([WidgetGroceryRow].self, forKey: .rows)
            ?? decodedItems.map { WidgetGroceryRow(id: "", name: $0, choice: false) }
    }
}

/// One unbought row on a list (`WidgetGroceryRow` in widgetSnapshot.ts).
struct WidgetGroceryRow: Codable, Identifiable {
    /// Empty when the snapshot carried names only; such a row has no checkbox.
    let id: String
    let name: String
    /// One side of an either/or, which is ticked in the app, not here.
    let choice: Bool

    init(id: String, name: String, choice: Bool) {
        self.id = id
        self.name = name
        self.choice = choice
    }

    enum CodingKeys: String, CodingKey { case id, name, choice }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        name = try c.decode(String.self, forKey: .name)
        choice = try c.decodeIfPresent(Bool.self, forKey: .choice) ?? false
    }

    var canCheck: Bool { !id.isEmpty && !choice }
}

struct WidgetGroceries: Codable {
    let lists: [WidgetGroceryList]
    let activeListId: String?
    let tripShopName: String?
    /// An ISO stamp, not a rendered duration: a trip's elapsed minutes move
    /// while the app is closed, so the widget counts them itself.
    let tripStartedAt: String?

    /// The list a widget was configured for, by name, falling back to whichever
    /// the app currently has active (the snapshot writer puts that one first).
    func list(named name: String?) -> WidgetGroceryList? {
        if let name, let match = lists.first(where: { $0.name == name }) { return match }
        return lists.first
    }

    var tripStartedDate: Date? {
        guard let tripStartedAt else { return nil }
        return isoDate(tripStartedAt)
    }
}

struct WidgetMeal: Codable, Identifiable {
    let slot: String
    let slotLabel: String
    let title: String

    var id: String { slot + title }
}

struct WidgetKitchenItem: Codable, Identifiable {
    let title: String
    /// A `YYYY-MM-DD` day key, or nil for a row with no date on it.
    let useBy: String?

    var id: String { title + (useBy ?? "") }
}

/// A meeting still ahead today (`buildUpcomingEvents` in widgetSnapshot.ts),
/// as raw ISO stamps for the widget to format in the device's own clock style.
struct WidgetEvent: Codable, Identifiable {
    let title: String
    let start: String
    let end: String

    var id: String { start + title }
    var startDate: Date? { isoDate(start) }

    enum CodingKeys: String, CodingKey { case title, start, end }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        start = try c.decode(String.self, forKey: .start)
        end = try c.decodeIfPresent(String.self, forKey: .end) ?? ""
    }
}

struct WidgetSnapshot: Codable {
    let updatedAt: String
    let visibleTasks: [WidgetTask]
    let pinnedTasks: [WidgetTask]
    let categories: [String]
    let agenda: WidgetAgenda
    let doneToday: Int
    /// Nil means the app has not opened its grocery database in this process —
    /// which is not the same as an empty trolley, and the widget says so
    /// differently.
    let groceries: WidgetGroceries?
    let meals: [WidgetMeal]
    let kitchen: [WidgetKitchenItem]
    /// Today's meetings still to start. Nil means the calendar wasn't read
    /// when this was written (switched off, a failed read, a background run),
    /// which shows nothing rather than "no meetings".
    let upcomingEvents: [WidgetEvent]?
    /// Tasks that reach Today before `staleAfter`, each with its `visibleAt`.
    /// What lets the timeline fold a 3 PM task in at 3 PM without the app.
    let upcomingTasks: [WidgetTask]
    /// When the next logical day starts (the user's own reset time, which this
    /// extension can't read). Nil from a build predating it.
    let nextDayStart: String?
    /// When the task rows stop being trustworthy. Nil from a build predating
    /// it, which never goes stale — the widget behaves as it always did.
    let staleAfter: String?

    enum CodingKeys: String, CodingKey {
        case updatedAt, visibleTasks, pinnedTasks, categories, agenda, doneToday
        case groceries, meals, kitchen, upcomingEvents
        case upcomingTasks, nextDayStart, staleAfter
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        updatedAt = try c.decode(String.self, forKey: .updatedAt)
        visibleTasks = try c.decodeIfPresent([WidgetTask].self, forKey: .visibleTasks) ?? []
        pinnedTasks = try c.decodeIfPresent([WidgetTask].self, forKey: .pinnedTasks) ?? []
        categories = try c.decodeIfPresent([String].self, forKey: .categories) ?? []
        agenda = try c.decodeIfPresent(WidgetAgenda.self, forKey: .agenda) ?? .empty
        doneToday = try c.decodeIfPresent(Int.self, forKey: .doneToday) ?? 0
        groceries = try c.decodeIfPresent(WidgetGroceries.self, forKey: .groceries)
        meals = try c.decodeIfPresent([WidgetMeal].self, forKey: .meals) ?? []
        kitchen = try c.decodeIfPresent([WidgetKitchenItem].self, forKey: .kitchen) ?? []
        upcomingEvents = try c.decodeIfPresent([WidgetEvent].self, forKey: .upcomingEvents)
        upcomingTasks = try c.decodeIfPresent([WidgetTask].self, forKey: .upcomingTasks) ?? []
        nextDayStart = try c.decodeIfPresent(String.self, forKey: .nextDayStart)
        staleAfter = try c.decodeIfPresent(String.self, forKey: .staleAfter)
    }

    // ==== Time passing without the app ====
    //
    // The snapshot is written at one moment and read at many. These answer
    // "as of `date`", so each timeline entry draws the day as it stands at its
    // own time rather than as it stood when the app last wrote.

    /// Whether `date` is past the point these task rows can speak for.
    func isStale(at date: Date) -> Bool {
        guard let end = staleAfter.flatMap(isoDate) else { return false }
        return date >= end
    }

    /// Whether `date` falls in a logical day after the one this was written in.
    func isLaterDay(at date: Date) -> Bool {
        guard let start = nextDayStart.flatMap(isoDate) else { return false }
        return date >= start
    }

    /// Today's rows as of `date`: what was visible when written, then each
    /// upcoming task whose moment has come, in the order they arrive.
    func visibleTasks(at date: Date) -> [WidgetTask] {
        visibleTasks + upcomingTasks.filter { ($0.visibleAtDate ?? .distantFuture) <= date }
    }

    /// The day's completions, which belong to the day they were counted on.
    func doneToday(at date: Date) -> Int { isLaterDay(at: date) ? 0 : doneToday }

    /// The agenda counts, or nil once they describe a day that has ended.
    func agenda(at date: Date) -> WidgetAgenda? { isLaterDay(at: date) ? nil : agenda }

    /// Every moment after `date` at which the Today widget draws something
    /// different with no new write: a task arriving, a meeting starting (its
    /// row moves on to the next), the day turning over, the snapshot going
    /// stale. Sorted, without repeats.
    func changeDates(after date: Date) -> [Date] {
        var dates = upcomingTasks.compactMap(\.visibleAtDate)
        dates += (upcomingEvents ?? []).compactMap(\.startDate)
        if let start = nextDayStart.flatMap(isoDate) { dates.append(start) }
        if let end = staleAfter.flatMap(isoDate) { dates.append(end) }
        return Array(Set(dates.filter { $0 > date })).sorted()
    }

    /// The first of today's meetings that hasn't started by `date`. The
    /// snapshot carries a few, so a widget whose timeline rolls past one
    /// moves on to the next without the app writing again.
    func nextEvent(after date: Date) -> WidgetEvent? {
        upcomingEvents?.first { ($0.startDate ?? .distantPast) > date }
    }

    /// The rows one placed widget should draw, given the category it was
    /// configured for. Filtering happens here rather than in the snapshot
    /// because there is one snapshot and any number of placed widgets.
    func tasks(inCategory category: String?) -> [WidgetTask] {
        guard let category, !category.isEmpty else { return visibleTasks }
        return visibleTasks.filter { $0.category == category }
    }
}

// Distinguishing these matters: "no App Group access" (an entitlement/
// provisioning problem) and "no snapshot written yet" (the normal state on
// a fresh install, before the app has run once) look identical as a bare
// nil and are very different problems to chase. "decodeFailed" catches a
// schema mismatch between what the app writes and what this target expects.
enum WidgetLoadResult {
    case success(WidgetSnapshot)
    case noAppGroupAccess
    case noSnapshotYet
    case decodeFailed

    var snapshot: WidgetSnapshot? {
        if case .success(let snapshot) = self { return snapshot }
        return nil
    }
}

// Reads the snapshot written by TodoWidgetBridgeModule from the shared App
// Group container.
func loadWidgetSnapshot() -> WidgetLoadResult {
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupID
    ) else {
        return .noAppGroupAccess
    }

    let fileURL = containerURL
        .appendingPathComponent("Library/Application Support", isDirectory: true)
        .appendingPathComponent(snapshotFileName)

    guard let data = try? Data(contentsOf: fileURL) else { return .noSnapshotYet }
    guard let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else {
        return .decodeFailed
    }
    return .success(snapshot)
}

private func pendingCompletionsFileURL() -> URL? {
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupID
    ) else {
        return nil
    }
    return containerURL
        .appendingPathComponent("Library/Application Support", isDirectory: true)
        .appendingPathComponent(pendingCompletionsFileName)
}

// Tasks the widget has optimistically marked complete via CompleteTaskIntent
// but that the app hasn't actually processed yet (recurrence/streaks/chains
// only apply once the app itself calls completeTask() — see
// TodoWidgetBridgeModule's drainPendingCompletions). Used purely to render a
// checked state immediately, in the brief window between the tap and the app
// coming forward to finish the job; the underlying snapshot still lists these
// tasks until the app catches up and writes a fresh one.
//
// Read-only here: the queue is *written* by CompleteTaskIntent, which lives in
// the bridge module so it compiles into the app target too (it can't open the
// app from this target — see docs/native-targets.md), and carries its own copy
// of the write half.
func loadPendingCompletionIds() -> Set<String> {
    guard let fileURL = pendingCompletionsFileURL(),
          let data = try? Data(contentsOf: fileURL),
          let ids = try? JSONDecoder().decode([String].self, from: data) else {
        return []
    }
    return Set(ids)
}

// ==== Dates ====

/// The app writes ISO instants with fractional seconds (`toISOString()`), which
/// the default `ISO8601DateFormatter` refuses. Both options are tried rather
/// than assuming, since day keys and instants both cross this bridge.
func isoDate(_ raw: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFraction.date(from: raw) { return date }
    return ISO8601DateFormatter().date(from: raw)
}

/// A `YYYY-MM-DD` day key as a date in the reader's own calendar.
///
/// Parsed by hand rather than with a `DateFormatter` because a day key has no
/// timezone and a formatter would give it one — the app's own day keys are
/// local days by construction (see `MealPlanEntry.date`), so reading one back
/// as UTC is how "today" becomes "yesterday" west of Greenwich.
func dayKeyDate(_ key: String) -> Date? {
    let parts = key.split(separator: "-")
    guard parts.count == 3,
          let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else {
        return nil
    }
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    return Calendar.current.date(from: components)
}

/// "Today" / "Tomorrow" / "Fri" / "Sep 14" for a use-by day key.
func describeUseBy(_ key: String?, now: Date = Date()) -> String? {
    guard let key, let date = dayKeyDate(key) else { return nil }
    let calendar = Calendar.current
    let days = calendar.dateComponents(
        [.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)
    ).day ?? 0
    if days < 0 { return days == -1 ? "Yesterday" : "\(-days) days ago" }
    if days == 0 { return "Today" }
    if days == 1 { return "Tomorrow" }
    if days < 7 {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE"
        return formatter.string(from: date)
    }
    let formatter = DateFormatter()
    formatter.setLocalizedDateFormatFromTemplate("MMMd")
    return formatter.string(from: date)
}

/// "24 min" / "1h 42m" — the same shape `describeTripElapsed` renders in the
/// app, computed here because the number moves while the app is closed.
func describeElapsed(since start: Date, now: Date = Date()) -> String {
    let minutes = max(0, Int((now.timeIntervalSince(start) / 60).rounded()))
    let hours = minutes / 60
    let mins = minutes % 60
    if hours > 0 && mins > 0 { return "\(hours)h \(mins)m" }
    if hours > 0 { return "\(hours)h" }
    return "\(mins) min"
}

extension Color {
    init(hex: String) {
        var rgb: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&rgb)
        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}

// Mirrors nightColors (Dark) and lightColors in src/theme/index.ts: keep in
// sync if those change. Only the tokens these widgets and Live Activities use.
struct WidgetPalette {
    let bg: Color
    let bgSecondary: Color
    let text: Color
    let textSecondary: Color
    let textTertiary: Color
    // Violet, colors.accent in the app. Glyphs and the add button.
    let accent: Color
    // The over-run tint, matching colors.orange in src/theme/index.ts — what
    // FocusLiveActivity draws a focus step that has run past its target in,
    // the same signal FocusBar and the session sheet give it in the app.
    let orange: Color
    let green: Color
    let red: Color
    let separator: Color
    // A checked box: gold with an ink check, colors.done/onDone in the app.
    let done: Color
    let onDone: Color
    // The mark's own gold and the ink drawn on it, colors.brand/onBrand: a Live
    // Activity's tint, keyline and button, which read as the app's own.
    let brand: Color
    let onBrand: Color

    static let dark = WidgetPalette(
        bg: Color(hex: "100E13"),
        bgSecondary: Color(hex: "1B1820"),
        text: Color(hex: "F6F3F8"),
        textSecondary: Color(hex: "B3ADBD"),
        textTertiary: Color(hex: "8F889A"),
        accent: Color(hex: "9B7BFF"),
        orange: Color(hex: "FF9F0A"),
        green: Color(hex: "30D158"),
        red: Color(hex: "FF453A"),
        separator: Color(hex: "3A3541"),
        done: Color(hex: "FFB020"),
        onDone: Color(hex: "17131C"),
        brand: Color(hex: "FFB020"),
        onBrand: Color(hex: "17131C")
    )

    static let light = WidgetPalette(
        bg: Color(hex: "F3F2F5"),
        bgSecondary: Color(hex: "FFFFFF"),
        text: Color(hex: "17131C"),
        textSecondary: Color(hex: "4F4A57"),
        textTertiary: Color(hex: "6B6574"),
        accent: Color(hex: "6A3FDB"),
        orange: Color(hex: "FF9500"),
        green: Color(hex: "34C759"),
        red: Color(hex: "FF3B30"),
        separator: Color(hex: "C9C6CF"),
        done: Color(hex: "C98500"),
        onDone: Color(hex: "17131C"),
        brand: Color(hex: "FFB020"),
        onBrand: Color(hex: "17131C")
    )

    // For a widget that sits on the wallpaper and takes the system's
    // appearance with everything else on the Home Screen.
    //
    // **A Live Activity must not use this.** All three of them set
    // `.activityBackgroundTint(WidgetPalette.dark.bgSecondary)`, so their card
    // is dark whatever the system appearance is; reading `\.colorScheme` for
    // the content on top of it resolves `text` to black in a light scheme and
    // puts black on #1C1C1E. They pin to `.dark` on both presentations
    // instead, which is not a choice about how they should look — it is the
    // content agreeing with the background those same files already force.
    static func forScheme(_ scheme: ColorScheme) -> WidgetPalette {
        scheme == .dark ? .dark : .light
    }
}

// A Home Screen widget's own background: the palette's card color
// (colors.bgSecondary in the app), following the system appearance. A view
// rather than a Color because `containerBackground` is applied in each
// widget's configuration, outside the entry view that reads the scheme. The
// system still removes it where it removes any container background (tinted
// and clear Home Screens, StandBy), so it needs no case of its own for those.
struct WidgetCardBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        WidgetPalette.forScheme(colorScheme).bgSecondary
    }
}
