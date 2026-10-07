import AppIntents
import Foundation
import UserNotifications
import WidgetKit

// The widget's checkboxes that do their job without opening the app.
//
// CompleteTaskIntent (modules/todo-widget-bridge) brings the app forward on
// every tap, which is right for a task that asks a question on completion and
// wasteful for one that doesn't: ticking three things off the home screen was
// three trips into the app and back. These two only queue the tap, in this
// process, and the app applies the queue the next time it comes forward
// (processQuietWidgetTaps in src/utils/widgetSync.ts, with the rules in
// src/utils/widgetQuietTaps.ts). Which intent a task row's checkbox runs is the
// snapshot's `needsApp`, worked out by the app.
//
// **Widget target only, unlike CompleteTaskIntent.** That one has to compile
// into the app too because it opens it (see docs/native-targets.md); these run
// in the background, which is exactly what a widget extension's intents do.
// So this file is listed in withWidgetExtension.js's SWIFT_FILES, not
// SHARED_SWIFT_FILES.

/// One queued tap. Mirrors `QuietTap` in src/utils/widgetQuietTaps.ts.
struct QuietTap: Codable {
    /// "complete", "unit" or "grocery".
    let kind: String
    let id: String
    /// The grocery list the row was on; nil is the home list.
    let listId: String?
    let at: String
}

enum QuietTapQueue {
    // Must match quietTapsFileName in TodoWidgetBridgeModule.swift, which
    // drains it.
    static let fileName = "widget_quiet_taps.json"

    private static func fileURL() -> URL? {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        ) else {
            return nil
        }
        return containerURL
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(fileName)
    }

    static func load() -> [QuietTap] {
        guard let url = fileURL(),
              let data = try? Data(contentsOf: url),
              let taps = try? JSONDecoder().decode([QuietTap].self, from: data) else {
            return []
        }
        return taps
    }

    /// Appends a tap. A repeat of a "complete" or "grocery" tap already queued
    /// is the same tap and is dropped; "unit" taps all count, since each one is
    /// another glass.
    static func append(kind: String, id: String, listId: String? = nil) {
        guard let url = fileURL() else { return }
        var taps = load()
        if kind != "unit", taps.contains(where: { $0.kind == kind && $0.id == id && $0.listId == listId }) {
            return
        }
        taps.append(QuietTap(kind: kind, id: id, listId: listId, at: ISO8601DateFormatter().string(from: Date())))
        guard let data = try? JSONEncoder().encode(taps) else { return }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: url, options: .atomic)
    }
}

/// What the widget draws for taps the app hasn't applied yet.
struct QueuedQuietTaps {
    /// Task ids checked off.
    let completed: Set<String>
    /// Units queued per daily target.
    let units: [String: Int]
    /// Grocery rows ticked, keyed by `groceryKey`.
    let groceries: Set<String>

    static func load() -> QueuedQuietTaps {
        var completed = Set<String>()
        var units: [String: Int] = [:]
        var groceries = Set<String>()
        for tap in QuietTapQueue.load() {
            switch tap.kind {
            case "complete": completed.insert(tap.id)
            case "unit": units[tap.id, default: 0] += 1
            case "grocery": groceries.insert(groceryKey(itemId: tap.id, listId: tap.listId))
            default: break
            }
        }
        return QueuedQuietTaps(completed: completed, units: units, groceries: groceries)
    }

    static func groceryKey(itemId: String, listId: String?) -> String {
        (listId ?? "") + "\u{0}" + itemId
    }
}

struct CompleteTaskQuietlyIntent: AppIntent {
    static var title: LocalizedStringResource = "Check Off Task"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Task ID")
    var taskId: String

    /// True on a daily target's row: the tap is one unit, not the whole task.
    @Parameter(title: "One unit")
    var unit: Bool

    init() {}

    init(taskId: String, unit: Bool) {
        self.taskId = taskId
        self.unit = unit
    }

    func perform() async throws -> some IntentResult {
        QuietTapQueue.append(kind: unit ? "unit" : "complete", id: taskId)
        // The task's own reminder is scheduled under its id (notifications.ts),
        // and it would otherwise still go off for something already checked
        // off here, until the app next opens. A unit doesn't finish the task,
        // so it leaves the reminder alone.
        //
        // **Unverified:** whether an extension's notification center can remove
        // a request the containing app scheduled could not be checked from the
        // sandbox this was written in. If it can't, this is a no-op and the
        // reminder fires as it did before, so nothing here depends on it.
        if !unit {
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [taskId])
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

struct CheckGroceryItemIntent: AppIntent {
    static var title: LocalizedStringResource = "Check Off Grocery Item"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Item ID")
    var itemId: String

    /// The list the row is on. Nil is the home list, matching
    /// `GroceryListEntry.listId` in the app.
    @Parameter(title: "List ID")
    var listId: String?

    init() {}

    init(itemId: String, listId: String?) {
        self.itemId = itemId
        self.listId = listId
    }

    func perform() async throws -> some IntentResult {
        QuietTapQueue.append(kind: "grocery", id: itemId, listId: listId)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
