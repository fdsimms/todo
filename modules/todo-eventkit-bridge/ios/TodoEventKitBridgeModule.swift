import ExpoModulesCore
import EventKit
import MapKit
import CoreLocation

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
///
/// It also holds the two calls behind place suggestions on a new event
/// (`searchPlaces`, `setStructuredLocation`). MapKit's search lives here rather
/// than in a module of its own because its one use is filling an event's
/// location, and the coordinate it finds is written through this file's event
/// store. Checked the same way, from each page's declaration:
/// - `MKLocalSearch.Request.init()`, `.naturalLanguageQuery: String?`,
///   `.resultTypes: MKLocalSearch.ResultType` (iOS 13), with `.pointOfInterest`
///   and `.address`
/// - `MKLocalSearch.init(request: MKLocalSearch.Request)`,
///   `start(completionHandler: (MKLocalSearch.Response?, (any Error)?) -> Void)`,
///   `cancel()`; `MKLocalSearch.Response.mapItems: [MKMapItem]`
/// - `MKMapItem.name: String?`; `.location: CLLocation` and
///   `.address: MKAddress?` (iOS 26), with `MKAddress.fullAddress: String`;
///   `.placemark: MKPlacemark` (deprecated in iOS 26, so read only below it)
/// - `EKStructuredLocation.init(title: String)`, `.geoLocation: CLLocation?`
/// - `EKEvent.structuredLocation: EKStructuredLocation?` (iOS 9)
/// - `EKEventStore.event(withIdentifier:) -> EKEvent?` (does not throw),
///   `save(_ event: EKEvent, span: EKSpan, commit: Bool) throws`
///
/// And the travel-time estimate behind "Leave for X" (`estimateTravelTime`):
/// - `MKDirections.Request` (`.source`, `.destination: MKMapItem?`,
///   `.transportType: MKDirectionsTransportType` with `.automobile`,
///   `.transit` (iOS 9) and `.walking`, `.departureDate: Date?`)
/// - `MKDirections.init(request:)`,
///   `calculateETA(completionHandler: (MKDirections.ETAResponse?, (any Error)?) -> Void)`;
///   `MKDirections.ETAResponse.expectedTravelTime: TimeInterval`
/// - `MKMapItem.forCurrentLocation() -> MKMapItem`; `MKMapItem.init(location:address:)`
///   (iOS 26) and, below it, `init(placemark:)` with `MKPlacemark.init(coordinate:)`
///   (both deprecated in iOS 26)
/// - `EKStructuredLocation.geoLocation: CLLocation?`
///
/// The placemark's address goes through `?? nil` and an explicit optional, so
/// it compiles whether `title` reads as `String?` or `String??` (it comes from
/// the optional `MKAnnotation` requirement).
public class TodoEventKitBridgeModule: Module {
  private lazy var store = EKEventStore()
  /// The search in flight, cancelled when the next keystroke's search starts so
  /// a slow answer for "jo" can't land after the one for "joe's".
  private var currentSearch: MKLocalSearch?

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

    /// Places matching a typed query, from Apple Maps: points of interest and
    /// addresses, at most eight. Each is `name`, `address` (left out when
    /// MapKit gives none), `latitude` and `longitude`. Empty for an empty
    /// query, a failed or cancelled search, and no network. Sends the query to
    /// Apple, which is why the JS side only calls it behind its own setting.
    AsyncFunction("searchPlaces") { (query: String, promise: Promise) in
      let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty {
        promise.resolve([[String: Any]]())
        return
      }
      DispatchQueue.main.async {
        self.currentSearch?.cancel()
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = trimmed
        request.resultTypes = [.pointOfInterest, .address]
        let search = MKLocalSearch(request: request)
        self.currentSearch = search
        search.start { response, _ in
          var out: [[String: Any]] = []
          for item in (response?.mapItems ?? []).prefix(8) {
            if let place = Self.placeDictionary(item) { out.append(place) }
          }
          promise.resolve(out)
        }
      }
    }

    /// Gives an event a structured location (the place's title and
    /// coordinate), which is what lets Calendar draw a map for it and work out
    /// travel time. `title` is the same text the event's location was written
    /// with, so the two can't disagree. For a repeating event every occurrence
    /// gets it. False when the event can't be found or the save fails; the
    /// event itself is already saved either way.
    AsyncFunction("setStructuredLocation") { (eventId: String, title: String, latitude: Double, longitude: Double) -> Bool in
      guard let event = self.store.event(withIdentifier: eventId) else { return false }
      let place = EKStructuredLocation(title: title)
      place.geoLocation = CLLocation(latitude: latitude, longitude: longitude)
      event.structuredLocation = place
      do {
        try self.store.save(event, span: .futureEvents, commit: true)
        return true
      } catch {
        return false
      }
    }

    /// Minutes from where the phone is now to an event's place, leaving at
    /// `departAt` (ms since 1970), by `mode` ("driving", "transit" or
    /// "walking"). The destination is the event's structured location when it
    /// has a coordinate, else the first Apple Maps match for `address`.
    /// Resolves -1 for every failure (no location permission, nothing found
    /// for the address, no route, no network), which the JS side reads as "no
    /// estimate" and falls back to the typed lead. Sends the address and the
    /// current position to Apple, which is why it is only called behind the
    /// travel-estimate setting.
    AsyncFunction("estimateTravelTime") { (eventId: String, address: String, departAt: Double, mode: String, promise: Promise) in
      let pinned: CLLocation? = eventId.isEmpty ? nil : self.store.event(withIdentifier: eventId)?.structuredLocation?.geoLocation
      DispatchQueue.main.async {
        let estimate = { (destination: MKMapItem) in
          let request = MKDirections.Request()
          request.source = MKMapItem.forCurrentLocation()
          request.destination = destination
          request.transportType = Self.transportType(mode)
          if departAt > 0 { request.departureDate = Date(timeIntervalSince1970: departAt / 1000) }
          // Captured by its own handler so nothing can free it mid-request.
          let directions = MKDirections(request: request)
          directions.calculateETA { response, _ in
            _ = directions
            guard let seconds = response?.expectedTravelTime, seconds.isFinite, seconds >= 0 else {
              promise.resolve(-1.0)
              return
            }
            promise.resolve(seconds / 60)
          }
        }
        if let pinned = pinned {
          estimate(Self.mapItem(at: pinned.coordinate))
          return
        }
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
          promise.resolve(-1.0)
          return
        }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = trimmed
        request.resultTypes = [.pointOfInterest, .address]
        let search = MKLocalSearch(request: request)
        search.start { response, _ in
          _ = search
          guard let first = response?.mapItems.first else {
            promise.resolve(-1.0)
            return
          }
          estimate(first)
        }
      }
    }
  }

  /// A map item at a coordinate, through the initializer each OS version wants.
  private static func mapItem(at coordinate: CLLocationCoordinate2D) -> MKMapItem {
    if #available(iOS 26.0, *) {
      return MKMapItem(location: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude), address: nil)
    } else {
      return MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
    }
  }

  private static func transportType(_ mode: String) -> MKDirectionsTransportType {
    switch mode {
    case "transit": return .transit
    case "walking": return .walking
    default: return .automobile
    }
  }

  private static func placeDictionary(_ item: MKMapItem) -> [String: Any]? {
    let latitude: Double
    let longitude: Double
    var address: String? = nil
    if #available(iOS 26.0, *) {
      let coordinate = item.location.coordinate
      latitude = coordinate.latitude
      longitude = coordinate.longitude
      let full: String? = item.address?.fullAddress
      address = full
    } else {
      let location: CLLocation? = item.placemark.location
      guard let coordinate = location?.coordinate else { return nil }
      latitude = coordinate.latitude
      longitude = coordinate.longitude
      let title: String? = item.placemark.title ?? nil
      address = title
    }
    guard CLLocationCoordinate2DIsValid(CLLocationCoordinate2D(latitude: latitude, longitude: longitude)) else { return nil }
    let name: String? = item.name
    var place: [String: Any] = ["latitude": latitude, "longitude": longitude]
    if let name = name, !name.isEmpty { place["name"] = name }
    if let address = address?.replacingOccurrences(of: "\n", with: ", "), !address.isEmpty {
      place["address"] = address
    }
    if place["name"] == nil && place["address"] == nil { return nil }
    return place
  }
}
