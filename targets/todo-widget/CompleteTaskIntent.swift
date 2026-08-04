import AppIntents
import WidgetKit

// Runs in the widget extension process when the checkbox is tapped. It can't
// reach the app's SQLite database or the JS logic that handles
// recurrence/streaks/chains when a task actually completes, so it queues the
// task id and opens the app (openAppWhenRun == true) to finish the job:
// processPendingWidgetCompletions() in widgetSync.ts drains the queue and
// calls the real completeTask() as soon as the app becomes active, after
// TodayScreen has had a chance to play the same complete animation a normal
// in-app tap gets (see useWidgetCompletionStore / TaskItem's autoComplete
// prop) — the point of opening the app immediately is watching that happen.
// The widget shows an optimistic checked state in the meantime (see
// loadPendingCompletionIds in TodoWidgetData.swift).
struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Task"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Task ID")
    var taskId: String

    init() {}

    init(taskId: String) {
        self.taskId = taskId
    }

    func perform() async throws -> some IntentResult {
        addPendingCompletion(taskId: taskId)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
