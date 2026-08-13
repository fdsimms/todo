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
    AsyncFunction("scheduleAlarm") { (id: String, epochSeconds: Double, title: String) -> Bool in
      guard #available(iOS 26, *) else { return false }
      guard let uuid = UUID(uuidString: id) else { return false }

      var succeeded = false
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        TodoAlarmKitExceptionCatcher.runCatchingExceptions {
          Task {
            do {
              let fireDate = Date(timeIntervalSince1970: epochSeconds)
              let stopButton = AlarmButton(
                text: "Stop",
                textColor: .white,
                systemImageName: "stop.circle"
              )
              let alert = AlarmPresentation.Alert(
                title: LocalizedStringResource(stringLiteral: title),
                stopButton: stopButton
              )
              let presentation = AlarmPresentation(alert: alert)
              let attributes = AlarmAttributes<TodoAlarmMetadata>(
                presentation: presentation,
                tintColor: .accentColor
              )
              let configuration = AlarmManager.AlarmConfiguration(
                schedule: .fixed(fireDate),
                attributes: attributes
              )

              _ = try await AlarmManager.shared.schedule(id: uuid, configuration: configuration)
              succeeded = true
            } catch {
              NSLog("%@ scheduleAlarm failed: %@", exceptionCatcherLogTag, String(describing: error))
              succeeded = false
            }
            continuation.resume()
          }
        }
      }
      return succeeded
    }

    AsyncFunction("cancelAlarm") { (id: String) -> Bool in
      guard #available(iOS 26, *) else { return false }
      guard let uuid = UUID(uuidString: id) else { return false }

      var succeeded = false
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        TodoAlarmKitExceptionCatcher.runCatchingExceptions {
          Task {
            do {
              try await AlarmManager.shared.cancel(id: uuid)
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
