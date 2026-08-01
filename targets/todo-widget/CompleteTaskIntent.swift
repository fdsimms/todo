import AppIntents
import WidgetKit

// Runs in the widget extension process when the checkbox is tapped —
// deliberately does NOT open the app (default openAppWhenRun == false).
// It can't reach the app's SQLite database or the JS logic that handles
// recurrence/streaks/chains when a task actually completes, so it only
// queues the task id; TodoWidgetBridgeModule.drainPendingCompletions()
// picks the queue up and calls the real completeTask() next time the app
// opens. The widget shows an optimistic checked state in the meantime (see
// loadPendingCompletionIds in TodoWidgetData.swift).
struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Task"
    static var isDiscoverable: Bool = false

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
