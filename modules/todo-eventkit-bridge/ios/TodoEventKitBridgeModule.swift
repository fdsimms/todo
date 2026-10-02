import ExpoModulesCore
import EventKit

/// Reads `calendarItemExternalIdentifier` for events the app already reads
/// through expo-calendar, which exposes only the device-local
/// `calendarItemIdentifier`, and finds events again by it.
///
/// Apple documents the local id as lost on a full sync with the calendar
/// server, and as meaningful on one device only. The external id is "the
/// calendar item's external identifier as provided by the calendar server"
/// and is the one meant to identify the same event across devices, which is
/// what lets the app's own notes about an event (who it is with) sync, and
/// what lets a backup restored on a new phone find the meal and deadline
/// events and time blocks the old phone wrote (#2950).
///
/// Signatures checked against Apple's documentation, from the raw
/// `declarationFragments` of each page's JSON form
/// (developer.apple.com/tutorials/data/documentation/eventkit/<symbol>.json)
/// rather than a paraphrase:
/// - `EKEventStore.calendarItem(withIdentifier:) -> EKCalendarItem?` (does not throw)
/// - `EKEventStore.calendarItems(withExternalIdentifier:) -> [EKCalendarItem]`
///   (does not throw, non-optional; "all reminders or the first occurrences
///   of all events" with that id)
/// - `EKCalendarItem.calendarItemExternalIdentifier: String!`
/// - `EKCalendarItem.calendarItemIdentifier: String`
/// - `EKCalendarItem.calendar: EKCalendar!`
/// - `EKCalendar.calendarIdentifier: String`
/// - `EKEvent.isAllDay: Bool`
/// - `EKEvent` inherits from `EKCalendarItem` (the class page's
///   "Inherits From" relationship)
///
/// The reads below that don't need a particular shape are written so a wrong
/// guess at optional-versus-not still compiles: each value goes through an
/// explicit optional (`let x: T? = ...`), which accepts `T`, `T!` and `T?`
/// alike, and the lookup is `try?` with a fallback, which accepts it throwing
/// or not.
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

    /// Every event this device holds under a calendar server's id: its local
    /// id, whether it is all-day, and the local id of the calendar it sits in
    /// (left out when EventKit gives none). Empty when nothing matches, and
    /// when there is no access.
    ///
    /// Several can come back, and this only reports them. Apple lists the
    /// reasons on `calendarItemExternalIdentifier`: an ICS file imported into
    /// more than one calendar, an event in a calendar shared with the user who
    /// was also invited to it, a delegate's copy, a subscribed calendar added
    /// to more than one account. A recurring series comes back once, as its
    /// first occurrence. Which one, if any, belongs to a row is the caller's
    /// call (`adoptableEventId` and `adoptableTimeBlockId` in
    /// src/utils/calendarEventLink.ts, which refuse to guess between copies).
    /// Reminders share the lookup and are left out.
    AsyncFunction("eventsWithExternalIdentifier") { (externalId: String) -> [[String: Any]] in
      if externalId.isEmpty { return [] }
      let items: [EKCalendarItem] = (try? self.store.calendarItems(withExternalIdentifier: externalId)) ?? []
      var out: [[String: Any]] = []
      for item in items {
        guard let event = item as? EKEvent else { continue }
        let localId: String? = event.calendarItemIdentifier
        guard let id = localId, !id.isEmpty else { continue }
        var match: [String: Any] = ["id": id, "allDay": event.isAllDay]
        let calendar: EKCalendar? = event.calendar
        let calendarId: String? = calendar?.calendarIdentifier
        if let calendarId = calendarId, !calendarId.isEmpty {
          match["calendarId"] = calendarId
        }
        out.append(match)
      }
      return out
    }
  }
}
