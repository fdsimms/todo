import Foundation

#if canImport(FamilyControls)
import FamilyControls
#endif
#if canImport(ManagedSettings)
import ManagedSettings
#endif

/// The App Group container, and the files in it that the app and the
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
  /// This is the Default group's file. It keeps the name it had when there was
  /// only one selection, so an install that upgrades blocks the same apps.
  static let selectionFileName = "screentime_selection.json"
  /// The id of the group whose selection is `selectionFileName`.
  static let defaultGroupID = "default"
  /// The schedules the monitor evaluates when one of their edges wakes it.
  /// App writes, extension reads.
  static let schedulesFileName = "screentime_schedules.json"
  /// Prefix of every DeviceActivity name armed for a schedule, so the app can
  /// stop the ones it no longer wants and the extension can tell them from the
  /// penalty and gate windows. Hand-matched in `TodoActivityMonitor.swift`.
  static let scheduleActivityPrefix = "todo.schedule."
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
  /// Settings that change how a live shield behaves rather than what it covers
  /// (today only whether apps can be deleted). App writes on every reconcile,
  /// and `applyGroups` reads it in both processes, so the extension keeps the
  /// setting when it raises or lifts a shield with the app closed.
  static let shieldOptionsFileName = "screentime_shield_options.json"
  /// Which groups are allowlists ("block everything except these apps") rather
  /// than block lists, and the main app's bundle id. App writes on every
  /// reconcile; `applyGroups` reads it in both processes, so the extension
  /// raises the same shield the app would when a schedule opens with the app
  /// closed. A missing or unreadable file reads as "no allowlists", the shape
  /// every group had before the mode existed.
  static let allowGroupsFileName = "screentime_allow_groups.json"

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

  /// The one-shot DeviceActivity window whose end lifts a block the person
  /// started by hand. The penalty window's twin, and its own activity so that
  /// stopping either never disarms the other. Hand-matched in
  /// `TodoActivityMonitor.swift`.
  static let manualActivityName = "todo.manualWindow"

  /// The one-shot DeviceActivity window whose *start* raises a gate block, so a
  /// gate that comes due while the app is closed still holds the apps.
  ///
  /// Separate from the penalty window above because the two answer opposite
  /// callbacks — that one acts at `intervalDidEnd`, this one at
  /// `intervalDidStart` — and stopping either must not disarm the other.
  static let gateActivityName = "todo.gateWindow"

  static func readShieldOptions() -> ShieldOptionsShared {
    guard let data = readData(shieldOptionsFileName),
          let options = try? JSONDecoder().decode(ShieldOptionsShared.self, from: data)
    else { return ShieldOptionsShared(denyAppRemoval: false) }
    return options
  }

  static func readAllowGroups() -> AllowGroupsShared {
    guard let data = readData(allowGroupsFileName),
          let allow = try? JSONDecoder().decode(AllowGroupsShared.self, from: data)
    else { return AllowGroupsShared(groupIds: [], appBundleId: nil, sets: nil) }
    return allow
  }

  @discardableResult
  static func writeAllowGroups(_ allow: AllowGroupsShared) -> Bool {
    guard let data = try? JSONEncoder().encode(allow) else { return false }
    return writeData(data, to: allowGroupsFileName)
  }

  @discardableResult
  static func writeShieldOptions(_ options: ShieldOptionsShared) -> Bool {
    guard let data = try? JSONEncoder().encode(options) else { return false }
    return writeData(data, to: shieldOptionsFileName)
  }

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
  /// The app group whose selection this rule counts. Absent from a rules file
  /// an older build wrote, which reads as the default group.
  let groupId: String?
}

/// Why the apps are blocked right now, written by the app on every reconcile.
///
/// Deliberately says nothing the extensions would have to interpret. The app
/// has already decided; this carries the decision, the moment it runs out, and
/// a line of text to show for it. Neither extension can reach the app's SQLite,
/// its stores or its JS, so anything not in here does not exist to them.
/// How a live shield behaves, as opposed to what it covers. Off unless the
/// person turned it on, which is also what a missing or unreadable file means.
struct ShieldOptionsShared: Codable {
  var denyAppRemoval: Bool
}

/// The groups that block everything except their own apps. See
/// `ShieldSettings.ActivityCategoryPolicy.all(except:)`, which is how
/// `applyGroups` draws one, and `src/utils/appGroups.ts` for the rules.
struct AllowGroupsShared: Codable {
  let groupIds: [String]
  /// The main app's bundle id. The extension's own `Bundle.main` is the
  /// extension's, so the app writes it here: an allowlist always keeps this app
  /// open, or the emergency button and the key-tag release would be shielded
  /// along with everything else.
  let appBundleId: String?
  /// Allowlists that act as one: the groups in an inner array are unioned into a
  /// single "everything except these" (a supergroup of allowlists is "either"),
  /// and the arrays are then intersected as separate allowlists always were.
  /// Optional so a file written before supergroups still decodes, and then every
  /// allowlist group is its own set (`applyGroups`).
  var sets: [[String]]? = nil
}

struct ShieldStateShared: Codable {
  /// Whether a reason *other* than a penalty wants the apps blocked — a focus
  /// session, in practice. The monitor extension reads only this: it is what
  /// says whether the end of a penalty window may lift the shield.
  let otherReasonWantsShield: Bool
  /// "penalty", "focus", "gate", "key", "schedule", "manual" or "none" — what the shield screen leads with.
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
  /// Which groups of apps each reason holds, so an extension that lifts one
  /// reason can rebuild the shield from the rest. Optional so a file written
  /// by an older build still decodes; absent reads as "Default for everything".
  let groups: ShieldGroupsShared?

  init(
    otherReasonWantsShield: Bool,
    reason: String,
    untilIso: String?,
    detail: String?,
    pendingGateDetail: String? = nil,
    groups: ShieldGroupsShared? = nil
  ) {
    self.groups = groups
    self.otherReasonWantsShield = otherReasonWantsShield
    self.reason = reason
    self.untilIso = untilIso
    self.detail = detail
    self.pendingGateDetail = pendingGateDetail
  }
}

/// The groups each kind of reason holds. See `ShieldGroupsState` in the bridge's
/// index.ts, which this mirrors field for field.
struct ShieldGroupsShared: Codable {
  let otherGroupIds: [String]
  let penaltyGroupId: String?
  /// Every group the penalty holds, `penaltyGroupId` being the first. Optional so
  /// a state file written before a penalty could name several still decodes, and
  /// then falls back to that one group (`penaltyHeldGroupIds`).
  let penaltyGroupIds: [String]?
  let penaltyEndIso: String?
  /// The block the person started by hand. Optional so a state file written by
  /// an older build still decodes, with this half simply absent.
  let manualGroupId: String?
  /// Every group the manual block holds, `manualGroupId` being the first. Optional
  /// so a state file written before groups could be combined still decodes, and
  /// then falls back to that one group (`manualHeldGroupIds`).
  let manualGroupIds: [String]?
  let manualEndIso: String?
  let pendingGateGroupIds: [String]?
  let pendingGateLiveAtIso: String?

  /// The groups the penalty holds: the list when there is one, else the single
  /// group an older state file named.
  var penaltyHeldGroupIds: [String] {
    if let ids = penaltyGroupIds, !ids.isEmpty { return ids }
    return penaltyGroupId.map { [$0] } ?? []
  }

  /// The groups the manual block holds: the list when there is one, else the
  /// single group an older state file named.
  var manualHeldGroupIds: [String] {
    if let ids = manualGroupIds, !ids.isEmpty { return ids }
    return manualGroupId.map { [$0] } ?? []
  }
}

/// One schedule, as the extension evaluates it. Clock times and weekdays, no
/// dates: the extension has no access to the app's day boundary, and a window
/// here means what the phone's clock says. `ScreenTimeShared.windowCovers` is
/// the same rule as `windowCovering` in `src/utils/blockSchedule.ts`; change
/// them together.
struct ScheduleWindowShared: Codable {
  let id: String
  /// What the person called it, for the shield screen when the app wasn't
  /// running to write a reason. Optional so an older file still decodes.
  let name: String?
  let groupId: String
  /// Every group the schedule blocks, `groupId` being the first. Optional so a
  /// schedules file written before groups could be combined still decodes, and
  /// then falls back to that one group (`heldGroupIds`).
  let groupIds: [String]?
  /// 0 = Sunday.
  let days: [Int]
  let startMinutes: Int
  let endMinutes: Int
  let pausedUntilIso: String?

  /// The groups this schedule blocks while it is live.
  var heldGroupIds: [String] {
    if let ids = groupIds, !ids.isEmpty { return ids }
    return [groupId]
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

  /// Group ids become file names, so anything outside this alphabet is refused
  /// rather than escaped.
  static func isValidGroupID(_ id: String) -> Bool {
    guard !id.isEmpty, id.count <= 40 else { return false }
    return id.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) && $0.isASCII || $0 == "-" || $0 == "_" }
  }

  static func selectionFileName(forGroup groupId: String) -> String? {
    if groupId == defaultGroupID { return selectionFileName }
    guard isValidGroupID(groupId) else { return nil }
    return "screentime_selection_\(groupId).json"
  }

  /// Where a group's staged selection lives while a block holds the group.
  ///
  /// Adding apps to a live group takes effect at once, but removing one would
  /// lift part of a block nobody ended, so a removal is kept here and becomes
  /// the live selection the next time `applyGroups` runs without the group in
  /// its list (`promotePendingSelections`). Plain data, so the extension can
  /// promote one without decoding it.
  static func pendingFileName(forGroup groupId: String) -> String? {
    guard isValidGroupID(groupId) else { return nil }
    return "screentime_pending_\(groupId).json"
  }

  static let pendingFilePrefix = "screentime_pending_"

  /// Whether a staged selection is waiting for this group.
  static func hasPending(groupId: String) -> Bool {
    guard let name = pendingFileName(forGroup: groupId), let url = fileURL(name) else { return false }
    return FileManager.default.fileExists(atPath: url.path)
  }

  @discardableResult
  static func removePending(groupId: String) -> Bool {
    guard let name = pendingFileName(forGroup: groupId) else { return false }
    return remove(name)
  }

  /// Make every staged selection live, for the groups `holding` does not name.
  ///
  /// Run by `applyGroups`, which is called both by the app's reconcile and by
  /// the monitor extension when a block ends with the app closed, so a staged
  /// removal lands at the same moment in either process. A group still in
  /// `holding` keeps its pending file for the next pass. Moves the bytes rather
  /// than decoding them, so it needs neither FamilyControls nor an unlocked app.
  static func promotePendingSelections(holding: [String]) {
    guard let container = containerURL() else { return }
    let directory = container.appendingPathComponent("Library/Application Support", isDirectory: true)
    guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return }
    for name in names where name.hasPrefix(pendingFilePrefix) && name.hasSuffix(".json") {
      let groupId = String(name.dropFirst(pendingFilePrefix.count).dropLast(".json".count))
      guard !holding.contains(groupId),
            let target = selectionFileName(forGroup: groupId),
            let data = readData(name) else { continue }
      // The pending file goes only once the live one is written, so a failed
      // write is retried by the next pass rather than lost.
      if writeData(data, to: target) { _ = remove(name) }
    }
  }

  static func parseIso(_ iso: String?) -> Date? {
    guard let iso = iso else { return nil }
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFraction.date(from: iso) { return date }
    return ISO8601DateFormatter().date(from: iso)
  }

  static func readSchedules() -> [ScheduleWindowShared] {
    guard let data = readData(schedulesFileName) else { return [] }
    return (try? JSONDecoder().decode([ScheduleWindowShared].self, from: data)) ?? []
  }

  @discardableResult
  static func writeSchedules(_ windows: [ScheduleWindowShared]) -> Bool {
    guard let data = try? JSONEncoder().encode(windows) else { return false }
    return writeData(data, to: schedulesFileName)
  }

  /// Whether a window covers `now`, before looking at a pause. A window that
  /// ends at or before its start runs overnight and belongs to the day it
  /// starts on. An all-day window is 00:00 to 00:00, which this already answers
  /// correctly (it covers every minute of each of its days), so it has no case
  /// of its own; `isAllDay` in `blockSchedule.ts` is the same pair.
  static func windowCovers(_ window: ScheduleWindowShared, now: Date, calendar: Calendar = .current) -> Bool {
    let parts = calendar.dateComponents([.weekday, .hour, .minute], from: now)
    let today = ((parts.weekday ?? 1) - 1 + 7) % 7
    let minute = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    if window.endMinutes > window.startMinutes {
      return window.days.contains(today) && minute >= window.startMinutes && minute < window.endMinutes
    }
    if window.days.contains(today) && minute >= window.startMinutes { return true }
    return window.days.contains((today + 6) % 7) && minute < window.endMinutes
  }

  /// The schedules blocking at `now`: covered, and not lifted by a tag.
  static func activeSchedules(now: Date) -> [ScheduleWindowShared] {
    readSchedules().filter { window in
      guard windowCovers(window, now: now) else { return false }
      if let until = parseIso(window.pausedUntilIso), now < until { return false }
      return true
    }
  }

  static func activeScheduleGroupIds(now: Date) -> [String] {
    activeSchedules(now: now).flatMap { $0.heldGroupIds }
  }

  /// How early an end callback may be delivered and still count as the end. The
  /// monitor's clock is whole seconds and delivery is not exact, so a callback
  /// a moment ahead of `end` has to lift the block; one minutes ahead of it is
  /// not that block's end.
  static let endCallbackSlack: TimeInterval = 60

  static func endIsDue(_ end: Date, now: Date) -> Bool {
    end <= now.addingTimeInterval(endCallbackSlack)
  }

  /// Every group the shield should hold at `now`, rebuilt from what the app last
  /// wrote and the schedules' own clocks.
  ///
  /// This is the whole of what an extension may decide. It never reasons about
  /// *why* a group is held, only that the app has named the reason and the
  /// reason's moment has or hasn't arrived. `penaltyEnded` and `gateStarting` are
  /// for the callbacks that fire because that moment arrived, where a few
  /// milliseconds of early delivery must not leave the penalty's group up or
  /// the gate's out.
  static func heldGroupIds(
    now: Date,
    penaltyEnded: Bool = false,
    gateStarting: Bool = false,
    manualEnded: Bool = false
  ) -> [String] {
    // No readable state is "assume the app's own reasons still hold" for
    // everything but what we can compute ourselves, the same cautious default
    // `readShieldState` documents: the Default group stays up and the app
    // lifts it on the next foreground.
    guard let state = readShieldState() else {
      return [defaultGroupID] + activeScheduleGroupIds(now: now)
    }
    var ids = state.groups?.otherGroupIds ?? (state.otherReasonWantsShield ? [defaultGroupID] : [])
    // An end callback only counts when the stored end has really arrived. The
    // app re-arms both windows on every reconcile, and a callback left over
    // from an earlier window (or from the re-arm itself) can reach this with a
    // newer block already running: dropping its group then lifted a block the
    // app still believed was up.
    if let end = parseIso(state.groups?.penaltyEndIso), end > now,
       !(penaltyEnded && endIsDue(end, now: now)) {
      ids.append(contentsOf: state.groups?.penaltyHeldGroupIds ?? [])
    }
    if let end = parseIso(state.groups?.manualEndIso), end > now,
       !(manualEnded && endIsDue(end, now: now)) {
      ids.append(contentsOf: state.groups?.manualHeldGroupIds ?? [])
    }
    if let groups = state.groups?.pendingGateGroupIds,
       state.pendingGateDetail != nil,
       gateStarting || (parseIso(state.groups?.pendingGateLiveAtIso).map { $0 <= now } ?? false) {
      ids.append(contentsOf: groups)
    }
    ids.append(contentsOf: activeScheduleGroupIds(now: now))
    var seen = Set<String>()
    return ids.filter { seen.insert($0).inserted }
  }

  #if canImport(FamilyControls)
  @available(iOS 16.0, *)
  static func readSelection(groupId: String = defaultGroupID) -> FamilyActivitySelection? {
    guard let name = selectionFileName(forGroup: groupId), let data = readData(name) else { return nil }
    return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
  }

  @available(iOS 16.0, *)
  @discardableResult
  static func writeSelection(_ selection: FamilyActivitySelection, groupId: String = defaultGroupID) -> Bool {
    guard let name = selectionFileName(forGroup: groupId),
          let data = try? JSONEncoder().encode(selection) else { return false }
    return writeData(data, to: name)
  }

  @available(iOS 16.0, *)
  static func readPendingSelection(groupId: String) -> FamilyActivitySelection? {
    guard let name = pendingFileName(forGroup: groupId), let data = readData(name) else { return nil }
    return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
  }

  @available(iOS 16.0, *)
  @discardableResult
  static func writePendingSelection(_ selection: FamilyActivitySelection, groupId: String) -> Bool {
    guard let name = pendingFileName(forGroup: groupId),
          let data = try? JSONEncoder().encode(selection) else { return false }
    return writeData(data, to: name)
  }

  /// Whether `selection` still holds everything in `other`: no app, category
  /// or website of `other` is missing from it.
  @available(iOS 16.0, *)
  static func selection(_ selection: FamilyActivitySelection, covers other: FamilyActivitySelection) -> Bool {
    other.applicationTokens.isSubset(of: selection.applicationTokens)
      && other.categoryTokens.isSubset(of: selection.categoryTokens)
      && other.webDomainTokens.isSubset(of: selection.webDomainTokens)
  }

  /// `selection` with everything in `other` added back. Only the token sets
  /// are merged: `applications`, `categories` and `webDomains` are get-only on
  /// `FamilyActivitySelection`, and the shield reads the tokens alone.
  @available(iOS 16.0, *)
  static func selection(_ selection: FamilyActivitySelection, adding other: FamilyActivitySelection) -> FamilyActivitySelection {
    var merged = selection
    merged.applicationTokens.formUnion(other.applicationTokens)
    merged.categoryTokens.formUnion(other.categoryTokens)
    merged.webDomainTokens.formUnion(other.webDomainTokens)
    return merged
  }

  #if canImport(ManagedSettings)
  /// Write the shield as the union of these groups' apps, or lift it when they
  /// hold nothing. Idempotent, which is what lets both processes call it freely.
  ///
  /// nil rather than an empty set for an empty pick: an empty `applications`
  /// set is a shield over nothing, but an empty `applicationCategories` is read
  /// as ".all" by ManagedSettings and would lock the entire phone.
  @available(iOS 16.0, *)
  @discardableResult
  static func applyGroups(_ groupIds: [String]) -> Bool {
    // A removal staged while a group was blocking becomes live here, the first
    // time the group is not part of what is being held.
    promotePendingSelections(holding: groupIds)
    let allow = readAllowGroups()
    var applications = Set<ApplicationToken>()
    var categories = Set<ActivityCategoryToken>()
    var webDomains = Set<WebDomainToken>()
    // One entry per live allowlist. Each says "everything except these", so
    // with several live the shield is everything outside *all* of them: what
    // stays open is the apps every allowlist names (`intersection` below). An
    // allowlist is one group, or the groups of one supergroup unioned (`sets`).
    var allowedApplications: [Set<ApplicationToken>] = []
    var allowedWebDomains: [Set<WebDomainToken>] = []
    var allowUnits: [[String]] = []
    var covered = Set<String>()
    for set in allow.sets ?? [] {
      // Only the groups still held: a set that lost members because their
      // reasons ended holds less open, which is the stricter way to be wrong.
      let live = set.filter { groupIds.contains($0) && allow.groupIds.contains($0) }
      if live.isEmpty { continue }
      allowUnits.append(live)
      covered.formUnion(live)
    }
    for id in groupIds where allow.groupIds.contains(id) && !covered.contains(id) {
      allowUnits.append([id])
      covered.insert(id)
    }
    for unit in allowUnits {
      var apps = Set<ApplicationToken>()
      var sites = Set<WebDomainToken>()
      for id in unit {
        guard let selection = readSelection(groupId: id) else { continue }
        apps.formUnion(selection.applicationTokens)
        sites.formUnion(selection.webDomainTokens)
      }
      // Only apps and websites can be excepted: `all(except:)` takes tokens
      // for those and has no way to leave a category open. An allowlist
      // holding none is skipped rather than applied, because "everything
      // except nothing" shields the whole phone, this app included.
      if apps.isEmpty && sites.isEmpty { continue }
      allowedApplications.append(apps)
      allowedWebDomains.append(sites)
    }
    for id in groupIds where !allow.groupIds.contains(id) {
      guard let selection = readSelection(groupId: id) else { continue }
      applications.formUnion(selection.applicationTokens)
      categories.formUnion(selection.categoryTokens)
      webDomains.formUnion(selection.webDomainTokens)
    }
    let store = ManagedSettingsStore(named: .init(shieldStoreName))
    store.shield.applications = applications.isEmpty ? nil : applications
    store.shield.webDomains = webDomains.isEmpty ? nil : webDomains
    if var open = allowedApplications.first {
      for other in allowedApplications.dropFirst() { open.formIntersection(other) }
      // This app is never shielded by an allowlist. Best effort: the token is
      // nil if iOS doesn't know the bundle id, and then only the person's own
      // pick keeps it open.
      if let bundleId = allow.appBundleId, let token = Application(bundleIdentifier: bundleId).token {
        open.insert(token)
      }
      // A block list that names an app wins over an allowlist that names it.
      open.subtract(applications)
      store.shield.applicationCategories = .all(except: open)
      var openSites = allowedWebDomains.first ?? []
      for other in allowedWebDomains.dropFirst() { openSites.formIntersection(other) }
      openSites.subtract(webDomains)
      store.shield.webDomainCategories = .all(except: openSites)
    } else {
      // nil rather than an empty set for an empty pick: an empty `applications`
      // set is a shield over nothing, but an empty `applicationCategories` is
      // read as ".all" by ManagedSettings and would lock the entire phone.
      store.shield.applicationCategories = categories.isEmpty
        ? nil
        : ShieldSettings.ActivityCategoryPolicy.specific(categories)
      // Websites are their own shield settings: the picker stores a site (or a
      // category's sites) in the selection, but nothing blocks it in Safari
      // unless it is written here too. A category picked blocks its sites as
      // well as its apps.
      store.shield.webDomainCategories = categories.isEmpty
        ? nil
        : ShieldSettings.ActivityCategoryPolicy.specific(categories)
    }
    // Deleting apps is denied for as long as any reason is live and the person
    // turned this on, and cleared with the shield. Keyed on the reasons rather
    // than on what they cover: a block with nothing picked is still a block,
    // and deleting this app is the way round all of them. nil rather than
    // false, so a lifted block leaves the store holding no setting at all.
    store.application.denyAppRemoval = (!groupIds.isEmpty && readShieldOptions().denyAppRemoval) ? true : nil
    return !applications.isEmpty || !categories.isEmpty || !webDomains.isEmpty || !allowedApplications.isEmpty
  }
  #endif
  #endif
}
