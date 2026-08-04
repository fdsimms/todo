import AppIntents
import WidgetKit

// Distinct from CompleteTaskIntent: checking a box in the widget only queues
// the completion locally (see CompleteTaskIntent.swift) — it never opens the
// app. This intent is the widget's separate "sync" affordance (a button
// shown only while a completion is queued, see PendingSyncBar in
// TodoTodayWidget.swift) that the user taps to actually apply it.
// openAppWhenRun does the work: perform() itself is a no-op, and opening the
// app is enough — processPendingWidgetCompletions() in widgetSync.ts drains
// the queue and calls the real completeTask() whenever the app becomes
// active, whether that's a cold launch or foregrounding one already running.
struct SyncPendingCompletionsIntent: AppIntent {
    static var title: LocalizedStringResource = "Sync Completed Tasks"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        return .result()
    }
}
