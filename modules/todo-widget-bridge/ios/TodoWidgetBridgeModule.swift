import ExpoModulesCore
import WidgetKit

private let appGroupID = "group.com.fdsimms.dundundun"
private let snapshotFileName = "widget_data.json"

public class TodoWidgetBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoWidgetBridge")

    // AsyncFunction (Promise-based) rather than Function (synchronous void) —
    // still routes through the same RCTTurboModule void-invocation machinery
    // under the hood (confirmed from a crash trace; this does NOT sidestep
    // it as originally assumed), but a rejected promise is at least
    // JS-catchable, unlike the plain sync path.
    //
    // The whole body is wrapped in TodoWidgetExceptionCatcher because Swift's
    // throws/try?/guard only catch Swift `Error` — never a raw Objective-C
    // NSException, which WidgetKit/FileManager can still raise synchronously.
    // An uncaught one escaping this closure crashes the entire app on iOS 26
    // release builds with the New Architecture (see
    // facebook/react-native#54859, expo/expo#44680) — the exception-to-
    // JSError conversion rethrows on a background queue where nothing can
    // catch it, aborting the process.
    AsyncFunction("writeSnapshot") { (jsonString: String) in
      TodoWidgetExceptionCatcher.tryBlock {
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
      }
    }
  }
}
