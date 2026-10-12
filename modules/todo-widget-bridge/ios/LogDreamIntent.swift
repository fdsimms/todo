import AppIntents
import Foundation

// "Hey Siri, log a dream in dundundun." (or the Action Button, or Shortcuts)
//
// AddTaskIntent.swift's shape, pointed at the dream log: the words are free
// text, so the phrase cannot carry them (App Shortcut phrases take only
// AppEntity/AppEnum parameters) and Siri asks "What did you dream?" with the
// intent's own requestValueDialog instead.
//
// perform() queues the dream with the moment it was said and opens the app,
// which writes it on the next foreground (processPendingDreams in
// src/utils/widgetSync.ts). The moment travels with it so a dream said on
// waking files under that day however long the app takes to get round to it.
// Nothing here reads the journal, and the app navigates nowhere on arrival,
// so the journal's Face ID lock stays closed: this can only add.
private enum PendingDreamStore {
    // Must match the same literals in TodoWidgetBridgeModule.swift, which
    // drains the file. File-scoped `private`, so each file keeps its own copy,
    // as the rest of this module does.
    static let appGroupID = "group.com.fdsimms.dundundun"
    static let pendingFileName = "pending_dreams.json"

    struct PendingDream: Codable {
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

    static func append(_ dream: PendingDream) {
        guard let fileURL = fileURL() else { return }
        var queued: [PendingDream] = []
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([PendingDream].self, from: data) {
            queued = decoded
        }
        queued.append(dream)
        guard let data = try? JSONEncoder().encode(queued) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}

struct LogDreamIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a Dream"
    static var description = IntentDescription("Writes down a dream in your dream log.")

    // The same pair MarkDisposedIntent and LogMedicationIntent carry.
    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Dream", requestValueDialog: IntentDialog("What did you dream?"))
    var dream: String

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$dream)")
    }

    init() {}

    init(dream: String) {
        self.dream = dream
    }

    func perform() async throws -> some IntentResult {
        let trimmed = dream.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .result() }
        PendingDreamStore.append(
            PendingDreamStore.PendingDream(
                text: trimmed,
                at: ISO8601DateFormatter().string(from: Date())
            )
        )
        return .result()
    }
}
