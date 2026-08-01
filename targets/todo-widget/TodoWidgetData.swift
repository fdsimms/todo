import Foundation
import SwiftUI

private let appGroupID = "group.com.fdsimms.dundundun"
private let snapshotFileName = "widget_data.json"

struct WidgetTask: Codable, Identifiable {
    let id: String
    let title: String
    let priority: Int
    let focused: Bool
    let dueDate: String?
    let category: String?
    let streakCount: Int
    let recurrenceType: String
}

struct WidgetSnapshot: Codable {
    let updatedAt: String
    let visibleTasks: [WidgetTask]
    let focusedTasks: [WidgetTask]
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

// Mirrors PRIORITY_COLORS in src/types/index.ts — keep in sync if that changes.
func priorityColor(_ priority: Int) -> Color {
    switch priority {
    case 1: return Color(hex: "30D158") // Low
    case 2: return Color(hex: "FFD60A") // Medium
    case 3: return Color(hex: "FF9F0A") // High
    case 4: return Color(hex: "FF453A") // Urgent
    default: return Color.clear        // None
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
    let separator: Color

    static let dark = WidgetPalette(
        bg: Color(hex: "000000"),
        bgSecondary: Color(hex: "1C1C1E"),
        text: Color(hex: "FFFFFF"),
        textSecondary: Color(hex: "8E8E93"),
        textTertiary: Color(hex: "636366"),
        accent: Color(hex: "0A84FF"),
        separator: Color(hex: "38383A")
    )

    static let light = WidgetPalette(
        bg: Color(hex: "F2F2F7"),
        bgSecondary: Color(hex: "FFFFFF"),
        text: Color(hex: "000000"),
        textSecondary: Color(hex: "6C6C70"),
        textTertiary: Color(hex: "8A8A8E"),
        accent: Color(hex: "007AFF"),
        separator: Color(hex: "C6C6C8")
    )

    static func forScheme(_ scheme: ColorScheme) -> WidgetPalette {
        scheme == .dark ? .dark : .light
    }
}
