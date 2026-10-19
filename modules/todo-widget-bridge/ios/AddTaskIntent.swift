import AppIntents
import Foundation

// This file — not targets/todo-widget — is where an App Shortcut has to
// live: AppShortcutsProvider and the intent(s) it wraps must be compiled
// into the *main app* target, not an extension, or the app never shows up
// in the Shortcuts/Siri/Action Button picker at all (an extension-hosted
// AppShortcutsProvider is only for that extension's own shortcuts, e.g. a
// notification-content extension). This module's podspec already globs
// every .swift file here into the app target, which is what makes it the
// right home — see modules/todo-widget-bridge/ios/TodoWidgetBridge.podspec.

private let appGroupID = "group.com.fdsimms.dundundun"
// Must match the same literal in TodoWidgetBridgeModule.swift — same target,
// but Swift top-level `private` is file-scoped, not target-scoped, so the
// two copies can't share one declaration. Same convention the rest of this
// module already follows for its App Group filenames.
private let pendingAddTasksFileName = "widget_pending_add_tasks.json"

private func pendingAddTasksFileURL() -> URL? {
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupID
    ) else {
        return nil
    }
    return containerURL
        .appendingPathComponent("Library/Application Support", isDirectory: true)
        .appendingPathComponent(pendingAddTasksFileName)
}

/// Appends a title to the queue. **The read and the write are one
/// coordinated write** (`coordinatedQueueWrite`, WatchSession.swift), as are
/// the watch's "add" appends (WatchSession's `appendToQueue`) and the app's
/// drain (`drainPendingAddTasks`): each reads the whole file and writes it
/// back or deletes it, so two at once would write over each other's title, or
/// delete one appended between the drain's read and its delete.
private func addPendingTaskTitle(_ title: String) {
    guard let fileURL = pendingAddTasksFileURL() else { return }
    coordinatedQueueWrite(fileURL) { url in
        var titles: [String] = []
        if let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode([String].self, from: data) {
            titles = decoded
        }
        titles.append(title)
        guard let data = try? JSONEncoder().encode(titles) else { return }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: url, options: .atomic)
    }
}

// Backs the Action Button (and Siri, and the Shortcuts app) via the
// AppShortcut declared below. Runs out of process from the RN/JS side the
// same way CompleteTaskIntent does (CompleteTaskIntent.swift, beside this file)
// and for the same reason — this Swift code has no way to reach the app's
// SQLite database or the recurrence/streak/chain logic that addTask() runs in
// JS — so it only queues the dictated title and opens the app
// (openAppWhenRun) to finish the job:
// processPendingAddTasks() in widgetSync.ts drains the queue on launch/
// foreground and calls the real addTask(). Deliberately silent on arrival —
// no navigation, no sheet — mirroring handleIncomingUrl's "silent capture"
// for `dundundun://add?title=…`, which this is the hardware-button
// equivalent of: the whole point is a task captured without looking at the
// screen.
struct AddTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Task"
    static var description = IntentDescription("Adds a task to dundundun.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Task", requestValueDialog: IntentDialog("What do you want to add?"))
    var title: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$title)")
    }

    init() {}

    init(title: String) {
        self.title = title
    }

    func perform() async throws -> some IntentResult {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .result() }
        addPendingTaskTitle(trimmed)
        return .result()
    }
}

// Donates AddTaskIntent to the system so it's selectable directly — no
// Shortcut to build first — from the Shortcuts app, Siri, and (the point of
// this file) iOS 17+'s Action Button "Shortcut" picker. The phrase leaves the
// title unfilled, which is what makes Siri prompt with the intent's own
// requestValueDialog and take the answer by voice — a double-press of the
// Action Button, spoken title, done. It can't interpolate \.$title into the
// phrase to take the title inline instead: App Shortcut phrases only accept
// AppEntity/AppEnum parameters, and title is a free-text String, so Xcode's
// ExtractAppIntentsMetadata archive step rejects it ("AppEntity and AppEnum
// are the only allowed types for title").
//
// The two disposal shortcuts below take the opposite shape, and the contrast is
// the thing to read before adding a third. Each presets its own outcome on
// MarkDisposedIntent (see MarkDisposedIntent.swift) so the phrase spells that
// half out and interpolates only the item — which it *can* interpolate, because
// the item is an AppEntity and this title is not. One sentence, no follow-up
// question. Splitting them this way rather than interpolating the outcome enum
// too is what keeps "used up" and "gone bad" sounding like things people say
// instead of a form being filled in.
struct DundundunShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTaskIntent(),
            phrases: [
                "Add a task in \(.applicationName)",
            ],
            shortTitle: "Add Task",
            systemImageName: "square.and.pencil"
        )
        AppShortcut(
            intent: MarkDisposedIntent(outcome: .usedUp),
            phrases: [
                "Mark \(\.$item) as used up in \(.applicationName)",
                "I used up \(\.$item) in \(.applicationName)",
            ],
            shortTitle: "Mark Used Up",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: MarkDisposedIntent(outcome: .spoiled),
            phrases: [
                "Mark \(\.$item) as gone bad in \(.applicationName)",
            ],
            shortTitle: "Mark Gone Bad",
            systemImageName: "trash"
        )
        // The medication is an AppEntity (LogMedicationIntent.swift), so it can
        // be said inside the sentence, the same way the pantry item is above.
        AppShortcut(
            intent: LogMedicationIntent(),
            phrases: [
                "Log \(\.$medication) in \(.applicationName)",
                "I took \(\.$medication) in \(.applicationName)",
            ],
            shortTitle: "Log a Dose",
            systemImageName: "pills"
        )
        // Free text again, so no parameter in the phrase: Siri asks what the
        // dream was (LogDreamIntent.swift), the same way Add Task asks.
        AppShortcut(
            intent: LogDreamIntent(),
            phrases: [
                "Log a dream in \(.applicationName)",
                "Write down a dream in \(.applicationName)",
            ],
            shortTitle: "Log a Dream",
            systemImageName: "moon.stars"
        )
        // Free text again: Siri asks what was eaten (LogFoodIntent.swift).
        AppShortcut(
            intent: LogFoodIntent(),
            phrases: [
                "Log food in \(.applicationName)",
                "Log a meal in \(.applicationName)",
            ],
            shortTitle: "Log Food",
            systemImageName: "fork.knife"
        )
        // Nothing to fill in: which workout "my workout" is gets worked out in
        // the app (StartWorkoutIntent.swift).
        AppShortcut(
            intent: StartWorkoutIntent(),
            phrases: [
                "Start my workout in \(.applicationName)",
                "Start a workout in \(.applicationName)",
            ],
            shortTitle: "Start Workout",
            systemImageName: "dumbbell.fill"
        )
        // The routine is an AppEntity, so it can be said inside the sentence,
        // the way the pantry item and the medication are above. The app asks
        // the system to read the names again whenever the routine list changes
        // (writeWorkoutRoutineIndex in TodoWidgetBridgeModule.swift).
        AppShortcut(
            intent: StartRoutineIntent(),
            phrases: [
                "Start \(\.$routine) in \(.applicationName)",
            ],
            shortTitle: "Start a Routine",
            systemImageName: "dumbbell"
        )
    }
}
