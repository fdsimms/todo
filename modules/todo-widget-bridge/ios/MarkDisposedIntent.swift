import AppIntents
import Foundation

// "Hey Siri, mark bananas as used up."
//
// **The item name is spoken inside the phrase, and that is the whole reason
// this file carries an AppEntity at all.** AddTaskIntent, beside this one,
// takes its free text the other way round — the phrase names no parameter and
// Siri asks for it — because App Shortcut phrases can only interpolate
// AppEntity/AppEnum parameters, never a String (see that file's own note: the
// ExtractAppIntentsMetadata archive step rejects it outright). Saying the item
// inside the sentence therefore means the item has to *be* an entity, and an
// entity has to have a query the system can resolve a spoken name against.
//
// That query runs in a process with no access to the app's SQLite database and
// no RN JS environment to ask, exactly as perform() does. So the app writes the
// small list of rows worth matching into the App Group whenever the catalog
// changes (src/utils/pantryIndex.ts → writePantryIndex in
// TodoWidgetBridgeModule.swift) and everything here reads only that file.
//
// perform() itself keeps the queue-and-open-the-app shape the other two intents
// use, and for a sharper reason than theirs: marking a row out is not one
// field. `markOutOfMany` clears the box's expiry, frozen and opened stamps,
// drops the live "Use up X" task the mark answers, and registers the undo
// entry — then `recordDisposal` records how it went and decides whether to
// offer the shelf-life correction. None of that is reachable from here.
// processPendingDisposals() in widgetSync.ts does it on the next foreground.
private enum PantryIndexStore {
    // Must match the same literals in TodoWidgetBridgeModule.swift, which
    // writes the first and drains the second. Swift top-level `private` is
    // file-scoped, so each file keeps its own copy — the convention the rest of
    // this module follows.
    static let appGroupID = "group.com.fdsimms.dundundun"
    static let indexFileName = "siri_pantry_index.json"
    static let pendingFileName = "pending_disposals.json"

    struct Entry: Codable {
        let id: String
        let name: String
    }

    struct PendingDisposal: Codable {
        let id: String?
        let name: String
        let outcome: String
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

    /// Empty is a perfectly ordinary answer here, not a failure: a fresh
    /// install has written no index yet, and an empty catalog writes an empty
    /// one. Either way Siri has nothing to offer and says so itself.
    static func entries() -> [Entry] {
        guard let fileURL = fileURL(indexFileName),
              let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode([Entry].self, from: data) else {
            return []
        }
        return decoded
    }

    static func append(_ disposal: PendingDisposal) {
        guard let fileURL = fileURL(pendingFileName) else { return }
        var queued: [PendingDisposal] = []
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([PendingDisposal].self, from: data) {
            queued = decoded
        }
        queued.append(disposal)
        guard let data = try? JSONEncoder().encode(queued) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}

/// Lowercased, trimmed, and stripped of the one plural ending worth guessing at
/// in this position.
///
/// **Deliberately far cruder than `groceryNameKey`, which is the app's real
/// answer to this.** Reimplementing that here would be a second copy of a
/// normalisation rule, in another language, drifting against the original with
/// nothing to catch it. It doesn't need to be right: the queue carries the
/// spoken name alongside whatever id this picks, and `resolveQueuedPantryItem`
/// re-resolves it against the live catalog with the app's own lookup. What this
/// has to do is surface the plausible candidates so Siri can show them.
private func spokenKey(_ raw: String) -> String {
    let lowered = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if lowered.hasSuffix("es") && lowered.count > 3 { return String(lowered.dropLast(2)) }
    if lowered.hasSuffix("s") && lowered.count > 2 { return String(lowered.dropLast()) }
    return lowered
}

struct PantryItemEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Item"
    static var defaultQuery = PantryItemQuery()

    var id: String
    var name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct PantryItemQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [PantryItemEntity] {
        let wanted = Set(identifiers)
        return PantryIndexStore.entries()
            .filter { wanted.contains($0.id) }
            .map { PantryItemEntity(id: $0.id, name: $0.name) }
    }

    /// What Siri offers when the phrase is said without an item, and the
    /// vocabulary it matches the spoken name against. The index is already
    /// capped and sorted app-side (`buildPantryIndex`), so this hands it back
    /// as-is rather than imposing a second order nobody chose.
    func suggestedEntities() async throws -> [PantryItemEntity] {
        PantryIndexStore.entries().map { PantryItemEntity(id: $0.id, name: $0.name) }
    }

    /// **Every match in the best tier that has any, rather than the single best
    /// match.** Returning one entity makes the choice silently; returning
    /// several is what gets Siri to ask which was meant. "Milk" against both
    /// "Milk" and "Oat milk" is a question, not a coin toss — and the tiers are
    /// what stop it being asked when it needn't be, since an exact hit never
    /// has to compete with the things merely containing it.
    func entities(matching string: String) async throws -> [PantryItemEntity] {
        let key = spokenKey(string)
        guard !key.isEmpty else { return [] }
        let entries = PantryIndexStore.entries()

        let tiers: [(PantryIndexStore.Entry) -> Bool] = [
            { spokenKey($0.name) == key },
            { spokenKey($0.name).hasPrefix(key) },
            { spokenKey($0.name).contains(key) },
        ]

        for matches in tiers.map({ predicate in entries.filter(predicate) }) where !matches.isEmpty {
            return matches.map { PantryItemEntity(id: $0.id, name: $0.name) }
        }
        return []
    }
}

/// How the thing left, in the two words somebody would actually say.
///
/// An AppEnum rather than two intents because the outcome is one field on one
/// action — and because a phrase can interpolate an AppEnum, which keeps the
/// door open to "mark bananas as ..." being answered by voice. The shortcuts
/// below don't use that door: each presets the outcome and spells its own
/// phrase out, so the common sentences resolve in one step with no follow-up
/// question.
///
/// The raw values are `DisposalOutcome`'s own strings from src/types — this
/// enum is carried across the App Group as text and read back by
/// `processPendingDisposals`, so they have to survive the round trip verbatim.
enum DisposalOutcomeAppEnum: String, AppEnum {
    case usedUp
    case spoiled

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Outcome"

    static var caseDisplayRepresentations: [DisposalOutcomeAppEnum: DisplayRepresentation] = [
        .usedUp: "used up",
        .spoiled: "gone bad",
    ]
}

struct MarkDisposedIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark Item Used Up"
    static var description = IntentDescription("Marks a grocery item as used up or gone bad.")

    // Deprecated in iOS 26 in favour of supportedModes below, and kept for the
    // OS versions before it — the same pair CompleteTaskIntent.swift carries,
    // for the same reason and with the same carve-out: the doc's warning about
    // setting this in an app extension doesn't apply to an intent that runs
    // inside the app, which this one only ever does.
    static var openAppWhenRun: Bool = true

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Item", requestValueDialog: IntentDialog("Which item?"))
    var item: PantryItemEntity

    @Parameter(title: "Outcome", default: .usedUp)
    var outcome: DisposalOutcomeAppEnum

    static var parameterSummary: some ParameterSummary {
        Summary("Mark \(\.$item) as \(\.$outcome)")
    }

    init() {}

    init(outcome: DisposalOutcomeAppEnum) {
        self.outcome = outcome
    }

    func perform() async throws -> some IntentResult {
        PantryIndexStore.append(
            PantryIndexStore.PendingDisposal(
                id: item.id,
                name: item.name,
                outcome: outcome.rawValue
            )
        )
        return .result()
    }
}
