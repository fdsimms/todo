import ExpoModulesCore
import UIKit

#if canImport(FamilyControls)
import FamilyControls
import SwiftUI
#endif
#if canImport(ManagedSettings)
import ManagedSettings
#endif
#if canImport(DeviceActivity)
import DeviceActivity
#endif

/// The app's half of iOS Screen Time.
///
/// Everything here is 16.0-gated and weak-linked (see the podspec): the three
/// frameworks are above this pod's floor, and on a device below it every
/// function degrades to its "unavailable" answer rather than the app failing to
/// launch. `isAvailable` is what the JS side asks first.
///
/// Every function returns a value rather than Void, the same rule
/// TodoWidgetBridgeModule.swift states at length: RN's exception-to-JSError
/// conversion was fixed for `performMethodInvocation` and never extended to
/// `performVoidMethodInvocation`, so a Void-returning module method that raises
/// takes the app down instead of rejecting the promise. The bodies are wrapped
/// in TodoScreenTimeExceptionCatcher on top of that, because Swift cannot catch
/// a raw NSException at all, and ManagedSettings raises one when written
/// without authorization.
///
/// **What this deliberately cannot do**: report how long anything was used
/// for. Usage numbers are only readable inside a DeviceActivityReport
/// extension, which is sandboxed with no way to hand data back, and app tokens
/// are opaque values only SwiftUI can render. So the app can count what the
/// user picked and shield it; it can never name it or measure it.
public class TodoScreenTimeBridgeModule: Module {
  /// The store the shield is written to. Named rather than the default one so
  /// clearing it can never disturb settings written by anything else.
  ///
  /// Lives in `ScreenTimeShared` because the monitor extension writes the same
  /// store when a penalty window ends, and two processes clearing two
  /// differently-named stores is a shield nothing can lift. That file's own
  /// comment says why the name is never to be changed.
  private static var shieldStoreName: String { ScreenTimeShared.shieldStoreName }
  /// The monitor's activity name, and the prefix its threshold events are
  /// registered under. A crossing is reported by parsing the rule id back out
  /// of the event name, so the two halves have to agree — the extension's copy
  /// is in TodoActivityMonitor.swift.
  private static let activityName = "todoUsageWatch"
  private static let eventPrefix = "rule:"

  public func definition() -> ModuleDefinition {
    Name("TodoScreenTimeBridge")

    // ─── Availability and authorization ───────────────────────────────────

    /// Whether this build, on this device, can do any of the rest of it.
    Function("isAvailable") { () -> Bool in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) { return true }
      #endif
      return false
    }

    /// "unavailable" | "notDetermined" | "denied" | "approved".
    ///
    /// A string rather than an enum so the JS side has one shape to switch on
    /// and "the frameworks aren't here" isn't a separate call that could
    /// disagree with this one.
    Function("authorizationStatus") { () -> String in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        var result = "unavailable"
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          switch AuthorizationCenter.shared.authorizationStatus {
          case .notDetermined: result = "notDetermined"
          case .denied: result = "denied"
          case .approved: result = "approved"
          @unknown default: result = "unavailable"
          }
        }
        return result
      }
      #endif
      return "unavailable"
    }

    /// Ask for Screen Time access, returning the status afterwards.
    ///
    /// `.individual` — this person's own device, not a child's. The `.child`
    /// flow needs a parent's Apple Account password and is a different feature
    /// from the one this app has.
    AsyncFunction("requestAuthorization") { () -> String in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        do {
          try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
          return "approved"
        } catch {
          // Covers the user declining and the entitlement being absent from
          // the build, which are indistinguishable from here and want the
          // same answer from the JS side: don't offer the feature.
          return "denied"
        }
      }
      #endif
      return "unavailable"
    }

    // ─── Choosing apps ────────────────────────────────────────────────────

    /// Present the system app picker, seeded with the current selection, and
    /// save whatever comes back.
    ///
    /// Returns true when the user confirmed a choice, false when they
    /// cancelled or the picker could not be shown. The apps themselves are
    /// never named to JS: `ApplicationToken` is opaque and only renderable by
    /// SwiftUI, which is the whole reason this presents a native sheet rather
    /// than handing a list back for React to draw.
    AsyncFunction("presentAppPicker") { (promise: Promise) in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        guard let presenter = Self.topViewController() else {
          promise.resolve(false)
          return
        }
        let initial = ScreenTimeShared.readSelection() ?? FamilyActivitySelection()
        var host: UIViewController?
        let view = ScreenTimePickerView(
          initialSelection: initial,
          onDone: { selection in
            ScreenTimeShared.writeSelection(selection)
            host?.dismiss(animated: true) { promise.resolve(true) }
          },
          onCancel: {
            host?.dismiss(animated: true) { promise.resolve(false) }
          }
        )
        let controller = UIHostingController(rootView: view)
        host = controller
        presenter.present(controller, animated: true)
        return
      }
      #endif
      promise.resolve(false)
    }
    .runOnQueue(.main)

    /// How many apps and categories are picked. Counts only — see the note on
    /// `presentAppPicker` for why there are no names here.
    Function("selectionCount") { () -> [String: Int] in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        var counts = ["applications": 0, "categories": 0]
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          guard let selection = ScreenTimeShared.readSelection() else { return }
          counts["applications"] = selection.applicationTokens.count
          counts["categories"] = selection.categoryTokens.count
        }
        return counts
      }
      #endif
      return ["applications": 0, "categories": 0]
    }

    Function("clearSelection") { () -> Bool in
      ScreenTimeShared.remove(ScreenTimeShared.selectionFileName)
      return true
    }

    // ─── Shielding ────────────────────────────────────────────────────────

    /// Block the picked apps. Idempotent — writing the same shield twice is a
    /// no-op, which is what lets the JS side re-assert it on every foreground
    /// without tracking whether it already did.
    Function("applyShield") { () -> Bool in
      #if canImport(ManagedSettings) && canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        var applied = false
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          guard let selection = ScreenTimeShared.readSelection() else { return }
          let store = ManagedSettingsStore(named: .init(Self.shieldStoreName))
          // nil rather than an empty set for an empty pick: an empty
          // `applications` set is a shield over nothing, but an empty
          // `applicationCategories` is read as ".all" by ManagedSettings and
          // would lock the entire phone.
          store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
          store.shield.applicationCategories = selection.categoryTokens.isEmpty
            ? nil
            : ShieldSettings.ActivityCategoryPolicy.specific(selection.categoryTokens)
          applied = !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty
        }
        return applied
      }
      #endif
      return false
    }

    /// Hand both extensions the app's own answer about why the apps are blocked.
    ///
    /// Written on every reconcile rather than only when a block starts: the
    /// answer changes (a focus session begins, a setting is switched off, a
    /// second failure moves the end) while a window is already armed, and
    /// neither extension gets a chance to ask when it wakes. The monitor reads
    /// `otherReasonWantsShield` to decide whether it may lift a shield; the
    /// shield screen reads the rest to say something better than "blocked".
    Function("setShieldState") { (
      otherReasonWantsShield: Bool,
      reason: String,
      untilIso: String?,
      detail: String?,
      pendingGateDetail: String?
    ) -> Bool in
      var written = false
      TodoScreenTimeExceptionCatcher.runCatchingExceptions {
        written = ScreenTimeShared.writeShieldState(ShieldStateShared(
          otherReasonWantsShield: otherReasonWantsShield,
          reason: reason,
          untilIso: untilIso,
          detail: detail,
          pendingGateDetail: pendingGateDetail
        ))
      }
      return written
    }

    /// Arm a one-shot window whose end lifts the current penalty block, so it
    /// comes off on time with the app closed.
    ///
    /// Three things about the schedule are not obvious:
    ///
    /// - **The bounds are `DateComponents`, not dates.** Only hour/minute/second
    ///   are given, which is what the interval actually needs: this window is
    ///   always shorter than a day (the editor's own ceiling), so the clock time
    ///   is unambiguous within it.
    /// - **`repeats: false`.** A repeating window would lift the shield at the
    ///   same time tomorrow, on a block nobody is serving.
    /// - **A window under about a quarter of an hour is refused by iOS**
    ///   (`MonitoringError.intervalTooShort`), which is why the editor's floor
    ///   is 15 minutes. `startMonitoring` throws, and a throw here is not fatal:
    ///   the JS reconciler still lifts the block on the next foreground.
    Function("schedulePenaltyExpiry") { (untilIso: String) -> Bool in
      #if canImport(DeviceActivity)
      if #available(iOS 16.0, *) {
        var scheduled = false
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          guard let until = Self.parseIso(untilIso), until > Date() else { return }

          let calendar = Calendar.current
          let schedule = DeviceActivitySchedule(
            intervalStart: calendar.dateComponents([.hour, .minute, .second], from: Date()),
            intervalEnd: calendar.dateComponents([.hour, .minute, .second], from: until),
            repeats: false
          )
          let center = DeviceActivityCenter()
          let name = DeviceActivityName(ScreenTimeShared.penaltyActivityName)
          center.stopMonitoring([name])
          try? center.startMonitoring(name, during: schedule)
          scheduled = true
        }
        return scheduled
      }
      #endif
      return false
    }

    /// Arm a one-shot window whose *start* raises a gate block, so a gate that
    /// comes due while the app is closed still holds the apps.
    ///
    /// The mirror of `schedulePenaltyExpiry` and the same three caveats apply
    /// (clock-time bounds, `repeats: false`, a quarter-hour floor), plus one
    /// that is this direction's own: the bounds being clock times rather than
    /// dates means an armed window is "the next time it is 06:00", so the JS
    /// side refuses to arm anything more than a day out (`GATE_ARM_HORIZON_MS`
    /// in `appGate.ts`). Arming further ahead than that would raise a shield
    /// days before the gate it belongs to was real.
    ///
    /// The window's end is deliberately not a callback: a gate ends when its
    /// task does, not when an hour is up, so `intervalDidEnd` answers only for
    /// the penalty window and this one runs out doing nothing.
    Function("scheduleGateWindow") { (startIso: String, endIso: String) -> Bool in
      #if canImport(DeviceActivity)
      if #available(iOS 16.0, *) {
        var scheduled = false
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          guard let start = Self.parseIso(startIso), let end = Self.parseIso(endIso),
                end > start
          else { return }

          let calendar = Calendar.current
          let schedule = DeviceActivitySchedule(
            intervalStart: calendar.dateComponents([.hour, .minute, .second], from: start),
            intervalEnd: calendar.dateComponents([.hour, .minute, .second], from: end),
            repeats: false
          )
          let center = DeviceActivityCenter()
          let name = DeviceActivityName(ScreenTimeShared.gateActivityName)
          center.stopMonitoring([name])
          try? center.startMonitoring(name, during: schedule)
          scheduled = true
        }
        return scheduled
      }
      #endif
      return false
    }

    /// Disarm the gate window. Called on every reconcile that finds nothing
    /// pending, so a window armed for a gate since completed, deferred or
    /// switched off can't raise a shield for it later.
    Function("cancelGateWindow") { () -> Bool in
      #if canImport(DeviceActivity)
      if #available(iOS 16.0, *) {
        var cancelled = false
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          DeviceActivityCenter().stopMonitoring([DeviceActivityName(ScreenTimeShared.gateActivityName)])
          cancelled = true
        }
        return cancelled
      }
      #endif
      return false
    }

    /// Disarm the window above. Called when a block is lifted early — the
    /// feature being switched off — so its end can't clear a shield that a
    /// later focus session has raised in the meantime.
    Function("cancelPenaltyExpiry") { () -> Bool in
      #if canImport(DeviceActivity)
      if #available(iOS 16.0, *) {
        var cancelled = false
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          DeviceActivityCenter().stopMonitoring([DeviceActivityName(ScreenTimeShared.penaltyActivityName)])
          cancelled = true
        }
        return cancelled
      }
      #endif
      return false
    }

    /// Lift the shield. Called on every route out of a session *and* at launch
    /// as a backstop — a crash mid-session must not leave someone locked out
    /// of their own apps with no running code to let them back in.
    Function("clearShield") { () -> Bool in
      #if canImport(ManagedSettings)
      if #available(iOS 16.0, *) {
        var cleared = false
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          let store = ManagedSettingsStore(named: .init(Self.shieldStoreName))
          store.shield.applications = nil
          store.shield.applicationCategories = nil
          cleared = true
        }
        return cleared
      }
      #endif
      return false
    }

    // ─── Usage thresholds ─────────────────────────────────────────────────

    /// Arm the monitor for today: one DeviceActivityEvent per rule, each
    /// firing when the picked apps have been used for that rule's threshold.
    ///
    /// `rulesJson` is `[{ id, thresholdMinutes }]` and `dayKey` is the app's
    /// own logical day, which is stamped into the crossings the extension
    /// writes — it has no way to work out the user's `dayResetTime` itself.
    ///
    /// The schedule is a full day repeating daily; re-arming replaces it, so
    /// this is safe to call on every foreground.
    AsyncFunction("startMonitoring") { (rulesJson: String, dayKey: String) -> Bool in
      #if canImport(DeviceActivity) && canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        var started = false
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          guard let data = rulesJson.data(using: .utf8),
                let rules = try? JSONDecoder().decode([ScreenTimeRuleShared].self, from: data),
                !rules.isEmpty,
                let selection = ScreenTimeShared.readSelection(),
                !(selection.applicationTokens.isEmpty && selection.categoryTokens.isEmpty)
          else { return }

          // Handed to the extension so it can stamp a crossing with the day
          // the app considers current.
          ScreenTimeShared.writeData(data, to: ScreenTimeShared.rulesFileName)
          ScreenTimeShared.writeDayKey(dayKey)

          var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
          for rule in rules where rule.thresholdMinutes > 0 {
            events[DeviceActivityEvent.Name("\(Self.eventPrefix)\(rule.id)")] = DeviceActivityEvent(
              applications: selection.applicationTokens,
              categories: selection.categoryTokens,
              threshold: DateComponents(minute: rule.thresholdMinutes)
            )
          }
          guard !events.isEmpty else { return }

          let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59),
            repeats: true
          )
          let center = DeviceActivityCenter()
          center.stopMonitoring([DeviceActivityName(Self.activityName)])
          try? center.startMonitoring(DeviceActivityName(Self.activityName), during: schedule, events: events)
          started = true
        }
        return started
      }
      #endif
      return false
    }

    Function("stopMonitoring") { () -> Bool in
      #if canImport(DeviceActivity)
      if #available(iOS 16.0, *) {
        var stopped = false
        TodoScreenTimeExceptionCatcher.runCatchingExceptions {
          DeviceActivityCenter().stopMonitoring([DeviceActivityName(Self.activityName)])
          ScreenTimeShared.remove(ScreenTimeShared.rulesFileName)
          stopped = true
        }
        return stopped
      }
      #endif
      return false
    }

    /// Read and clear the thresholds crossed since the last drain, as JSON
    /// `[{ ruleId, dayKey }]`.
    ///
    /// Read-and-clear, the same shape `drainPendingCompletions` has in the
    /// widget bridge — and with the same consequence, which is why the JS side
    /// must not call it while demo mode is on: draining into a database about
    /// to be thrown away loses the crossing for good.
    AsyncFunction("drainCrossings") { () -> String in
      var json = "[]"
      TodoScreenTimeExceptionCatcher.runCatchingExceptions {
        guard let data = ScreenTimeShared.readData(ScreenTimeShared.crossingsFileName),
              let text = String(data: data, encoding: .utf8),
              !text.isEmpty
        else { return }
        json = text
        ScreenTimeShared.remove(ScreenTimeShared.crossingsFileName)
      }
      return json
    }
  }

  /// The controller to present the picker from.
  ///
  /// Walks past anything already presented, since the picker is usually opened
  /// from a settings sheet that is itself modal — presenting on the root while
  /// a sheet is up throws.
  /// An ISO instant as JS writes it, with or without fractional seconds.
  ///
  /// `ISO8601DateFormatter` refuses a string whose fractional-second shape
  /// doesn't match its options, and `Date.toISOString()` always includes them
  /// while a hand-built string may not — so both are tried rather than assuming
  /// either.
  private static func parseIso(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }

  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
    guard var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return nil }
    while let presented = top.presentedViewController { top = presented }
    return top
  }
}

#if canImport(FamilyControls)
/// The system picker in a sheet of its own, with the two buttons it doesn't
/// come with.
///
/// A SwiftUI view because `FamilyActivityPicker` is one and there is no UIKit
/// equivalent — the tokens it deals in can only be rendered by SwiftUI, which
/// is also why the chosen apps can never be listed on the React side.
@available(iOS 16.0, *)
struct ScreenTimePickerView: View {
  @State private var selection: FamilyActivitySelection
  private let onDone: (FamilyActivitySelection) -> Void
  private let onCancel: () -> Void

  init(
    initialSelection: FamilyActivitySelection,
    onDone: @escaping (FamilyActivitySelection) -> Void,
    onCancel: @escaping () -> Void
  ) {
    _selection = State(initialValue: initialSelection)
    self.onDone = onDone
    self.onCancel = onCancel
  }

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $selection)
        .navigationTitle("Apps to block")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { onCancel() }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { onDone(selection) }
          }
        }
    }
  }
}
#endif
