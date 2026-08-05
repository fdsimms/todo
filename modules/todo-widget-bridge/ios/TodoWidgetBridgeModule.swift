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
  }
}
