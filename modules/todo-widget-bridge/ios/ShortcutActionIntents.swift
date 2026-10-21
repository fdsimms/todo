import AppIntents
import Foundation

// Log Water, Log Mood, Add to Grocery List and Open Screen: four Shortcuts
// actions that share one queue.
//
// Each is LogFoodIntent.swift's shape: perform() appends a record with the
// moment it was asked and opens the app, which acts on it on the next
// foreground (processPendingShortcutActions in src/utils/widgetSync.ts,
// parsed by src/utils/shortcutQueue.ts). One file and one queue rather than
// four, because the records are tiny and the app handles them in order.
//
// Only Log Water and Add to Grocery List are in DundundunShortcuts (Siri
// phrases): an app may have at most 10 App Shortcuts, and those two make it
// ten. Log Mood and Open Screen are actions in the Shortcuts app with no
// phrase, the way ToggleKeyLockIntent is.
//
// Written without a compiler, copying LogFoodIntent.swift and
// MarkDisposedIntent.swift's AppEnum line for line; a build is the first
// check on it.
private enum PendingShortcutActionStore {
    // Must match the same literals in TodoWidgetBridgeModule.swift, which
    // drains the file. File-scoped `private`, so each file keeps its own copy,
    // as the rest of this module does.
    static let appGroupID = "group.com.fdsimms.dundundun"
    static let pendingFileName = "pending_shortcut_actions.json"

    // `kind` is "water", "mood", "grocery" or "open". `value` is the mood
    // level, the item or the screen's route; `count` is the glasses of water.
    struct PendingAction: Codable {
        let kind: String
        let value: String?
        let count: Int?
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

    static func append(kind: String, value: String? = nil, count: Int? = nil) {
        guard let fileURL = fileURL() else { return }
        var queued: [PendingAction] = []
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([PendingAction].self, from: data) {
            queued = decoded
        }
        queued.append(PendingAction(
            kind: kind,
            value: value,
            count: count,
            at: ISO8601DateFormatter().string(from: Date())
        ))
        guard let data = try? JSONEncoder().encode(queued) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}

struct LogWaterIntent: AppIntent {
    static var title: LocalizedStringResource = "Log Water"
    static var description = IntentDescription("Adds glasses of water to today's food log.")

    // The same pair LogFoodIntent carries.
    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    // Optional so "log water" alone is one glass, the size set in the app.
    @Parameter(title: "Glasses")
    var glasses: Int?

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$glasses) glasses of water")
    }

    init() {}

    func perform() async throws -> some IntentResult {
        let count = max(1, min(glasses ?? 1, 20))
        PendingShortcutActionStore.append(kind: "water", count: count)
        return .result()
    }
}

// The five levels of MOOD_LEVELS in src/utils/moodLog.ts, labelled the same.
enum MoodLevelAppEnum: String, AppEnum {
    case veryLow = "1"
    case low = "2"
    case ok = "3"
    case good = "4"
    case veryGood = "5"

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Mood"

    static var caseDisplayRepresentations: [MoodLevelAppEnum: DisplayRepresentation] = [
        .veryLow: "Very low",
        .low: "Low",
        .ok: "OK",
        .good: "Good",
        .veryGood: "Very good",
    ]
}

struct LogMoodIntent: AppIntent {
    static var title: LocalizedStringResource = "Log Mood"
    static var description = IntentDescription("Records how you feel. Without a mood, opens the mood log to pick one.")

    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Mood")
    var mood: MoodLevelAppEnum?

    static var parameterSummary: some ParameterSummary {
        Summary("Log mood \(\.$mood)")
    }

    init() {}

    func perform() async throws -> some IntentResult {
        PendingShortcutActionStore.append(kind: "mood", value: mood?.rawValue)
        return .result()
    }
}

struct AddGroceryItemIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Grocery List"
    static var description = IntentDescription("Adds an item to the grocery list.")

    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    // Free text, so the phrase can't carry it and Siri asks instead, the way
    // AddTaskIntent asks for a title.
    @Parameter(title: "Item", requestValueDialog: IntentDialog("What do you want to add?"))
    var item: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$item) to the grocery list")
    }

    init() {}

    func perform() async throws -> some IntentResult {
        let trimmed = item.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .result() }
        PendingShortcutActionStore.append(kind: "grocery", value: trimmed)
        return .result()
    }
}

// The screens Open Screen offers, by the route the app names them with. The
// app still checks each one is reachable when it lands (a switched-off area
// stays shut), so a case here is an offer, not a promise.
enum AppScreenAppEnum: String, AppEnum {
    case today = "Today"
    case groceries = "Groceries"
    case projects = "Projects"
    case recipes = "Recipes"
    case mealPlan = "MealPlan"
    case foodLog = "FoodLog"
    case calendar = "Calendar"
    case logbook = "Logbook"
    case stats = "Stats"
    case mood = "Mood"
    case medications = "Medications"
    case journal = "Journal"
    case weight = "Weight"
    case sleep = "Sleep"
    case workouts = "Workouts"
    case people = "People"
    case search = "Search"

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Screen"

    static var caseDisplayRepresentations: [AppScreenAppEnum: DisplayRepresentation] = [
        .today: "Today",
        .groceries: "Groceries",
        .projects: "Projects",
        .recipes: "Recipes",
        .mealPlan: "Meal plan",
        .foodLog: "Food log",
        .calendar: "Calendar",
        .logbook: "Logbook",
        .stats: "Stats",
        .mood: "Mood",
        .medications: "Medications",
        .journal: "Journal",
        .weight: "Weight",
        .sleep: "Sleep",
        .workouts: "Workouts",
        .people: "People",
        .search: "Search",
    ]
}

struct OpenScreenIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Screen"
    static var description = IntentDescription("Opens the app on one screen.")

    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Screen")
    var screen: AppScreenAppEnum

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$screen)")
    }

    init() {}

    func perform() async throws -> some IntentResult {
        PendingShortcutActionStore.append(kind: "open", value: screen.rawValue)
        return .result()
    }
}
