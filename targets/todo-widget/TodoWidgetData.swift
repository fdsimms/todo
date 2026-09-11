import Foundation
import SwiftUI

// Not `private` — CompleteTaskIntent.swift and the other widgets in this
// target (same target) need these too.
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

    enum CodingKeys: String, CodingKey {
        case id, title, priority, pinned, dueDate, category, streakCount, recurrenceType
        case targetCount, progressCount, targetUnit
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
    }

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

    /// How much of the list is already in the trolley, 0...1.
    var boughtFraction: Double {
        total > 0 ? Double(total - remaining) / Double(total) : 0
    }

    enum CodingKeys: String, CodingKey { case id, name, remaining, total, items }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        remaining = try c.decodeIfPresent(Int.self, forKey: .remaining) ?? 0
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? 0
        items = try c.decodeIfPresent([String].self, forKey: .items) ?? []
    }
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

    enum CodingKeys: String, CodingKey {
        case updatedAt, visibleTasks, pinnedTasks, categories, agenda, doneToday
        case groceries, meals, kitchen
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
// opening (CompleteTaskIntent.openAppWhenRun) to finish the job; the
// underlying snapshot still lists these tasks until the app catches up and
// writes a fresh one.
func loadPendingCompletionIds() -> Set<String> {
    guard let fileURL = pendingCompletionsFileURL(),
          let data = try? Data(contentsOf: fileURL),
          let ids = try? JSONDecoder().decode([String].self, from: data) else {
        return []
    }
    return Set(ids)
}

func addPendingCompletion(taskId: String) {
    guard let fileURL = pendingCompletionsFileURL() else { return }
    var ids = loadPendingCompletionIds()
    ids.insert(taskId)
    guard let data = try? JSONEncoder().encode(Array(ids)) else { return }
    try? FileManager.default.createDirectory(
        at: fileURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try? data.write(to: fileURL, options: .atomic)
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

// Mirrors darkColors/lightColors in src/theme/index.ts — keep in sync if
// those change. Only the tokens this widget actually uses.
struct WidgetPalette {
    let bg: Color
    let bgSecondary: Color
    let text: Color
    let textSecondary: Color
    let textTertiary: Color
    let accent: Color
    // The over-run tint, matching colors.orange in src/theme/index.ts — what
    // FocusLiveActivity draws a focus step that has run past its target in,
    // the same signal FocusBar and the session sheet give it in the app.
    let orange: Color
    let green: Color
    let red: Color
    let separator: Color

    static let dark = WidgetPalette(
        bg: Color(hex: "000000"),
        bgSecondary: Color(hex: "1C1C1E"),
        text: Color(hex: "FFFFFF"),
        textSecondary: Color(hex: "8E8E93"),
        textTertiary: Color(hex: "636366"),
        accent: Color(hex: "0A84FF"),
        orange: Color(hex: "FF9F0A"),
        green: Color(hex: "30D158"),
        red: Color(hex: "FF453A"),
        separator: Color(hex: "38383A")
    )

    static let light = WidgetPalette(
        bg: Color(hex: "F2F2F7"),
        bgSecondary: Color(hex: "FFFFFF"),
        text: Color(hex: "000000"),
        textSecondary: Color(hex: "6C6C70"),
        textTertiary: Color(hex: "8A8A8E"),
        accent: Color(hex: "007AFF"),
        orange: Color(hex: "FF9500"),
        green: Color(hex: "34C759"),
        red: Color(hex: "FF3B30"),
        separator: Color(hex: "C6C6C8")
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
