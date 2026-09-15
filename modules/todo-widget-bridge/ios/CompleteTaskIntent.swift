import AppIntents
import Foundation
import WidgetKit

// Backs the checkbox on the Today widget (`Button(intent:)` in
// TodoTodayWidget.swift). It can't reach the app's SQLite database or the JS
// logic that handles recurrence/streaks/chains when a task actually completes,
// so it queues the task id and brings the app forward to finish the job:
// processPendingWidgetCompletions() in widgetSync.ts drains the queue and calls
// the real completeTask() as soon as the app becomes active, after TodayScreen
// has had a chance to play the same complete animation a normal in-app tap gets
// (see useWidgetCompletionStore / TaskItem's autoComplete prop) — the point of
// opening the app immediately is watching that happen. The widget shows an
// optimistic checked state in the meantime (loadPendingCompletionIds in
// TodoWidgetData.swift reads the same queue file this writes).
//
// **This file lives here, not in targets/todo-widget/, because an intent that
// brings the app to the foreground has to be compiled into the main app target
// too.** Apple's "Configuring the runtime behavior of your app intents" is
// explicit that code in a widget extension runs only in the background, so an
// intent the extension is the *only* host for has no foreground-capable process
// to run in and the "open the app" half is silently dropped — the tap queues the
// completion and nothing else happens. This module's podspec globs every .swift
// file here into the app target (see TodoWidgetBridge.podspec's `s.source_files`),
// and withWidgetExtension.js's SHARED_SWIFT_FILES copies it into the extension
// as well, so both processes get the same declaration and the system has a
// foreground target to pick. Same reason AddTaskIntent.swift is here rather than
// in the widget target, arrived at from the other direction.
//
// Everything this file needs out of the App Group is kept file-private in the
// namespace below rather than reusing TodoWidgetData.swift's copies, which exist
// only in the widget target — this one has to compile in both.
private enum PendingCompletionQueue {
    // Must match the same literals in TodoWidgetBridgeModule.swift (which drains
    // this queue) and TodoWidgetData.swift (which reads it for the optimistic
    // checked state). Swift top-level `private` is file-scoped, so each file
    // keeps its own copy — the convention the rest of this module follows.
    static let appGroupID = "group.com.fdsimms.dundundun"
    static let fileName = "widget_pending_completions.json"

    static func fileURL() -> URL? {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        ) else {
            return nil
        }
        return containerURL
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(fileName)
    }

    static func add(taskId: String) {
        guard let fileURL = fileURL() else { return }
        var ids: Set<String> = []
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([String].self, from: data) {
            ids = Set(decoded)
        }
        ids.insert(taskId)
        guard let data = try? JSONEncoder().encode(Array(ids)) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}

struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Task"
    static var isDiscoverable: Bool = false
    // Deprecated in iOS 26 in favor of supportedModes below, and left in place
    // only for the OS versions this widget still has to support. Apple's own doc
    // for this property says setting it true "generates an error if the app
    // intent runs in an app extension" — with this file compiled into the app
    // target as well, the app is where it runs, which is the case that same doc
    // carves out ("for backward compatibility, you can set this property to true
    // for app intents you run inside your app").
    static var openAppWhenRun: Bool = true

    // The iOS 26 replacement, gated to the OS version it's actually available
    // on — AppIntent's own default (derived from openAppWhenRun above) still
    // covers everything older. .foreground(.immediate) is the same "open the app
    // before running" behavior openAppWhenRun used to provide, and is what tells
    // the system this intent needs the foreground-capable target rather than the
    // widget extension.
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    // With the type compiled into both targets, the system picks whichever
    // target is available unless told otherwise, and only one of them can bring
    // the app forward. supportedModes above already implies the answer, since
    // the extension cannot satisfy .foreground at all; this states it outright
    // so the routing doesn't rest on that inference. iOS 27+ only, so it is a
    // belt for the newest OS rather than the mechanism — 26 relies on
    // supportedModes, and the file's presence in the app target is what both
    // versions actually need.
    @available(iOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    @Parameter(title: "Task ID")
    var taskId: String

    init() {}

    init(taskId: String) {
        self.taskId = taskId
    }

    func perform() async throws -> some IntentResult {
        PendingCompletionQueue.add(taskId: taskId)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
