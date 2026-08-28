import DeviceActivity
import Foundation

/// The DeviceActivity monitor extension: a separate process iOS wakes when one
/// of the usage thresholds the app armed is crossed.
///
/// It does almost nothing on purpose. It cannot reach the app's SQLite, its
/// stores or any of its JS — the same wall `CompleteTaskIntent` in the widget
/// runs into — so, like that one, it writes to the shared App Group container
/// and lets the app drain it on the next foreground. `checkScreenTimeTasks`
/// (`useTaskStore.ts`) is what turns a crossing into a task.
///
/// Two things it deliberately does not do:
///
/// - **It never reports how long anything was used for.** It isn't told:
///   `eventDidReachThreshold` says which event tripped, not by how much. Usage
///   figures exist only inside a `DeviceActivityReport` extension, which is a
///   different extension point with no route back to the app at all.
/// - **It never works out what day it is.** `Date()` here is the calendar day,
///   which is the wrong answer for anybody whose logical day starts at 4am, and
///   the extension has no access to `dayResetTime`. The app stamps the day when
///   it arms the monitor and this reads that back; a crossing with no day to
///   file under is dropped rather than guessed at.
///
/// The event name carries the rule id (`rule:<id>`), matching the prefix
/// `TodoScreenTimeBridgeModule.swift` registers them under. The two halves are
/// separate compilation units, so the prefix is duplicated rather than shared —
/// the same arrangement, and the same hazard, as the file names in
/// `ScreenTimeShared.swift`, which is why that file is compiled into both
/// targets and this constant is the only thing left hand-matched.
class TodoActivityMonitor: DeviceActivityMonitor {
  private static let eventPrefix = "rule:"

  override func eventDidReachThreshold(
    _ event: DeviceActivityEvent.Name,
    activity: DeviceActivityName
  ) {
    super.eventDidReachThreshold(event, activity: activity)

    let raw = event.rawValue
    guard raw.hasPrefix(Self.eventPrefix) else { return }
    let ruleId = String(raw.dropFirst(Self.eventPrefix.count))
    guard !ruleId.isEmpty else { return }

    guard let dayKey = ScreenTimeShared.readDayKey() else { return }

    // appendCrossing ignores a duplicate for the same rule and day. iOS can
    // wake this more than once for an event that has already fired, and a
    // duplicate here would be a duplicate task.
    ScreenTimeShared.appendCrossing(ScreenTimeCrossing(ruleId: ruleId, dayKey: dayKey))
  }
}
