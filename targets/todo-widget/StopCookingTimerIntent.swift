import AppIntents
import WidgetKit

// Runs in the widget extension process when a cooking Live Activity's Done
// button is tapped (TimerLiveActivity.swift, kind == "cook" or "prep"). A
// recipe has no "complete" the way a task does, so Done here means "stop the
// timer and log the time" — the same outcome as tapping Stop in the app (see
// stopCookTimer/stopPrepTimer in useRecipeStore.ts). The extension can't
// reach the app's SQLite database or the recipe store, so it only queues the
// run's key and opens the app (openAppWhenRun == true) to finish the job —
// processPendingTimerStops() in liveActivity.ts drains the queue and calls
// the real store action as soon as the app becomes active. Mirrors
// CompleteTaskIntent's shape exactly, one file over.
struct StopCookingTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Cooking Timer"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = true

    // 'cook:<recipeId>' or 'prep:<recipeId>' — see TimerActivityAttributes.key.
    @Parameter(title: "Run Key")
    var runKey: String

    init() {}

    init(runKey: String) {
        self.runKey = runKey
    }

    func perform() async throws -> some IntentResult {
        addPendingTimerStop(key: runKey)
        return .result()
    }
}
