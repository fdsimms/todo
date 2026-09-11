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
    // Deprecated in iOS 26 in favor of supportedModes below, and left in place
    // only for the OS versions this widget still has to support: Apple's own
    // doc for this property now says setting it true "generates an error if
    // the app intent runs in an app extension" — which this intent, compiled
    // into the WidgetKit extension (see SWIFT_FILES in
    // plugins/withWidgetExtension.js), always has been. That's why tapping the
    // checkbox stopped opening the app at all on iOS 26: this line still
    // builds the queued completion (perform() below still runs), but the
    // "bring the app forward" half now errors instead of doing anything.
    static var openAppWhenRun: Bool = true

    // The iOS 26 replacement, gated to the OS version it's actually available
    // on — AppIntent's own default (derived from openAppWhenRun above) still
    // covers everything older. .foreground(.immediate) is the same "open the
    // app before running" behavior openAppWhenRun used to provide, and is the
    // one variant that still works from inside an extension.
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

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
