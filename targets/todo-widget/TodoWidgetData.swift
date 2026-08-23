import Foundation
import SwiftUI

// Not `private` — CompleteTaskIntent.swift (same target) needs these too.
let appGroupID = "group.com.fdsimms.dundundun"
let snapshotFileName = "widget_data.json"
// Must match the same literal in TodoWidgetBridgeModule.swift — a separate
// Xcode target/compilation unit, so the string can't be shared directly.
let pendingCompletionsFileName = "widget_pending_completions.json"

struct WidgetTask: Codable, Identifiable {
    let id: String
    let title: String
    let priority: Int
    let pinned: Bool
    let dueDate: String?
    let category: String?
    let streakCount: Int
    let recurrenceType: String
}

struct WidgetSnapshot: Codable {
    let updatedAt: String
    let visibleTasks: [WidgetTask]
    let pinnedTasks: [WidgetTask]
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
    let separator: Color

    static let dark = WidgetPalette(
        bg: Color(hex: "000000"),
        bgSecondary: Color(hex: "1C1C1E"),
        text: Color(hex: "FFFFFF"),
        textSecondary: Color(hex: "8E8E93"),
        textTertiary: Color(hex: "636366"),
        accent: Color(hex: "0A84FF"),
        orange: Color(hex: "FF9F0A"),
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
        separator: Color(hex: "C6C6C8")
    )

    static func forScheme(_ scheme: ColorScheme) -> WidgetPalette {
        scheme == .dark ? .dark : .light
    }
}
