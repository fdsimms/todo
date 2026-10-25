import ExpoModulesCore

// AlarmKit is iOS 26+ only and is weak-linked (see plugins/withAlarmKit.js)
// so this app keeps a pre-26 deployment target — every call into it must be
// gated behind `if #available(iOS 26, *)` and the framework must only be
// `import`ed inside that check's compilation unit awareness. Swift lets us
// `import AlarmKit` unconditionally at file scope (the import itself is
// always safe — it's *using* the symbols that must be guarded), so long as
// the containing Xcode project links against the iOS 26 SDK (Xcode 26+).
//
// NOTE: AlarmKit's exact type/method signatures below were written against
// the public WWDC25 "Wake up to the AlarmKit API" session and early
// third-party writeups, not a compiled iOS 26 SDK (unavailable in this
// sandbox). Before shipping, verify every signature here against the real
// AlarmKit headers in Xcode 26 (Cmd-click into the framework) and adjust —
// most likely candidates for drift are the exact `AlarmConfiguration`
// initializer labels and whether `cancel`/`stop` is `async throws` or sync.
#if canImport(AlarmKit)
import AlarmKit
#endif

private let exceptionCatcherLogTag = "[TodoAlarmKitBridge]"

// Empty metadata payload — this app doesn't need AlarmKit's Live
// Activity-style custom metadata, just a fire-once alert at a fixed time.
@available(iOS 26, *)
struct TodoAlarmMetadata: AlarmMetadata {}

public class TodoAlarmKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoAlarmKit")

    // Exposed synchronously (not async) because this is a pure capability
    // check with no I/O — callers (notifications.ts) branch on it before
    // deciding which scheduling backend to use.
    Function("isAvailable") { () -> Bool in
      if #available(iOS 26, *) {
        return true
      }
      return false
    }

    // Returns a plain String rather than an enum/Void — see the Bool-return
    // convention note in TodoAlarmKitModule's sibling
    // TodoWidgetBridgeModule.swift (facebook/react-native#54859): async
    // methods that would naturally return Void or an unbridged enum are
    // more fragile across the TurboModule boundary, so keep this to a
    // simple JS-friendly value type.
    AsyncFunction("requestAuthorization") { () -> String in
      guard #available(iOS 26, *) else { return "denied" }
      var result = "denied"
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        TodoAlarmKitExceptionCatcher.runCatchingExceptions {
          Task {
            do {
              let state = try await AlarmManager.shared.requestAuthorization()
              result = alarmKitAuthorizationStateString(state)
            } catch {
              NSLog("%@ requestAuthorization failed: %@", exceptionCatcherLogTag, String(describing: error))
              result = "denied"
            }
            continuation.resume()
          }
        }
      }
      return result
    }

    // `id` is an alarm id, NOT a task id — the JS side derives a real UUID per
    // ring in src/utils/alarmChain.ts (`taskAlarmUuid`) and passes that. This
    // matters because `generateId()` produces ids like "m1a2b3c4d5e6f", which
    // `UUID(uuidString:)` rejects: passing a bare task id here made every
    // schedule bail at the guard below and silently return false. Don't
    // "simplify" the call sites back to handing this a task id.
    //
    // `missionJson` is set only for an alarm with a mission (MissionPayload in
    // MissionAlarm.swift): the alert then carries the mission's button, and
    // Stop keeps it coming back until the app completes the mission.
    //
    // `soundName` is a file in Library/Sounds (`installSound` below) to ring
    // with, or nil for the system's alarm sound. A mission carries it too, so
    // every re-armed ring sounds like the first.
    AsyncFunction("scheduleAlarm") { (id: String, epochSeconds: Double, title: String, missionJson: String?, soundName: String?) -> Bool in
      guard #available(iOS 26, *) else { return false }
      guard let uuid = UUID(uuidString: id) else { return false }
      let configuration = AlarmBuilder.configuration(
        schedule: .fixed(Date(timeIntervalSince1970: epochSeconds)),
        title: title,
        mission: MissionPayload.decode(missionJson)?.withSound(soundName),
        sound: soundName
      )
      return await scheduleCatching(id: uuid, configuration: configuration, label: "scheduleAlarm")
    }

    // A repeating alarm on AlarmKit's own weekly schedule, so it keeps
    // ringing on its days whether or not the app is opened in between.
    // `weekdays` are 0 = Sunday, as in JS.
    AsyncFunction("scheduleWeeklyAlarm") { (id: String, hour: Int, minute: Int, weekdays: [Int], title: String, missionJson: String?, soundName: String?) -> Bool in
      guard #available(iOS 26, *) else { return false }
      guard let uuid = UUID(uuidString: id) else { return false }
      let days = weekdays.compactMap(localeWeekday)
      guard !days.isEmpty else { return false }
      let configuration = AlarmBuilder.configuration(
        schedule: .relative(.init(time: .init(hour: hour, minute: minute), repeats: .weekly(days))),
        title: title,
        mission: MissionPayload.decode(missionJson)?.withSound(soundName),
        sound: soundName
      )
      return await scheduleCatching(id: uuid, configuration: configuration, label: "scheduleWeeklyAlarm")
    }

    // The missions whose alarm has been stopped and that are still owed, as a
    // JSON array (MissionStore.pendingJSON). Reading clears nothing.
    AsyncFunction("pendingMissions") { () -> String in
      return MissionStore.pendingJSON()
    }

    // Marks a mission pending and puts its next ring `seconds` out: 15 when
    // the counter closes unfinished, a minute (renewed) while it is open.
    AsyncFunction("deferMission") { (missionJson: String, seconds: Double) -> Bool in
      guard #available(iOS 26, *) else { return false }
      guard let mission = MissionPayload.decode(missionJson) else { return false }
      await MissionLoop.rearm(mission, after: seconds)
      return true
    }

    // The mission is done or given up: no more rings for it.
    AsyncFunction("completeMission") { (key: String) -> Bool in
      guard #available(iOS 26, *) else { return false }
      MissionLoop.complete(key: key)
      return true
    }

    // Alarm sounds (AlarmSoundFiles.swift). Not gated on iOS 26: the files
    // are plain audio, and installing one ahead of the schedule is harmless
    // on a phone that can't ring with it yet.
    AsyncFunction("installSound") { (sourceUri: String, fileName: String, maxSeconds: Double) -> Bool in
      return AlarmSoundFiles.install(from: sourceUri, as: fileName, maxSeconds: maxSeconds)
    }

    Function("hasSound") { (fileName: String) -> Bool in
      return AlarmSoundFiles.exists(fileName)
    }

    // A file:// URI the app can play a preview from, or nil if it isn't installed.
    Function("soundUri") { (fileName: String) -> String? in
      guard AlarmSoundFiles.exists(fileName), let url = AlarmSoundFiles.url(for: fileName) else { return nil }
      return url.absoluteString
    }

    AsyncFunction("deleteSound") { (fileName: String) -> Bool in
      return AlarmSoundFiles.delete(fileName)
    }

    AsyncFunction("cancelAlarm") { (id: String) -> Bool in
      guard #available(iOS 26, *) else { return false }
      guard let uuid = UUID(uuidString: id) else { return false }

      var succeeded = false
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        TodoAlarmKitExceptionCatcher.runCatchingExceptions {
          Task {
            do {
              try AlarmManager.shared.cancel(id: uuid)
              succeeded = true
            } catch {
              // Cancelling an alarm that doesn't exist (already fired,
              // never scheduled, or scheduled before a reinstall) is a
              // normal no-op path, not a real failure — swallow.
              succeeded = false
            }
            continuation.resume()
          }
        }
      }
      return succeeded
    }
  }
}

@available(iOS 26, *)
private func alarmKitAuthorizationStateString(_ state: AlarmManager.AuthorizationState) -> String {
  switch state {
  case .authorized:
    return "authorized"
  case .denied:
    return "denied"
  case .notDetermined:
    return "notDetermined"
  @unknown default:
    return "denied"
  }
}

@available(iOS 26, *)
private func scheduleCatching(
  id: UUID,
  configuration: AlarmManager.AlarmConfiguration<TodoAlarmMetadata>,
  label: String
) async -> Bool {
  var succeeded = false
  await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
    TodoAlarmKitExceptionCatcher.runCatchingExceptions {
      Task {
        do {
          _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
          succeeded = true
        } catch {
          NSLog("%@ %@ failed: %@", exceptionCatcherLogTag, label, String(describing: error))
          succeeded = false
        }
        continuation.resume()
      }
    }
  }
  return succeeded
}

@available(iOS 16, *)
private func localeWeekday(_ day: Int) -> Locale.Weekday? {
  switch day {
  case 0: return .sunday
  case 1: return .monday
  case 2: return .tuesday
  case 3: return .wednesday
  case 4: return .thursday
  case 5: return .friday
  case 6: return .saturday
  default: return nil
  }
}
