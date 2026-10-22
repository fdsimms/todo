import AppIntents
import Foundation

// "Hey Siri, write in my journal in dundundun." (or the Action Button, or Shortcuts)
//
// LogDreamIntent.swift's shape, pointed at the journal: the words are free
// text, so the phrase cannot carry them and Siri asks "What do you want to
// write down?" with the intent's own requestValueDialog instead.
//
// It shares the dream intent's queue file. Each record carries `kind`
// ("journal"), which is what tells processPendingDreams in
// src/utils/widgetSync.ts which log to write it into; a record without one is a
// dream, so a file the older intent wrote still reads right. Nothing here reads
// the journal, and the app navigates nowhere on arrival, so the journal's Face
// ID lock stays closed: this can only add.
private enum PendingJournalStore {
    // Must match the same literals in LogDreamIntent.swift and
    // TodoWidgetBridgeModule.swift, which drains the file. File-scoped
    // `private`, so each file keeps its own copy, as the rest of this module does.
    static let appGroupID = "group.com.fdsimms.dundundun"
    static let pendingFileName = "pending_dreams.json"

    struct PendingEntry: Codable {
        let text: String
        let at: String
        let kind: String?
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

    static func append(_ entry: PendingEntry) {
        guard let fileURL = fileURL() else { return }
        var queued: [PendingEntry] = []
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([PendingEntry].self, from: data) {
            queued = decoded
        }
        queued.append(entry)
        guard let data = try? JSONEncoder().encode(queued) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}

struct LogJournalIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a Journal Entry"
    static var description = IntentDescription("Writes an entry in your journal.")

    // The same pair MarkDisposedIntent and LogMedicationIntent carry.
    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Entry", requestValueDialog: IntentDialog("What do you want to write down?"))
    var entry: String

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$entry)")
    }

    init() {}

    init(entry: String) {
        self.entry = entry
    }

    func perform() async throws -> some IntentResult {
        let trimmed = entry.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .result() }
        PendingJournalStore.append(
            PendingJournalStore.PendingEntry(
                text: trimmed,
                at: ISO8601DateFormatter().string(from: Date()),
                kind: "journal"
            )
        )
        return .result()
    }
}
