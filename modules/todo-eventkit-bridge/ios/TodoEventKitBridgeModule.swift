import ExpoModulesCore
import EventKit

/// Reads `calendarItemExternalIdentifier` for events the app already reads
/// through expo-calendar, which exposes only the device-local
/// `calendarItemIdentifier`.
///
/// Apple documents the local id as lost on a full sync with the calendar
/// server, and as meaningful on one device only. The external id is "the
/// calendar item's external identifier as provided by the calendar server"
/// and is the one meant to identify the same event across devices, which is
/// what lets the app's own notes about an event (who it is with) sync.
///
/// Signatures checked against Apple's documentation:
/// - `EKEventStore.calendarItem(withIdentifier:) -> EKCalendarItem?` (does not throw)
/// - `EKCalendarItem.calendarItemExternalIdentifier: String!`
public class TodoEventKitBridgeModule: Module {
  private lazy var store = EKEventStore()

  public func definition() -> ModuleDefinition {
    Name("TodoEventKitBridge")

    Function("isAvailable") { () -> Bool in
      return true
    }

    /// Local id -> external id, for every id that resolves. An id that does
    /// not resolve (deleted, no access) is simply absent from the result, so
    /// the caller falls back to the local id for it.
    AsyncFunction("externalIdentifiers") { (localIds: [String]) -> [String: String] in
      var out: [String: String] = [:]
      for localId in localIds {
        guard let item = self.store.calendarItem(withIdentifier: localId) else { continue }
        let external: String? = item.calendarItemExternalIdentifier
        if let external = external, !external.isEmpty {
          out[localId] = external
        }
      }
      return out
    }
  }
}
