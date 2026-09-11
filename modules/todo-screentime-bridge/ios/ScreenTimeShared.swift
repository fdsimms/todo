import Foundation

#if canImport(FamilyControls)
import FamilyControls
#endif

/// The App Group container, and the four files in it that the app and the
/// DeviceActivity monitor extension pass state through.
///
/// This file is compiled into **both** targets — the podspec's `**/*.swift`
/// glob puts it in the app, and `plugins/withActivityMonitor.js` copies it into
/// the extension, the same arrangement `TimerActivityAttributes.swift` has with
/// the widget. One copy, because the two processes have to agree on a file
/// name and a JSON shape exactly, and any drift between hand-maintained copies
/// would show up only as a threshold that silently never fires.
///
/// Path convention is the one already in use across the group (see
/// docs/native-targets.md): `<container>/Library/Application Support/<name>.json`.
enum ScreenTimeShared {
  static let appGroupID = "group.com.fdsimms.dundundun"

  /// The apps and categories the user picked, as an encoded FamilyActivitySelection.
  /// App writes, both read.
  static let selectionFileName = "screentime_selection.json"
  /// The usage rules the monitor is watching. App writes, extension reads.
  static let rulesFileName = "screentime_rules.json"
  /// Thresholds that have been crossed and not yet turned into tasks.
  /// Extension writes, app drains.
  static let crossingsFileName = "screentime_crossings.json"
  /// The logical day the monitor was last armed for. App writes, extension
  /// reads — see `ScreenTimeCrossing.dayKey` for why the extension can't work
  /// this out itself.
  static let dayFileName = "screentime_day.json"
  /// Why the apps are blocked right now, and until when. App writes on every
  /// reconcile; two extensions read it, for two unrelated reasons — the monitor
  /// needs to know whether it may lift a shield at the end of a penalty window,
  /// and the shield screen needs something to tell the person who just opened a
  /// blocked app. One file rather than two because both answers come from the
  /// same reconcile and a second file is a second thing to go stale.
  static let shieldStateFileName = "screentime_shield_state.json"

  /// The `ManagedSettingsStore` both processes write the shield to.
  ///
  /// **Never rename this.** A shield lives in the store it was written to until
  /// something clears that same store, so a build that starts writing a
  /// differently-named one leaves any shield already in force with nothing left
  /// that can lift it: the apps stay blocked for good, and reinstalling is the
  /// only way out. The name is historical — it predates a failed task being
  /// able to raise the same shield — and it stays wrong rather than becoming
  /// dangerous.
  static let shieldStoreName = "focusShield"

  /// The one-shot DeviceActivity window whose end lifts a penalty block.
  /// Deliberately a different activity from the usage monitor: stopping one
  /// must not disarm the other.
  static let penaltyActivityName = "todo.penaltyWindow"

  /// The one-shot DeviceActivity window whose *start* raises a gate block, so a
  /// gate that comes due while the app is closed still holds the apps.
  ///
  /// Separate from the penalty window above because the two answer opposite
  /// callbacks — that one acts at `intervalDidEnd`, this one at
  /// `intervalDidStart` — and stopping either must not disarm the other.
  static let gateActivityName = "todo.gateWindow"

  static func containerURL() -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
  }

  static func fileURL(_ name: String) -> URL? {
    guard let container = containerURL() else { return nil }
    let directory = container.appendingPathComponent("Library/Application Support", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent(name)
  }

  static func readData(_ name: String) -> Data? {
    guard let url = fileURL(name) else { return nil }
    return try? Data(contentsOf: url)
  }

  @discardableResult
  static func writeData(_ data: Data, to name: String) -> Bool {
    guard let url = fileURL(name) else { return false }
    do {
      try data.write(to: url, options: .atomic)
      return true
    } catch {
      return false
    }
  }

  @discardableResult
  static func remove(_ name: String) -> Bool {
    guard let url = fileURL(name) else { return false }
    try? FileManager.default.removeItem(at: url)
    return true
  }
}

/// One "30 minutes of Social" rule, as both processes see it.
///
/// The `id` is the app's own `generateId()` string and is what a crossing is
/// reported under — the extension never sends a title or a duration back,
/// only which rule fired, because the rule may have been edited in between and
/// the app's copy is the one that counts.
struct ScreenTimeRuleShared: Codable {
  let id: String
  let thresholdMinutes: Int
}

/// Why the apps are blocked right now, written by the app on every reconcile.
///
/// Deliberately says nothing the extensions would have to interpret. The app
/// has already decided; this carries the decision, the moment it runs out, and
/// a line of text to show for it. Neither extension can reach the app's SQLite,
/// its stores or its JS, so anything not in here does not exist to them.
struct ShieldStateShared: Codable {
  /// Whether a reason *other* than a penalty wants the apps blocked — a focus
  /// session, in practice. The monitor extension reads only this: it is what
  /// says whether the end of a penalty window may lift the shield.
  let otherReasonWantsShield: Bool
  /// "penalty", "focus" or "none" — what the shield screen leads with.
  let reason: String
  /// When a penalty block runs out, as an ISO instant, or nil when the shield
  /// is up for some other reason. The shield screen turns this into a time;
  /// it deliberately does not compute one itself, since the app owns the clock.
  let untilIso: String?
  /// What earned it, e.g. a task's title. Shown as-is, so the app is
  /// responsible for it being something a person would recognise.
  let detail: String?
  /// The line to show for a gate the app has armed a window for but that isn't
  /// live yet, or nil when no window is armed.
  ///
  /// It is the monitor extension's whole permission to raise a shield: the app
  /// writes this when, and only when, it arms a gate window, so a wake with
  /// nothing here is a stale schedule and the extension does nothing. Optional
  /// so a state file written by an older build still decodes, with the gate
  /// half simply absent.
  let pendingGateDetail: String?

  init(
    otherReasonWantsShield: Bool,
    reason: String,
    untilIso: String?,
    detail: String?,
    pendingGateDetail: String? = nil
  ) {
    self.otherReasonWantsShield = otherReasonWantsShield
    self.reason = reason
    self.untilIso = untilIso
    self.detail = detail
    self.pendingGateDetail = pendingGateDetail
  }
}

/// A threshold that fired, waiting to be turned into a task.
///
/// `dayKey` is the app's own logical day (`yyyy-MM-dd`), stamped by the app
/// when it arms the monitor rather than computed in the extension: the
/// extension has no access to the user's `dayResetTime`, and a crossing filed
/// under the wrong day is a task on the wrong day.
struct ScreenTimeCrossing: Codable {
  let ruleId: String
  let dayKey: String
}

extension ScreenTimeShared {
  static func readRules() -> [ScreenTimeRuleShared] {
    guard let data = readData(rulesFileName) else { return [] }
    return (try? JSONDecoder().decode([ScreenTimeRuleShared].self, from: data)) ?? []
  }

  /// The logical day the app last armed the monitor for, or nil if it never
  /// has. A crossing with no day to file it under is dropped rather than
  /// guessed at: `Date()` in the extension is the calendar day, which is the
  /// wrong answer for anyone whose day starts at 4am.
  static func readDayKey() -> String? {
    guard let data = readData(dayFileName),
          let decoded = try? JSONDecoder().decode([String: String].self, from: data)
    else { return nil }
    let key = decoded["dayKey"] ?? ""
    return key.isEmpty ? nil : key
  }

  @discardableResult
  static func writeDayKey(_ dayKey: String) -> Bool {
    guard let data = try? JSONEncoder().encode(["dayKey": dayKey]) else { return false }
    return writeData(data, to: dayFileName)
  }

  /// Why the apps are blocked, as the app last worked it out.
  ///
  /// Nil when the file is missing or unreadable, and every reader has to treat
  /// that as "assume something still wants the shield": a shield wrongly left
  /// on is lifted by the app's own reconcile on the next foreground, and one
  /// wrongly lifted is somebody let out of a block they were serving with
  /// nothing to notice it.
  static func readShieldState() -> ShieldStateShared? {
    guard let data = readData(shieldStateFileName) else { return nil }
    return try? JSONDecoder().decode(ShieldStateShared.self, from: data)
  }

  @discardableResult
  static func writeShieldState(_ state: ShieldStateShared) -> Bool {
    guard let data = try? JSONEncoder().encode(state) else { return false }
    return writeData(data, to: shieldStateFileName)
  }

  static func readCrossings() -> [ScreenTimeCrossing] {
    guard let data = readData(crossingsFileName) else { return [] }
    return (try? JSONDecoder().decode([ScreenTimeCrossing].self, from: data)) ?? []
  }

  /// Append a crossing, ignoring one already recorded for the same rule and
  /// day. The extension can be woken more than once for an event that has
  /// already fired, and a duplicate here is a duplicate task.
  static func appendCrossing(_ crossing: ScreenTimeCrossing) {
    var existing = readCrossings()
    guard !existing.contains(where: { $0.ruleId == crossing.ruleId && $0.dayKey == crossing.dayKey }) else { return }
    existing.append(crossing)
    guard let data = try? JSONEncoder().encode(existing) else { return }
    writeData(data, to: crossingsFileName)
  }

  #if canImport(FamilyControls)
  @available(iOS 16.0, *)
  static func readSelection() -> FamilyActivitySelection? {
    guard let data = readData(selectionFileName) else { return nil }
    return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
  }

  @available(iOS 16.0, *)
  @discardableResult
  static func writeSelection(_ selection: FamilyActivitySelection) -> Bool {
    guard let data = try? JSONEncoder().encode(selection) else { return false }
    return writeData(data, to: selectionFileName)
  }
  #endif
}
