import DeviceActivity
import Foundation
import ManagedSettings

#if canImport(FamilyControls)
import FamilyControls
#endif

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
    if raw.hasPrefix(ScreenTimeShared.speedBumpEventPrefix) {
      raiseSpeedBump(event: raw)
      return
    }
    guard raw.hasPrefix(Self.eventPrefix) else { return }
    let ruleId = String(raw.dropFirst(Self.eventPrefix.count))
    guard !ruleId.isEmpty else { return }

    guard let dayKey = ScreenTimeShared.readDayKey() else { return }

    // appendCrossing ignores a duplicate for the same rule and day. iOS can
    // wake this more than once for an event that has already fired, and a
    // duplicate here would be a duplicate task.
    ScreenTimeShared.appendCrossing(ScreenTimeCrossing(ruleId: ruleId, dayKey: dayKey))
  }

  /// A speed bump rung was crossed: block the rule's groups for a short time.
  ///
  /// The second place outside the app that raises a shield, and the first that
  /// does it in answer to use rather than to a clock. The app is usually closed
  /// when this runs, so everything it needs was written ahead (`speedBumpsFileName`)
  /// and everything the app needs afterwards is written back (`speedBumpLiveFileName`):
  /// the app reads that record and keeps the shield up for it, since a reconcile
  /// that did not know about it would lift a block it never raised.
  ///
  /// Four rules keep it from blocking more than it should:
  ///
  /// - **A rung fires once a day.** iOS can report an event more than once, and a
  ///   duplicate would start a second block when the first has ended.
  /// - **A running block is left alone.** A rung crossed during one is ignored,
  ///   not queued or extended, so blocks never stack into a long one.
  /// - **No day, no block.** It uses the day the app stamped when it armed the
  ///   monitor, for the reason crossings do. Without one it does nothing.
  /// - **It lifts only its own groups.** The window armed here ends through
  ///   `heldGroupIds`, which keeps every group another reason still holds.
  ///
  /// Not verified without a device: that `DeviceActivityCenter` can start a
  /// window from inside the extension (Apple's documentation says an extension
  /// may call it), and that iOS accepts an interval starting at the current
  /// second, which the manual block's window already relies on.
  private func raiseSpeedBump(event raw: String) {
    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      let body = String(raw.dropFirst(ScreenTimeShared.speedBumpEventPrefix.count))
      guard let split = body.lastIndex(of: ":") else { return }
      let ruleId = String(body[..<split])
      guard !ruleId.isEmpty,
            let bump = ScreenTimeShared.readSpeedBumps().first(where: { $0.id == ruleId }),
            !bump.blockGroupIds.isEmpty,
            let dayKey = ScreenTimeShared.readDayKey()
      else { return }

      // Recorded before anything is raised, so a duplicate wake stops here even
      // if the rest fails.
      guard ScreenTimeShared.recordSpeedBumpFired(dayKey: dayKey, event: raw) else { return }

      let now = Date()
      if !ScreenTimeShared.activeSpeedBumpGroupIds(now: now).isEmpty { return }

      let end = now.addingTimeInterval(TimeInterval(bump.blockMinutes * 60))
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      let live = SpeedBumpLiveShared(endIso: formatter.string(from: end), groupIds: bump.blockGroupIds, ruleId: ruleId)
      guard ScreenTimeShared.writeLiveSpeedBump(live) else { return }
      ScreenTimeShared.applyGroups(ScreenTimeShared.heldGroupIds(now: now))

      let calendar = Calendar.current
      let schedule = DeviceActivitySchedule(
        intervalStart: calendar.dateComponents([.hour, .minute, .second], from: now),
        intervalEnd: calendar.dateComponents([.hour, .minute, .second], from: end),
        repeats: false
      )
      let center = DeviceActivityCenter()
      let name = DeviceActivityName(ScreenTimeShared.speedBumpWindowName)
      center.stopMonitoring([name])
      // A failure here is not fatal: the app's reconcile lifts the block on its
      // next foreground, as it does for the other timed blocks.
      try? center.startMonitoring(name, during: schedule)
    }
    #endif
  }

  /// The start of a gate block: a task the apps are held behind becoming due
  /// while the app is closed.
  ///
  /// Together with a schedule opening, this is one of two places outside the app
  /// that *raise* a shield, and it is a deliberate relaxation of the "only ever clears" rule below rather than an
  /// oversight. A gate that only bit when the app was next opened was dodgeable
  /// by not opening it, which is the one hole that made the feature decorative:
  /// the block is supposed to be what gets you to do the walk, not a reward for
  /// checking in.
  ///
  /// Three things keep it from blocking apps nobody asked it to:
  ///
  /// - **The app's permission is written ahead, per window.** `pendingGateDetail`
  ///   is set only by a reconcile that armed a window, and cleared by every one
  ///   that didn't. A wake with nothing there is a stale schedule — the gate was
  ///   completed, deferred, or the feature switched off since — and does
  ///   nothing. An unreadable state file is the same answer, which is the
  ///   opposite default from `intervalDidEnd` below and right for the same
  ///   reason: the cautious direction is whichever one leaves the apps alone.
  /// - **It is scoped to the gate activity.** The usage monitor's own interval
  ///   starts every day, and answering that one would raise a shield on the
  ///   strength of a threshold nobody crossed.
  /// - **It shields exactly the picked apps**, read from the same App Group
  ///   selections `applyShield` uses, through `applyGroups`, which keeps the
  ///   empty-set care: an empty `applicationCategories` is read as `.all` by
  ///   ManagedSettings and would lock the whole phone.
  ///
  /// The block it raises is lifted by the app's own reconcile, as every other
  /// gate block is — completing the task is a task write, and that is what
  /// takes the shield down.
  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)

    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      if activity.rawValue == ScreenTimeShared.gateActivityName {
        // The app's permission is the pending gate detail; without it this is a
        // stale schedule and nothing is raised.
        guard let state = ScreenTimeShared.readShieldState(),
              let detail = state.pendingGateDetail, !detail.isEmpty
        else { return }
        ScreenTimeShared.applyGroups(ScreenTimeShared.heldGroupIds(now: Date(), gateStarting: true))
      } else if activity.rawValue.hasPrefix(ScreenTimeShared.scheduleActivityPrefix) {
        // A schedule's edge. The held groups are rebuilt from the schedules
        // themselves, so a wake on a day the schedule doesn't cover changes
        // nothing, and a schedule opening never lifts another reason's group.
        ScreenTimeShared.applyGroups(ScreenTimeShared.heldGroupIds(now: Date()))
      }
    }
    #endif
  }

  /// The end of a penalty block, which is the one thing in this app that has to
  /// happen while the app is closed.
  ///
  /// Everything else here writes to the App Group and lets the app act on it
  /// later. This cannot: the whole point of a block that ends at a stated time
  /// is that it ends then, and the app may not be opened for hours. So this is
  /// the only place outside the app that touches the shield.
  ///
  /// Three rules keep that from undoing the arbitration in `appShield.ts`:
  ///
  /// - **A penalty ending only ever removes the penalty's own group.** The shield
  ///   is the union of the groups its reasons hold, so this rebuilds it from
  ///   `ScreenTimeShared.heldGroupIds` with the penalty left out. A schedule
  ///   closing is the same rebuild with the schedule's clock deciding.
  /// - **It defers to any other reason.** A focus session running when a
  ///   penalty runs out still wants its group blocked, and this process cannot
  ///   ask — so the app writes each reason's group ahead of time and this reads
  ///   them. An absent or unreadable answer counts as "the Default group is
  ///   still wanted" (see `heldGroupIds`), leaving the block for the app to lift.
  /// - **It is not the only mechanism.** `useAppShieldSync` reconciles on every
  ///   foreground regardless, because `intervalDidEnd` is reported not to fire
  ///   reliably for non-repeating schedules and a schedule's survival across a
  ///   reboot is undocumented. This makes expiry punctual; it does not make it
  ///   guaranteed, and the JS backstop is what covers the difference.
  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)

    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      if activity.rawValue == ScreenTimeShared.penaltyActivityName {
        // Rebuild from everything else that still holds a group. No readable
        // state keeps the Default group up (see `heldGroupIds`), which leaves
        // the block for the app to lift, as before.
        ScreenTimeShared.applyGroups(ScreenTimeShared.heldGroupIds(now: Date(), penaltyEnded: true))
      } else if activity.rawValue == ScreenTimeShared.manualActivityName {
        // A block the person started by hand running out. The same rebuild as
        // the penalty's, with the manual group left out and every other
        // reason's group (including a penalty still running) kept.
        ScreenTimeShared.applyGroups(ScreenTimeShared.heldGroupIds(now: Date(), manualEnded: true))
      } else if activity.rawValue == ScreenTimeShared.speedBumpWindowName {
        // A speed bump running out: the same rebuild, with its groups left out
        // and everything else a penalty, schedule or manual block holds kept.
        ScreenTimeShared.applyGroups(ScreenTimeShared.heldGroupIds(now: Date(), speedBumpEnded: true))
        if ScreenTimeShared.activeSpeedBumpGroupIds(now: Date(), ended: true).isEmpty {
          _ = ScreenTimeShared.remove(ScreenTimeShared.speedBumpLiveFileName)
        }
      } else if activity.rawValue.hasPrefix(ScreenTimeShared.scheduleActivityPrefix) {
        // A schedule closing lifts only the groups nothing else holds.
        ScreenTimeShared.applyGroups(ScreenTimeShared.heldGroupIds(now: Date()))
      }
    }
    #endif
  }
}
