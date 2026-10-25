import AppIntents
import Foundation
import SwiftUI
#if canImport(ActivityKit)
import ActivityKit
#endif
#if canImport(AlarmKit)
import AlarmKit
#endif

// The native half of an alarm with a mission (src/utils/missions.ts has the
// whole design). iOS gives no app a way to hide an alarm's Stop button, so the
// loop is built on it: Stop runs `MissionAlarmIntent`, which records the
// mission as pending and schedules the next ring MISSION_REARM_SECONDS out,
// with the same two intents on it. Nothing here ends the loop; only the app
// does, through `completeMission` once the mission is done or given up.
//
// Main app only (the podspec's glob): an intent that schedules alarms and
// opens the app runs in the app's process, and no widget renders
// AlarmAttributes (see docs/native-targets.md). Not verified on a device:
// whether AlarmKit runs a LiveActivityIntent's perform() on Stop with the app
// closed, and whether it honours openAppWhenRun from an alarm's alert.

/// What an alarm's mission is, as JS hands it over (JSON) and as the pending
/// store keeps it. `key` is the opaque mission key (`task:<id>`,
/// `alarm:<id>`); the rest is what the re-armed ring has to show. `sound` is
/// the alarm's sound file (nil for the system's), set by the schedule call
/// rather than by JS's mission object, so a re-arm rings with it too.
struct MissionPayload: Codable {
  let key: String
  let kind: String
  let count: Int
  let title: String
  let buttonLabel: String
  var sound: String? = nil

  func withSound(_ sound: String?) -> MissionPayload {
    var copy = self
    copy.sound = sound
    return copy
  }

  static func decode(_ json: String?) -> MissionPayload? {
    guard let json, let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(MissionPayload.self, from: data)
  }
}

/// A mission whose alarm has rung and been stopped, waiting on the app.
/// `rearmId` is the ring scheduled to come back if nothing finishes it.
struct PendingMission: Codable {
  let mission: MissionPayload
  let since: Double
  var rearmId: String?
}

/// The pending missions, in the App Group like every other queue the app's
/// intents write, so one recorded by a Stop that cold-launched the app is
/// still there once JS is up. Keyed by mission key.
enum MissionStore {
  // Must match the App Group the other bridges use.
  static let appGroupID = "group.com.fdsimms.dundundun"
  static let fileName = "alarm_missions.json"

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

  static func read() -> [String: PendingMission] {
    guard let url = fileURL(),
          let data = try? Data(contentsOf: url),
          let decoded = try? JSONDecoder().decode([String: PendingMission].self, from: data) else {
      return [:]
    }
    return decoded
  }

  static func write(_ missions: [String: PendingMission]) {
    guard let url = fileURL(), let data = try? JSONEncoder().encode(missions) else { return }
    try? FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try? data.write(to: url, options: .atomic)
  }

  /// The pending missions as a JSON array, for JS. Read only, never cleared:
  /// a mission stays pending until `MissionLoop.complete`.
  static func pendingJSON() -> String {
    let list = read().values.map { pending -> [String: Any] in
      [
        "key": pending.mission.key,
        "kind": pending.mission.kind,
        "count": pending.mission.count,
        "title": pending.mission.title,
        "buttonLabel": pending.mission.buttonLabel,
        "since": pending.since,
      ]
    }
    guard let data = try? JSONSerialization.data(withJSONObject: list),
          let json = String(data: data, encoding: .utf8) else {
      return "[]"
    }
    return json
  }
}

@available(iOS 26, *)
enum AlarmBuilder {
  /// The mark's gold (colors.brand). It colors the title, countdown and
  /// Dynamic Island; the system fills only a secondary button with it, which
  /// only a mission's alarm has (its text is ink for that reason), so the Stop
  /// button's white text never sits on gold. Written as `.init` because this
  /// file doesn't import SwiftUI by name.
  static let tint: Color = .init(red: 1.0, green: 176.0 / 255.0, blue: 32.0 / 255.0)

  /// Every alarm the app schedules, with or without a mission. A mission adds
  /// the button that opens it and the intents that keep the alarm coming back.
  static func configuration(
    schedule: Alarm.Schedule,
    title: String,
    mission: MissionPayload?,
    sound: String?
  ) -> AlarmManager.AlarmConfiguration<TodoAlarmMetadata> {
    let stopButton = AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
    // `.custom` is AlarmKit's "this button runs secondaryIntent" behaviour; the
    // other one, `.countdown`, is a snooze.
    let missionButton: AlarmButton? = mission.map {
      AlarmButton(text: LocalizedStringResource(stringLiteral: $0.buttonLabel), textColor: .black, systemImageName: "figure.strengthtraining.functional")
    }
    // The stopButton initializer is deprecated in iOS 26.1, where the system
    // draws Stop itself, but it is the one available on 26.0 and still
    // compiles and runs on 26.1+.
    let alert = AlarmPresentation.Alert(
      title: LocalizedStringResource(stringLiteral: title),
      stopButton: stopButton,
      secondaryButton: missionButton,
      secondaryButtonBehavior: missionButton == nil ? nil : .custom
    )
    let attributes = AlarmAttributes<TodoAlarmMetadata>(
      presentation: AlarmPresentation(alert: alert),
      tintColor: tint
    )
    // Stop comes back after the short wait; the mission button gives a minute,
    // which the app keeps pushing back while the counter is open.
    let stopIntent: (any LiveActivityIntent)? = mission.map {
      MissionAlarmIntent(mission: $0, rearmSeconds: MissionLoop.stopRearmSeconds) as any LiveActivityIntent
    }
    let secondaryIntent: (any LiveActivityIntent)? = mission.map {
      MissionAlarmIntent(mission: $0, rearmSeconds: MissionLoop.openRearmSeconds) as any LiveActivityIntent
    }
    // A name the system can't find or play rings with its default sound.
    let alertSound: AlertConfiguration.AlertSound = sound.map { .named($0) } ?? .default
    return AlarmManager.AlarmConfiguration(
      schedule: schedule,
      attributes: attributes,
      stopIntent: stopIntent,
      secondaryIntent: secondaryIntent,
      sound: alertSound
    )
  }
}

@available(iOS 26, *)
enum MissionLoop {
  // MISSION_REARM_SECONDS and MISSION_COUNTING_GRACE_SECONDS in missions.ts.
  static let stopRearmSeconds = 15
  static let openRearmSeconds = 60

  /// Records the mission as pending and puts its next ring `seconds` out,
  /// replacing the one already waiting, so there is only ever one.
  static func rearm(_ incoming: MissionPayload, after seconds: Double) async {
    var missions = MissionStore.read()
    let existing = missions[incoming.key]
    // JS defers a mission without knowing its sound; the one the alarm rang
    // with is kept.
    let mission = incoming.sound == nil ? incoming.withSound(existing?.mission.sound) : incoming
    if let old = existing?.rearmId, let oldId = UUID(uuidString: old) {
      try? AlarmManager.shared.cancel(id: oldId)
    }
    let id = UUID()
    let configuration = AlarmBuilder.configuration(
      schedule: .fixed(Date().addingTimeInterval(seconds)),
      title: mission.title,
      mission: mission,
      sound: mission.sound
    )
    do {
      _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
      missions[mission.key] = PendingMission(mission: mission, since: existing?.since ?? Date().timeIntervalSince1970 * 1000, rearmId: id.uuidString)
    } catch {
      NSLog("[TodoAlarmKitBridge] mission rearm failed: %@", String(describing: error))
      missions[mission.key] = PendingMission(mission: mission, since: existing?.since ?? Date().timeIntervalSince1970 * 1000, rearmId: nil)
    }
    MissionStore.write(missions)
  }

  /// The mission is over, done or given up: its waiting ring is cancelled
  /// and it stops being pending.
  static func complete(key: String) {
    var missions = MissionStore.read()
    if let rearm = missions[key]?.rearmId, let id = UUID(uuidString: rearm) {
      try? AlarmManager.shared.stop(id: id)
      try? AlarmManager.shared.cancel(id: id)
    }
    missions.removeValue(forKey: key)
    MissionStore.write(missions)
  }
}

/// Run by an alarm with a mission: by Stop (back in 15 seconds) and by its
/// mission button (back in a minute). Either way the mission is now pending
/// and the app is opened to do it.
@available(iOS 26.0, *)
struct MissionAlarmIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Alarm Mission"
  static var description = IntentDescription("Keeps an alarm with a mission coming back until the mission is done.")

  // Only an alarm can say which mission it is ringing for.
  static var isDiscoverable: Bool = false

  // The same pair the app's other foreground intents carry.
  static var openAppWhenRun: Bool = true
  static var supportedModes: IntentModes { .foreground(.immediate) }

  @Parameter(title: "Key") var key: String
  @Parameter(title: "Kind") var kind: String
  @Parameter(title: "Count") var count: Int
  @Parameter(title: "Title") var alarmTitle: String
  @Parameter(title: "Button") var buttonLabel: String
  @Parameter(title: "Rearm Seconds") var rearmSeconds: Int
  @Parameter(title: "Sound") var soundName: String?

  init() {}

  init(mission: MissionPayload, rearmSeconds: Int) {
    self.key = mission.key
    self.kind = mission.kind
    self.count = mission.count
    self.alarmTitle = mission.title
    self.buttonLabel = mission.buttonLabel
    self.rearmSeconds = rearmSeconds
    self.soundName = mission.sound
  }

  func perform() async throws -> some IntentResult {
    let mission = MissionPayload(key: key, kind: kind, count: count, title: alarmTitle, buttonLabel: buttonLabel, sound: soundName)
    await MissionLoop.rearm(mission, after: Double(rearmSeconds))
    return .result()
  }
}
