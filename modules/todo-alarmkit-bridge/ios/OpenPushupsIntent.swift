import AppIntents
import Foundation

// The Pushups button on a pushup task's alarm (Task.pushupChallenge). AlarmKit
// runs a button's `secondaryIntent` when it's tapped; this one queues the task
// id and opens the app, and src/utils/pushupAlarmOpens.ts drains the queue and
// opens that task's pushup counter.
//
// AlarmKit takes a LiveActivityIntent here, which the system otherwise runs in
// the background ("launches your app process without opening the app"), so
// opening the app is asked for explicitly: `openAppWhenRun` and, from iOS 26,
// `supportedModes`, the same pair the app's other foreground intents carry.
// Whether AlarmKit honours them from an alarm's alert is not documented, and
// is the first thing to check on a device.
//
// Main app only (the podspec's glob): no widget renders AlarmAttributes, and
// an intent that opens the app runs in the app's own process anyway (see
// docs/native-targets.md). Queued through the App Group file anyway, like
// every other intent here, so a tap that cold-launches the app is still
// waiting once JS is up.
enum PushupOpenQueue {
  // Must match the App Group the other bridges use.
  static let appGroupID = "group.com.fdsimms.dundundun"
  static let fileName = "pending_pushup_opens.json"

  static func fileURL() -> URL? {
    guard let containerURL = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupID
    ) else {
      return nil
    }
    return containerURL
      .appendingPathComponent("Library/Application Support", isDirectory: true)
      .appendingPathComponent(fileName)
  }

  static func append(_ taskId: String) {
    guard let fileURL = fileURL() else { return }
    var queued: [String] = []
    if let data = try? Data(contentsOf: fileURL),
       let decoded = try? JSONDecoder().decode([String].self, from: data) {
      queued = decoded
    }
    queued.append(taskId)
    guard let data = try? JSONEncoder().encode(queued) else { return }
    try? FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try? data.write(to: fileURL, options: .atomic)
  }

  /// The queued ids as a JSON array, and the file deleted. "[]" when there are none.
  static func drain() -> String {
    guard let fileURL = fileURL(),
          let data = try? Data(contentsOf: fileURL) else {
      return "[]"
    }
    defer { try? FileManager.default.removeItem(at: fileURL) }
    guard let decoded = try? JSONDecoder().decode([String].self, from: data),
          let reencoded = try? JSONEncoder().encode(decoded) else {
      return "[]"
    }
    return String(data: reencoded, encoding: .utf8) ?? "[]"
  }
}

@available(iOS 26.0, *)
struct OpenPushupsIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Do Pushups"
  static var description = IntentDescription("Opens the pushup counter for the task an alarm is ringing for.")

  // Only an alarm can say which task it is ringing for, so this is no use
  // from the Shortcuts app.
  static var isDiscoverable: Bool = false

  static var openAppWhenRun: Bool = true

  static var supportedModes: IntentModes { .foreground(.immediate) }

  @Parameter(title: "Task")
  var taskId: String

  init() {}

  init(taskId: String) {
    self.taskId = taskId
  }

  func perform() async throws -> some IntentResult {
    PushupOpenQueue.append(taskId)
    return .result()
  }
}
