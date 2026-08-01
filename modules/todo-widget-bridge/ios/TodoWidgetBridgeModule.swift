import ExpoModulesCore
import WidgetKit

private let appGroupID = "group.com.fdsimms.dundundun"
private let snapshotFileName = "widget_data.json"

public class TodoWidgetBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoWidgetBridge")

    // AsyncFunction (Promise-based), not Function (synchronous void) —
    // the latter goes through RN's ObjCTurboModule::performVoidMethodInvocation
    // bridging path, which showed up as the crashing frame (inside
    // TurboModuleConvertUtils::convertNSExceptionToJSError) in a SIGSEGV
    // captured moments after launch. AsyncFunction uses the promise
    // resolution path instead, which JS can also actually catch if it ever
    // rejects — the sync path could not surface a JS-catchable error at all.
    AsyncFunction("writeSnapshot") { (jsonString: String) in
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
