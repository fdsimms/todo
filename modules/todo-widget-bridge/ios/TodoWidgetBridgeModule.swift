import ExpoModulesCore
import WidgetKit

private let appGroupID = "group.com.fdsimms.dundundun"
private let snapshotFileName = "widget_data.json"

public class TodoWidgetBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoWidgetBridge")

    Function("writeSnapshot") { (jsonString: String) in
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
