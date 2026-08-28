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
