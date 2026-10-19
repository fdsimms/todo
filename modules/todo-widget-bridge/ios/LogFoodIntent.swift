import AppIntents
import Foundation

// "Hey Siri, log food in dundundun." (or the Action Button, or Shortcuts)
//
// LogDreamIntent.swift's shape, pointed at the food log: the words are free
// text, so the phrase cannot carry them (App Shortcut phrases take only
// AppEntity/AppEnum parameters) and Siri asks "What did you eat?" with the
// intent's own requestValueDialog instead.
//
// perform() queues the description with the moment it was said and opens the
// app, which hands it to the offline meal queue on the next foreground
// (processPendingFoods in src/utils/widgetSync.ts). Nothing is logged here or
// by that drain: the queue estimates the meal and a person confirms it on the
// Food log screen, the rule src/utils/estimateQueue.ts states.
private enum PendingFoodStore {
    // Must match the same literals in TodoWidgetBridgeModule.swift, which
    // drains the file. File-scoped `private`, so each file keeps its own copy,
    // as the rest of this module does.
    static let appGroupID = "group.com.fdsimms.dundundun"
    static let pendingFileName = "pending_foods.json"

    struct PendingFood: Codable {
        let text: String
        let at: String
    }

    static func fileURL() -> URL? {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        ) else {
            return nil
        }
        return containerURL
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(pendingFileName)
    }

    static func append(_ food: PendingFood) {
        guard let fileURL = fileURL() else { return }
        var queued: [PendingFood] = []
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([PendingFood].self, from: data) {
            queued = decoded
        }
        queued.append(food)
        guard let data = try? JSONEncoder().encode(queued) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}

struct LogFoodIntent: AppIntent {
    static var title: LocalizedStringResource = "Log Food"
    static var description = IntentDescription("Describes a meal or snack to add to your food log.")

    // The same pair LogDreamIntent carries.
    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Food", requestValueDialog: IntentDialog("What did you eat?"))
    var food: String

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$food)")
    }

    init() {}

    init(food: String) {
        self.food = food
    }

    func perform() async throws -> some IntentResult {
        let trimmed = food.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .result() }
        PendingFoodStore.append(
            PendingFoodStore.PendingFood(
                text: trimmed,
                at: ISO8601DateFormatter().string(from: Date())
            )
        )
        return .result()
    }
}
