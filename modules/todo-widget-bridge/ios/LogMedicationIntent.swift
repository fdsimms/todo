import AppIntents
import Foundation

// "Hey Siri, log ibuprofen in dundundun."
//
// MarkDisposedIntent.swift's shape, pointed at the medication log: the
// medication is spoken inside the phrase, so it has to be an AppEntity, and its
// query reads an index the app writes into the App Group
// (src/utils/medicationIndex.ts → writeMedicationIndex in
// TodoWidgetBridgeModule.swift), since nothing here can open the app's SQLite.
//
// perform() queues the dose with the moment it was asked for and opens the
// app, which records it on the next foreground (processPendingDoses in
// src/utils/widgetSync.ts). The moment travels with it because "6 hours apart"
// is measured from when the dose was taken, not from when the app got round
// to recording it. The app fills in the amount from the last dose recorded,
// the same as the Medications screen's quick button, and checks the limit and
// the supply on the way in. Opening the app is what lets those two answer
// straight away rather than whenever it is next opened.
private enum MedicationIndexStore {
    // Must match the same literals in TodoWidgetBridgeModule.swift, which
    // writes the first and drains the second. File-scoped `private`, so each
    // file keeps its own copy, as the rest of this module does.
    static let appGroupID = "group.com.fdsimms.dundundun"
    static let indexFileName = "siri_medication_index.json"
    static let pendingFileName = "pending_doses.json"

    struct Entry: Codable {
        let id: String
        let name: String
    }

    struct PendingDose: Codable {
        let id: String?
        let name: String
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

    static func entries() -> [Entry] {
        guard let fileURL = fileURL(indexFileName),
              let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode([Entry].self, from: data) else {
            return []
        }
        return decoded
    }

    static func append(_ dose: PendingDose) {
        guard let fileURL = fileURL(pendingFileName) else { return }
        var queued: [PendingDose] = []
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([PendingDose].self, from: data) {
            queued = decoded
        }
        queued.append(dose)
        guard let data = try? JSONEncoder().encode(queued) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}

/// Lowercased and trimmed. No plural stripping, unlike the pantry's: a
/// medication name ending in "s" is usually just its name ("Lexapros" is not
/// something anybody says), and the JS side re-resolves the spoken name with
/// the log's own key anyway.
private func medicationSpokenKey(_ raw: String) -> String {
    raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

struct MedicationEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Medication"
    static var defaultQuery = MedicationQuery()

    var id: String
    var name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct MedicationQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [MedicationEntity] {
        let wanted = Set(identifiers)
        return MedicationIndexStore.entries()
            .filter { wanted.contains($0.id) }
            .map { MedicationEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [MedicationEntity] {
        MedicationIndexStore.entries().map { MedicationEntity(id: $0.id, name: $0.name) }
    }

    /// Every match in the best tier that has any, so two plausible matches are
    /// a question Siri asks rather than a choice made silently — the reason
    /// PantryItemQuery does the same.
    func entities(matching string: String) async throws -> [MedicationEntity] {
        let key = medicationSpokenKey(string)
        guard !key.isEmpty else { return [] }
        let entries = MedicationIndexStore.entries()

        let tiers: [(MedicationIndexStore.Entry) -> Bool] = [
            { medicationSpokenKey($0.name) == key },
            { medicationSpokenKey($0.name).hasPrefix(key) },
            { medicationSpokenKey($0.name).contains(key) },
        ]

        for matches in tiers.map({ predicate in entries.filter(predicate) }) where !matches.isEmpty {
            return matches.map { MedicationEntity(id: $0.id, name: $0.name) }
        }
        return []
    }
}

struct LogMedicationIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a Dose"
    static var description = IntentDescription("Records a dose of a medication you have recorded before.")

    // The same pair MarkDisposedIntent carries, for the same reason.
    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Medication", requestValueDialog: IntentDialog("Which medication?"))
    var medication: MedicationEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$medication)")
    }

    init() {}

    /// For the Medications widget's buttons, which know the medication already.
    init(medication: MedicationEntity) {
        self.medication = medication
    }

    func perform() async throws -> some IntentResult {
        MedicationIndexStore.append(
            MedicationIndexStore.PendingDose(
                id: medication.id,
                name: medication.name,
                at: ISO8601DateFormatter().string(from: Date())
            )
        )
        return .result()
    }
}
