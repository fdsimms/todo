import Foundation

// The watch's own taps, from the moment one is made until the iPhone has
// applied it.
//
// A tap can't change the snapshot: that is the phone's list, rebuilt only when
// the app on the phone applies the tap (see WatchSession.swift there). Until
// then the watch draws its taps over the snapshot, the way the widget draws its
// queued taps (QueuedQuietTaps in WidgetQuietIntents.swift), so a row ticked on
// the wrist stays ticked. This file is the log and that overlay. It compiles
// into the watch app and the complication, which share it through the watch's
// App Group (a container on the watch, unrelated to the phone's).

/// One tap made on the watch. `id` is the watch's own and travels with the
/// tap, so the phone can say which ones it has received and applied.
struct WatchTap: Codable, Identifiable {
    let id: String
    /// "complete", "unit", "grocery" or "add".
    let kind: String
    /// The task id or grocery item id. Empty for "add".
    let itemId: String
    /// The grocery list the row was on; nil is the home list.
    let listId: String?
    /// The task's title, for "add" only.
    let title: String?
    let at: Date
    /// Handed to WatchConnectivity. False while the session wasn't active yet,
    /// so the tap is sent once it is.
    var sent: Bool

    /// What the phone's queue expects (see QuietTap in widgetQuietTaps.ts).
    var userInfo: [String: Any] {
        var info: [String: Any] = [
            "kind": kind,
            "watchTapId": id,
            "at": ISO8601DateFormatter().string(from: at),
        ]
        if !itemId.isEmpty { info["id"] = itemId }
        if let listId { info["listId"] = listId }
        if let title { info["title"] = title }
        return info
    }
}

enum WatchTapLog {
    static let fileName = "watch_taps.json"

    /// A tap the phone hasn't settled in this long is dropped: the snapshot it
    /// was drawn over has gone stale by then anyway, and the phone remembers
    /// only so many received ids.
    static let maxAge: TimeInterval = 3 * 24 * 60 * 60

    private static func fileURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(fileName)
    }

    static func load() -> [WatchTap] {
        guard let url = fileURL(),
              let data = try? Data(contentsOf: url),
              let taps = try? JSONDecoder().decode([WatchTap].self, from: data) else {
            return []
        }
        return taps
    }

    static func save(_ taps: [WatchTap]) {
        guard let url = fileURL(), let data = try? JSONEncoder().encode(taps) else { return }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: url, options: .atomic)
    }
}

/// The watch's unsettled taps, as what they change on screen.
struct LocalTapState {
    let completed: Set<String>
    let units: [String: Int]
    let groceries: Set<String>
    /// Titles of tasks added on the watch that the phone hasn't received yet.
    let added: [String]

    init(_ taps: [WatchTap]) {
        var completed = Set<String>()
        var units: [String: Int] = [:]
        var groceries = Set<String>()
        var added: [String] = []
        for tap in taps {
            switch tap.kind {
            case "complete": completed.insert(tap.itemId)
            case "unit": units[tap.itemId, default: 0] += 1
            case "grocery": groceries.insert(Self.groceryKey(itemId: tap.itemId, listId: tap.listId))
            case "add": if let title = tap.title { added.append(title) }
            default: break
            }
        }
        self.completed = completed
        self.units = units
        self.groceries = groceries
        self.added = added
    }

    static func groceryKey(itemId: String, listId: String?) -> String {
        "\(listId ?? "")\u{0}\(itemId)"
    }

    /// The target's count with this watch's units added on.
    func progress(_ task: WidgetTask) -> Int {
        task.progressCount + (units[task.id] ?? 0)
    }

    func isDone(_ task: WidgetTask) -> Bool {
        if completed.contains(task.id) { return true }
        guard task.tapsAreUnits, let target = task.targetCount else { return false }
        return progress(task) >= target
    }

    func isChecked(_ row: WidgetGroceryRow, listId: String?) -> Bool {
        groceries.contains(Self.groceryKey(itemId: row.id, listId: listId))
    }
}

extension WidgetSnapshot {
    /// Today's rows as of `date`: pinned ones first, then the rest, each once.
    func todayRows(at date: Date) -> [WidgetTask] {
        var seen = Set<String>()
        return (pinnedTasks + visibleTasks(at: date)).filter { seen.insert($0.id).inserted }
    }
}
