import ActivityKit
import ExpoModulesCore
import WidgetKit

private let appGroupID = "group.com.fdsimms.dundundun"
private let snapshotFileName = "widget_data.json"
// Must match the same literal in TodoWidgetData.swift — a separate Xcode
// target/compilation unit, so the string can't be shared directly.
private let pendingCompletionsFileName = "widget_pending_completions.json"

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

    // ─── Live Activities (task link tap) ──────────────────────────────────
    // Gated at iOS 17.0, not ActivityKit's own 16.1 floor: the widget
    // extension that renders this is built at IPHONEOS_DEPLOYMENT_TARGET
    // 17.0 (plugins/withWidgetExtension.js), and the Done button is a
    // Button(intent:) inside the Live Activity, which is 17.0-only. Starting
    // an activity on an older device would produce one the extension cannot
    // render at all — an invisible failure — so this refuses at the same
    // version the extension already requires.

    // Bool, never Void — same reason as writeSnapshot above. False below iOS
    // 17.0 or when the user has turned Live Activities off for this app in
    // iOS Settings (a request would otherwise throw .denied) — surfaced to JS
    // so the settings toggle can explain itself.
    AsyncFunction("liveActivitiesEnabled") { () -> Bool in
      var enabled = false
      TodoWidgetExceptionCatcher.runCatchingExceptions {
        guard #available(iOS 17.0, *) else { return }
        enabled = ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return enabled
    }

    // Runs on the main queue deliberately: Activity.request throws
    // ActivityAuthorizationError.visibility unless the app is in the
    // foreground at the moment of the call, and the JS caller is about to
    // hand the foreground to another app via Linking.openURL right after this
    // resolves (see startLinkLiveActivity in liveActivity.ts, which awaits it
    // first). Returns true only if an activity was actually requested.
    AsyncFunction("startLinkLiveActivity") { (
      taskId: String,
      title: String,
      subtitle: String,
      symbolName: String,
      streakCount: Int,
      staleAfterSeconds: Double
    ) -> Bool in
      var started = false
      TodoWidgetExceptionCatcher.runCatchingExceptions {
        guard #available(iOS 17.0, *) else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        // "Only one at a time" is enforced here, not JS-side, so it holds
        // even if the app was killed and relaunched with an activity still
        // live. Snapshot the existing set BEFORE requesting the new one, so
        // the detached end-Task below can never race and end the activity
        // we're about to create — request() is synchronous and the new
        // activity is by construction not part of `existing`.
        let existing = Activity<TaskLinkActivityAttributes>.activities

        let attributes = TaskLinkActivityAttributes(
          taskId: taskId,
          title: title,
          subtitle: subtitle,
          symbolName: symbolName,
          streakCount: streakCount,
          startedAt: Date()
        )
        // staleDate is a rendering hint (context.isStale), not an end
        // condition — the real end condition is the app becoming active
        // again. It exists so a Live Activity that outlives its usefulness
        // (phone locked overnight) visibly says so instead of looking current.
        let content = ActivityContent(
          state: TaskLinkActivityAttributes.ContentState(),
          staleDate: Date().addingTimeInterval(staleAfterSeconds)
        )

        guard (try? Activity.request(
          attributes: attributes,
          content: content,
          pushType: nil
        )) != nil else { return }
        started = true

        Task {
          for activity in existing {
            await activity.end(nil, dismissalPolicy: .immediate)
          }
        }
      }
      return started
    }
    .runOnQueue(.main)

    // Ends every link Live Activity this app owns. Called on every AppState
    // 'active' transition (useLiveActivitySync in liveActivity.ts) and once
    // on mount, which also cleans up an activity left behind by a previous
    // app process that was killed while one was live. The Bool means "the end
    // was dispatched", not "the end completed" — Activity.end is async and
    // nothing in JS needs to wait for it.
    AsyncFunction("endLinkLiveActivities") { () -> Bool in
      var dispatched = false
      TodoWidgetExceptionCatcher.runCatchingExceptions {
        guard #available(iOS 17.0, *) else { return }
        let existing = Activity<TaskLinkActivityAttributes>.activities
        Task {
          for activity in existing {
            await activity.end(nil, dismissalPolicy: .immediate)
          }
        }
        dispatched = true
      }
      return dispatched
    }
  }
}
