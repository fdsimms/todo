import AppIntents
import Foundation

// "Hey Siri, start my workout in dundundun." and "Start Push A in dundundun."
//
// Two intents with one queue. StartWorkoutIntent takes nothing: which workout
// "my workout" is (the one going, the workout task on Today, the one program's
// next routine) is worked out in JS, where the tasks and the programs are.
// StartRoutineIntent names a routine inside the sentence, so the routine has
// to be an AppEntity with a query to resolve the spoken name against — the
// MarkDisposedIntent.swift shape, read against an index the app writes into
// the App Group (src/utils/workoutSiri.ts → writeWorkoutRoutineIndex in
// TodoWidgetBridgeModule.swift), since nothing here can open the app's SQLite.
//
// perform() only queues what was asked, with the moment, and opens the app;
// processPendingWorkoutStarts in src/utils/widgetSync.ts starts it on the next
// foreground, newest entry only. Starting a workout lays its sets out, links
// its task and opens workout mode, none of which this process can reach.
//
// Main app only (the podspec's glob): no widget names these intents, and an
// intent that opens the app has to run in the app's own process anyway (see
// docs/native-targets.md).
private enum WorkoutStartStore {
    // Must match the same literals in TodoWidgetBridgeModule.swift, which
    // writes the first and drains the second. File-scoped `private`, so each
    // file keeps its own copy, as the rest of this module does.
    static let appGroupID = "group.com.fdsimms.dundundun"
    static let indexFileName = "siri_workout_routines.json"
    static let pendingFileName = "pending_workout_starts.json"

    struct Entry: Codable {
        let id: String
        let name: String
    }

    struct PendingStart: Codable {
        let routineId: String?
        let name: String?
        let at: String
    }

    static func fileURL(_ name: String) -> URL? {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        ) else {
            return nil
        }
        return containerURL
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(name)
    }

    /// Empty is an ordinary answer: no routines yet, or the Workouts area off
    /// (the app writes an empty list then).
    static func entries() -> [Entry] {
        guard let fileURL = fileURL(indexFileName),
              let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode([Entry].self, from: data) else {
            return []
        }
        return decoded
    }

    static func append(_ start: PendingStart) {
        guard let fileURL = fileURL(pendingFileName) else { return }
        var queued: [PendingStart] = []
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([PendingStart].self, from: data) {
            queued = decoded
        }
        queued.append(start)
        guard let data = try? JSONEncoder().encode(queued) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}

/// Lowercased, trimmed and with inner runs of spaces made one: the loose half
/// of `exerciseNameKey`, which the JS drain uses to resolve the spoken name a
/// second time. It doesn't have to be right, only to surface the candidates.
private func routineSpokenKey(_ raw: String) -> String {
    raw.trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .split(whereSeparator: { $0.isWhitespace })
        .joined(separator: " ")
}

/// Asks the system to read the App Shortcuts' parameters again, so a routine
/// added or renamed since is a name Siri can hear in "Start <routine>". Called
/// by `writeWorkoutRoutineIndex` after each write. Here rather than in
/// TodoWidgetBridgeModule.swift so that file needn't import AppIntents beside
/// ExpoModulesCore's own DSL names. Provider-wide: it refreshes the pantry and
/// medication phrases too.
func refreshAppShortcutParameters() {
    DundundunShortcuts.updateAppShortcutParameters()
}

struct RoutineEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Routine"
    static var defaultQuery = RoutineQuery()

    var id: String
    var name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct RoutineQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [RoutineEntity] {
        let wanted = Set(identifiers)
        return WorkoutStartStore.entries()
            .filter { wanted.contains($0.id) }
            .map { RoutineEntity(id: $0.id, name: $0.name) }
    }

    /// The names Siri can hear in "Start <routine>", and what it offers when
    /// asked which. Already sorted by name app-side (`buildRoutineIndex`).
    func suggestedEntities() async throws -> [RoutineEntity] {
        WorkoutStartStore.entries().map { RoutineEntity(id: $0.id, name: $0.name) }
    }

    /// Every match in the best tier that has any, so two plausible routines are
    /// a question Siri asks rather than a choice made silently — the reason
    /// PantryItemQuery does the same.
    func entities(matching string: String) async throws -> [RoutineEntity] {
        let key = routineSpokenKey(string)
        guard !key.isEmpty else { return [] }
        let entries = WorkoutStartStore.entries()

        let tiers: [(WorkoutStartStore.Entry) -> Bool] = [
            { routineSpokenKey($0.name) == key },
            { routineSpokenKey($0.name).hasPrefix(key) },
            { routineSpokenKey($0.name).contains(key) },
        ]

        for matches in tiers.map({ predicate in entries.filter(predicate) }) where !matches.isEmpty {
            return matches.map { RoutineEntity(id: $0.id, name: $0.name) }
        }
        return []
    }
}

struct StartWorkoutIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Workout"
    static var description = IntentDescription("Starts your workout: the one in progress, today's workout task, or your program's next routine.")

    // The same pair MarkDisposedIntent and LogMedicationIntent carry.
    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    init() {}

    func perform() async throws -> some IntentResult {
        WorkoutStartStore.append(
            WorkoutStartStore.PendingStart(
                routineId: nil,
                name: nil,
                at: ISO8601DateFormatter().string(from: Date())
            )
        )
        return .result()
    }
}

struct StartRoutineIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a Routine"
    static var description = IntentDescription("Starts a workout from one of your routines.")

    // The same pair as above.
    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Routine", requestValueDialog: IntentDialog("Which routine?"))
    var routine: RoutineEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Start \(\.$routine)")
    }

    init() {}

    func perform() async throws -> some IntentResult {
        WorkoutStartStore.append(
            WorkoutStartStore.PendingStart(
                routineId: routine.id,
                name: routine.name,
                at: ISO8601DateFormatter().string(from: Date())
            )
        )
        return .result()
    }
}
