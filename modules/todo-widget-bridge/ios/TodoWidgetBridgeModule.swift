import ActivityKit
import ExpoModulesCore
import WidgetKit

private let appGroupID = "group.com.fdsimms.dundundun"
private let snapshotFileName = "widget_data.json"
// Must match the same literal in TodoWidgetData.swift — a separate Xcode
// target/compilation unit, so the string can't be shared directly.
private let pendingCompletionsFileName = "widget_pending_completions.json"

// Mirrors the TimerRun shape written by src/utils/liveActivity.ts —
// JSONDecoder maps camelCase keys onto these properties automatically.
private struct TimerRunPayload: Codable {
  let key: String
  let kind: String
  let itemId: String
  let title: String
  let subtitle: String
  let symbolName: String
  let startedAtMs: Double
  let targetEndMs: Double?
}

// Mirrors the TripRun shape written by src/utils/tripLiveActivity.ts.
private struct TripRunPayload: Codable {
  let shopName: String
  let startedAtMs: Double
}

// Mirrors the FocusRun shape written by src/utils/focusLiveActivity.ts.
private struct FocusRunPayload: Codable {
  let key: String
  let title: String
  let subtitle: String
  let symbolName: String
  let startedAtMs: Double
  let targetEndMs: Double
  let paused: Bool
  let pausedRemaining: String
  let primaryLabel: String
  let primaryUrl: String
  let advanceLabel: String
  let advanceUrl: String
}

public class TodoWidgetBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoWidgetBridge")

    // Returns a Bool rather than Void deliberately. Per
    // facebook/react-native#54859: an earlier RN fix (PR #50193) patched the
    // exception-to-JSError conversion for performMethodInvocation (methods
    // that return a value) but never extended it to
    // performVoidMethodInvocation (methods that return nothing) — that
    // second, unpatched path is exactly what two crash reports on this
    // device traced back to, byte-identical down to the instruction offset,
    // across both the plain Function and the later AsyncFunction version of
    // this method. Neither of those changed the fact that it returned Void.
    // Returning a value routes through the already-fixed path instead.
    //
    // The whole body is still wrapped in TodoWidgetExceptionCatcher because
    // Swift's throws/try?/guard only catch Swift `Error` — never a raw
    // Objective-C NSException, which WidgetKit/FileManager can still raise
    // synchronously.
    AsyncFunction("writeSnapshot") { (jsonString: String) -> Bool in
      var succeeded = false
      TodoWidgetExceptionCatcher.runCatchingExceptions {
        guard let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: appGroupID
        ) else {
          return
        }

        let directoryURL = containerURL.appendingPathComponent("Library/Application Support", isDirectory: true)
        let fileURL = directoryURL.appendingPathComponent(snapshotFileName)

        try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)

        guard let data = jsonString.data(using: .utf8) else { return }
        try? data.write(to: fileURL, options: .atomic)

        WidgetCenter.shared.reloadAllTimelines()
        succeeded = true
      }
      return succeeded
    }

    // Reads and clears the queue of task ids the widget's checkbox
    // (CompleteTaskIntent, in the widget extension process) has
    // optimistically marked complete. The widget can't reach the app's
    // SQLite database or the JS logic for recurrence/streaks/chains, so it
    // only queues an id; this is where that queue actually gets applied via
    // the real completeTask() — see useWidgetSync() in widgetSync.ts, which
    // drains this on every app launch before writing a fresh snapshot.
    AsyncFunction("drainPendingCompletions") { () -> [String] in
      var ids: [String] = []
      TodoWidgetExceptionCatcher.runCatchingExceptions {
        guard let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: appGroupID
        ) else {
          return
        }

        let fileURL = containerURL
          .appendingPathComponent("Library/Application Support", isDirectory: true)
          .appendingPathComponent(pendingCompletionsFileName)

        guard let data = try? Data(contentsOf: fileURL) else { return }
        guard let decoded = try? JSONDecoder().decode([String].self, from: data) else { return }
        ids = decoded
        try? FileManager.default.removeItem(at: fileURL)
      }
      return ids
    }

    // ─── Live Activities (running timers) ─────────────────────────────────
    // Gated at iOS 17.0, not ActivityKit's own 16.1 floor: the widget
    // extension that renders TimerActivityAttributes is built at
    // IPHONEOS_DEPLOYMENT_TARGET 17.0 (plugins/withWidgetExtension.js), and
    // its Done button is a Button(intent:), which is 17.0-only. Starting an
    // activity on an older device would produce one the extension cannot
    // render at all — an invisible failure — so this refuses at the same
    // version the extension already requires.

    // Reconciles the native set of running-timer activities against the JS
    // side's desired set (see src/utils/liveActivity.ts) in one call, rather
    // than exposing separate start/end functions the JS side would have to
    // track native state to drive correctly — Activity<T>.activities is
    // already the source of truth for what's live, so the native side is
    // what reconciles against it. Bool means "the reconcile ran", not that
    // every requested activity actually started (Activity.request can fail
    // silently, same as the old link-tap activity).
    AsyncFunction("syncTimerLiveActivities") { (jsonRunsString: String) -> Bool in
      var succeeded = false
      TodoWidgetExceptionCatcher.runCatchingExceptions {
        guard #available(iOS 17.0, *) else { return }
        guard let data = jsonRunsString.data(using: .utf8) else { return }
        guard let runs = try? JSONDecoder().decode([TimerRunPayload].self, from: data) else { return }

        let existing = Activity<TimerActivityAttributes>.activities

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
          // Can't start anything new, but still end whatever's left — a
          // setting flipped off (or Live Activities revoked in iOS Settings)
          // must not leave a stale one glued to the Lock Screen.
          for activity in existing {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
          }
          succeeded = true
          return
        }

        let existingByKey = Dictionary(uniqueKeysWithValues: existing.map { ($0.attributes.key, $0) })
        let wantedKeys = Set(runs.map { $0.key })

        // End every activity whose run has stopped, or that was never in the
        // desired set (one left behind by a previous app process).
        for activity in existing where !wantedKeys.contains(activity.attributes.key) {
          Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }

        // Start every run that doesn't already have a live activity. A run
        // whose key IS already live is left alone — see
        // TimerActivityAttributes' header for why nothing about an in-flight
        // run ever needs to change in place; a changed duration only ever
        // shows up as the old run disappearing and a new one starting.
        for run in runs where existingByKey[run.key] == nil {
          let attributes = TimerActivityAttributes(
            key: run.key,
            kind: run.kind,
            itemId: run.itemId,
            title: run.title,
            subtitle: run.subtitle,
            symbolName: run.symbolName,
            startedAt: Date(timeIntervalSince1970: run.startedAtMs / 1000),
            hasTarget: run.targetEndMs != nil,
            targetEndAt: Date(timeIntervalSince1970: (run.targetEndMs ?? run.startedAtMs) / 1000)
          )
          let content = ActivityContent(state: TimerActivityAttributes.ContentState(), staleDate: nil)
          _ = try? Activity.request(attributes: attributes, content: content, pushType: nil)
        }

        succeeded = true
      }
      return succeeded
    }
    .runOnQueue(.main)

    // ─── Live Activity (shopping trip) ────────────────────────────────────
    // Same iOS 17.0 gate as syncTimerLiveActivities, same reason: the widget
    // extension rendering TripActivityAttributes is built at
    // IPHONEOS_DEPLOYMENT_TARGET 17.0.

    // Reconciles the single "shopping trip" Live Activity against the JS
    // side's desired state (see src/utils/tripLiveActivity.ts) — same idea as
    // syncTimerLiveActivities, simplified for zero-or-one activity rather
    // than a keyed set, since at most one trip is ever active
    // (src/utils/activeTrip.ts). An empty string means "no trip wanted";
    // anything else decodes as a TripRunPayload.
    AsyncFunction("syncTripLiveActivity") { (jsonString: String) -> Bool in
      var succeeded = false
      TodoWidgetExceptionCatcher.runCatchingExceptions {
        guard #available(iOS 17.0, *) else { return }

        let existing = Activity<TripActivityAttributes>.activities

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
          for activity in existing {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
          }
          succeeded = true
          return
        }

        guard
          !jsonString.isEmpty,
          let data = jsonString.data(using: .utf8),
          let run = try? JSONDecoder().decode(TripRunPayload.self, from: data)
        else {
          // No trip wanted — end whatever's left, same as a revoked
          // authorization above.
          for activity in existing {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
          }
          succeeded = true
          return
        }

        let startedAt = Date(timeIntervalSince1970: run.startedAtMs / 1000)

        // Already live for this exact trip — see TripActivityAttributes'
        // header for why nothing about an in-flight trip is ever pushed as
        // an update; a changed trip only ever shows up as the old activity
        // ending and a new one starting.
        if let current = existing.first, current.attributes.startedAt == startedAt {
          for stale in existing.dropFirst() {
            Task { await stale.end(nil, dismissalPolicy: .immediate) }
          }
          succeeded = true
          return
        }

        for activity in existing {
          Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        let attributes = TripActivityAttributes(shopName: run.shopName, startedAt: startedAt)
        let content = ActivityContent(state: TripActivityAttributes.ContentState(), staleDate: nil)
        _ = try? Activity.request(attributes: attributes, content: content, pushType: nil)

        succeeded = true
      }
      return succeeded
    }
    .runOnQueue(.main)

    // ─── Live Activity (focus session) ────────────────────────────────────
    // Same iOS 17.0 gate and same zero-or-one reconciliation as
    // syncTripLiveActivity above; an empty string means "no session wanted".
    // What differs is the comparison and the stale date:
    //
    //  • The existing activity is kept when its `key` matches, and `key` is
    //    the whole payload JSON-encoded (see src/utils/focusLiveActivity.ts),
    //    so any change at all — the step, the clock, the paused state, the
    //    task's title — restarts it. Nothing about a focus step is ever
    //    pushed as an update, same rule the other two activities keep.
    //  • `staleDate` is the step's own end, which is what makes
    //    `context.isStale` flip at the moment the step runs out with nothing
    //    pushed to it. FocusLiveActivity.swift draws its two states off that
    //    flag. A step that has already run out gets a stale date a second out
    //    rather than one in the past, so the flip is something ActivityKit is
    //    still going to do rather than something it may have missed; a paused
    //    step has no end to go stale at.
    AsyncFunction("syncFocusLiveActivity") { (jsonString: String) -> Bool in
      var succeeded = false
      TodoWidgetExceptionCatcher.runCatchingExceptions {
        guard #available(iOS 17.0, *) else { return }

        let existing = Activity<FocusActivityAttributes>.activities

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
          for activity in existing {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
          }
          succeeded = true
          return
        }

        guard
          !jsonString.isEmpty,
          let data = jsonString.data(using: .utf8),
          let run = try? JSONDecoder().decode(FocusRunPayload.self, from: data)
        else {
          for activity in existing {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
          }
          succeeded = true
          return
        }

        if let current = existing.first, current.attributes.key == run.key {
          for stale in existing.dropFirst() {
            Task { await stale.end(nil, dismissalPolicy: .immediate) }
          }
          succeeded = true
          return
        }

        for activity in existing {
          Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }

        let startedAt = Date(timeIntervalSince1970: run.startedAtMs / 1000)
        let targetEndAt = Date(timeIntervalSince1970: run.targetEndMs / 1000)
        let attributes = FocusActivityAttributes(
          key: run.key,
          title: run.title,
          subtitle: run.subtitle,
          symbolName: run.symbolName,
          startedAt: startedAt,
          targetEndAt: targetEndAt,
          paused: run.paused,
          pausedRemaining: run.pausedRemaining,
          primaryLabel: run.primaryLabel,
          primaryUrl: run.primaryUrl,
          advanceLabel: run.advanceLabel,
          advanceUrl: run.advanceUrl
        )
        let staleDate: Date? = run.paused ? nil : max(targetEndAt, Date().addingTimeInterval(1))
        let content = ActivityContent(state: FocusActivityAttributes.ContentState(), staleDate: staleDate)
        _ = try? Activity.request(attributes: attributes, content: content, pushType: nil)

        succeeded = true
      }
      return succeeded
    }
    .runOnQueue(.main)
  }
}
