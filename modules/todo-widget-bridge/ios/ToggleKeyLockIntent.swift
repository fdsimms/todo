import AppIntents
import Foundation

// A Shortcuts action: "Toggle Key Lock", given a key code.
//
// This is the route for a plain NFC tag with nothing written to it. A Shortcuts
// personal automation can fire on a tag it has been shown once, and this is the
// action it runs. **Shortcuts does not tell an action which tag fired it**, so
// the tag cannot be the credential here: the key code is. The code is the
// token of a link key (`NfcKey.secret`, src/utils/nfcKey.ts), copied from the
// key's row on the Screen Time screen and pasted into this action's parameter.
// Run by hand with no code, or with a wrong one, this does nothing: the app
// answers "not recognized", the same single answer an unknown link tag gets.
//
// It is deliberately not in DundundunShortcuts (AddTaskIntent.swift), so it
// has no Siri phrase and no Spotlight suggestion. A spoken "toggle my key lock"
// would be the way out the feature exists to close. It is still listed as an
// action inside the Shortcuts app, which is the only place it is meant to be
// found.
//
// The code is checked in the app, not here. This runs in a process with no
// access to the key list, so perform() only queues the code and opens the app,
// and processPendingKeyScans in src/utils/widgetSync.ts hands it to
// `useNfcKeyStore.applyScan('link', code)`, the call a tapped link tag makes.
// That is also why a scan here pauses an open schedule before it locks, exactly
// as a tag does, and why it can never end a penalty, a gate or a focus session.
private enum PendingKeyScanStore {
    // Must match the same literals in TodoWidgetBridgeModule.swift, which
    // drains the file. File-scoped `private`, so each file keeps its own copy,
    // as the rest of this module does.
    static let appGroupID = "group.com.fdsimms.dundundun"
    static let pendingFileName = "pending_key_scans.json"

    struct PendingKeyScan: Codable {
        let code: String
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

    static func append(_ scan: PendingKeyScan) {
        guard let fileURL = fileURL() else { return }
        var queued: [PendingKeyScan] = []
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([PendingKeyScan].self, from: data) {
            queued = decoded
        }
        queued.append(scan)
        guard let data = try? JSONEncoder().encode(queued) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}

struct ToggleKeyLockIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Key Lock"
    static var description = IntentDescription(
        "Locks or unlocks your chosen apps, the way tapping a key tag does. Needs the key code from the Screen Time screen."
    )

    // The same pair MarkDisposedIntent, LogMedicationIntent and LogDreamIntent
    // carry: the check happens in the app, so the app has to come forward.
    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Key code", requestValueDialog: IntentDialog("What is the key code?"))
    var code: String

    static var parameterSummary: some ParameterSummary {
        Summary("Toggle key lock with code \(\.$code)")
    }

    init() {}

    init(code: String) {
        self.code = code
    }

    func perform() async throws -> some IntentResult {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .result() }
        PendingKeyScanStore.append(
            PendingKeyScanStore.PendingKeyScan(
                code: trimmed,
                at: ISO8601DateFormatter().string(from: Date())
            )
        )
        return .result()
    }
}
