import ExpoModulesCore
import Foundation
import UIKit
import UserNotifications
import WatchConnectivity

// The iPhone's half of the Apple Watch app (targets/todo-watch).
//
// The watch is a separate device with its own containers, so it can't read
// anything in this App Group. WatchConnectivity is the only way across, and
// this is the one place the app touches it. It does two jobs:
//
// - **Out to the watch:** each snapshot the app writes for it (a copy of the
//   widget's, built with larger caps by src/utils/widgetSync.ts) goes over
//   as the session's application context, compressed. The context is "the
//   latest state": the system keeps only the newest one and delivers it when
//   the watch app next runs, which is the right shape for a list the phone
//   rewrites on every change.
// - **Back from the watch:** a tap arrives as a user-info transfer (queued on
//   the watch, delivered once, in order) and is appended to the same App
//   Group queue the widget's own quiet checkboxes write to, in the same
//   shape. So the app applies watch taps with the code it already has
//   (processQuietWidgetTaps in widgetSync.ts), with the same rules about what
//   still needs the app, and the widget shows them as done in the meantime.
//   A dictated task joins AddTaskIntent's queue the same way.
//
// **What the watch shows as done is settled here, by id.** Every watch tap
// carries a `watchTapId`. The context sent back lists the ids still waiting in
// the queue (or drained but not yet reflected in a snapshot) and the ids
// received recently. The watch keeps drawing a tap until it is received and no
// longer waiting, which is exactly when the snapshot riding with that context
// already includes it. Nothing here compares clocks across the two devices.
//
// The session is activated at launch by WatchSessionAppDelegate below, before
// any JS runs, so a transfer that arrives while the app is in the background
// still lands in the queue.
//
// **A tap can also wake the app to be applied.** The watch sends each tap
// twice when the phone is in reach: as the queued transfer, and as a message,
// which is what wakes this app in the background. The receipt is the same
// either way and the second copy is dropped by its id. With the app not in
// front, this asks iOS for background time, and the next snapshot written for
// the watch hands it back: that write is the end of applying the tap
// (runWatchWork in src/utils/backgroundRefresh.ts). The onWatchQueuedWork
// notice is kept until JS has heard it, because on a cold launch the tap
// arrives while the bundle is still loading, before anything is listening.

// Same literals as TodoWidgetBridgeModule.swift and AddTaskIntent.swift: Swift
// top-level `private` is file-scoped, so each file keeps its own copy.
private let watchAppGroupID = "group.com.fdsimms.dundundun"
private let watchQuietTapsFileName = "widget_quiet_taps.json"
private let watchAddTasksFileName = "widget_pending_add_tasks.json"
// The latest snapshot written for the watch, kept so a tap that arrives with
// no fresh write behind it can be answered with the context it changes. The
// app's own container rather than the App Group: no extension reads it.
private let watchSnapshotFileName = "watch_snapshot.json"

extension Notification.Name {
  /// Posted after a watch tap or dictated task has been queued, so a running
  /// app can drain at once rather than at its next foreground.
  static let todoWatchQueuedWork = Notification.Name("TodoWatchQueuedWork")
}

final class WatchSession: NSObject, WCSessionDelegate {
  static let shared = WatchSession()

  /// How many recently received tap ids the context carries back. The watch
  /// only needs the ones it is still drawing, which is a handful; this is
  /// slack for a watch that was out of range for a long trip.
  private static let receivedIdLimit = 200
  private static let receivedIdsKey = "watchReceivedTapIds"

  /// Every file read and write and every push runs here, in order: the
  /// delegate is called on a background thread of WatchConnectivity's
  /// choosing and the module's functions on the module's own queue.
  private let queue = DispatchQueue(label: "com.fdsimms.dundundun.watch-session")

  /// Watch taps the app has drained into JS but that no snapshot written since
  /// accounts for. Still "waiting" as far as the watch is concerned, or it
  /// would stop drawing them in the moment between the drain and the write.
  /// In memory only: a relaunch writes a fresh snapshot anyway.
  private var drainedAwaitingSnapshot = Set<String>()

  /// Watch work was queued and no JS listener has been told yet. Read and
  /// cleared on `queue`.
  private var unannouncedWork = false

  /// The background time asked for when a tap arrived with the app not in
  /// front. Main thread only.
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  /// A snapshot the app wrote for the watch. Kept, then sent.
  func writeSnapshot(_ json: String) {
    queue.async {
      guard let data = json.data(using: .utf8), let url = Self.snapshotURL() else { return }
      try? FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try? data.write(to: url, options: .atomic)
      self.drainedAwaitingSnapshot.removeAll()
      self.pushContext()
      // The tap that woke the app has been applied and the watch told.
      DispatchQueue.main.async { self.endBackgroundTime() }
    }
  }

  /// Taps a drain put back (tapsToRequeue in widgetQuietTaps.ts), returned to
  /// the front of the queue, ahead of anything that arrived since.
  func requeue(_ tapsData: Data) {
    queue.async {
      let entries = Self.decodeEntries(tapsData)
      guard !entries.isEmpty, let url = Self.appGroupFile(watchQuietTapsFileName) else { return }
      coordinatedQueueWrite(url) { url in
        var existing: [Any] = []
        if let data = try? Data(contentsOf: url),
           let decoded = (try? JSONSerialization.jsonObject(with: data)) as? [Any] {
          existing = decoded
        }
        let requeued: [Any] = entries.map { $0 as Any }
        guard let merged = try? JSONSerialization.data(withJSONObject: requeued + existing) else { return }
        try? FileManager.default.createDirectory(
          at: url.deletingLastPathComponent(),
          withIntermediateDirectories: true
        )
        try? merged.write(to: url, options: .atomic)
      }
      self.pushContext()
    }
  }

  /// Whether watch work was queued that no JS listener has heard of, clearing
  /// it. The module asks when JS first listens, to replay the notice.
  func takeUnannouncedWork() -> Bool {
    queue.sync {
      let pending = unannouncedWork
      unannouncedWork = false
      return pending
    }
  }

  /// The notice reached a JS listener.
  func markAnnounced() {
    queue.async { self.unannouncedWork = false }
  }

  /// Called with the quiet-tap queue the app has just read and deleted, so the
  /// watch taps in it stay "waiting" until the next snapshot.
  func noteDrained(_ queueData: Data) {
    queue.async {
      for entry in Self.decodeEntries(queueData) {
        if let tapId = entry["watchTapId"] as? String { self.drainedAwaitingSnapshot.insert(tapId) }
      }
    }
  }

  // ==== Out to the watch ====

  /// Runs on `queue`.
  private func pushContext() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else {
      return
    }
    guard let url = Self.snapshotURL(),
          let raw = try? Data(contentsOf: url),
          let compressed = try? (raw as NSData).compressed(using: .lzfse) as Data else {
      return
    }
    let context: [String: Any] = [
      "snapshot": compressed,
      "pendingTapIds": Array(pendingTapIds()),
      "receivedTapIds": UserDefaults.standard.stringArray(forKey: Self.receivedIdsKey) ?? [],
      // Makes every context differ, so a push after a tap is never coalesced
      // away as a repeat of the last one.
      "sentAt": Date().timeIntervalSince1970,
    ]
    // Throws for a payload past the transport's limit or a session that went
    // inactive mid-call. The watch keeps the last context it got either way.
    try? session.updateApplicationContext(context)
  }

  /// Runs on `queue`.
  private func pendingTapIds() -> Set<String> {
    var ids = drainedAwaitingSnapshot
    if let url = Self.appGroupFile(watchQuietTapsFileName), let data = try? Data(contentsOf: url) {
      for entry in Self.decodeEntries(data) {
        if let tapId = entry["watchTapId"] as? String { ids.insert(tapId) }
      }
    }
    return ids
  }

  // ==== Back from the watch ====

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    queue.async { self.receive(userInfo) }
  }

  // The copy that wakes the app (see the header). Same tap, same id.
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    queue.async { self.receive(message) }
  }

  /// Runs on `queue`.
  private func receive(_ info: [String: Any]) {
    guard let kind = info["kind"] as? String, let tapId = info["watchTapId"] as? String else { return }
    var received = UserDefaults.standard.stringArray(forKey: Self.receivedIdsKey) ?? []
    // Delivered once by contract; a repeat is dropped rather than applied twice.
    guard !received.contains(tapId) else { return }

    let at = (info["at"] as? String) ?? ISO8601DateFormatter().string(from: Date())
    switch kind {
    case "complete", "unit", "grocery", "choose":
      guard let id = info["id"] as? String, !id.isEmpty else { return }
      // The widget's QuietTap shape (WidgetQuietIntents.swift) plus the id the
      // watch settles on. Both readers ignore a key they don't know, and a nil
      // list is left out rather than written as null, as JSONEncoder does there.
      var entry: [String: Any] = ["kind": kind, "id": id, "at": at, "watchTapId": tapId]
      if let listId = info["listId"] as? String, !listId.isEmpty { entry["listId"] = listId }
      appendToQueue(watchQuietTapsFileName, entry)
      // As the widget's quiet checkbox does: the task's reminder is scheduled
      // under its id (notifications.ts) and would otherwise still go off for
      // something already checked off, until the app applies the tap. A unit
      // doesn't finish the task, so it leaves the reminder alone.
      if kind == "complete" {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
      }
    case "groceryAdd":
      // Not a task, so it goes on the quiet-tap queue beside the grocery ticks
      // (applied in order with them) rather than the task-title queue. There is
      // no existing row for it to name, so the tap's own id fills `id`.
      guard let title = (info["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
            !title.isEmpty else { return }
      var entry: [String: Any] = ["kind": kind, "id": tapId, "title": title, "at": at, "watchTapId": tapId]
      if let listId = info["listId"] as? String, !listId.isEmpty { entry["listId"] = listId }
      appendToQueue(watchQuietTapsFileName, entry)
    case "add":
      guard let title = (info["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
            !title.isEmpty else { return }
      appendToQueue(watchAddTasksFileName, title)
    // The workout (phase 8, src/utils/watchWorkout.ts). All of it rides the
    // quiet-tap queue, so it applies in order with the ticks around it and is
    // settled on the watch by the same ids; parseQuietTaps checks it again.
    case "set":
      // A set of the phone's workout, done on the wrist, with its numbers in
      // the unit the watch showed. It names the session so a stale watch can
      // never log onto whatever workout happens to be going now.
      guard let setId = info["id"] as? String, !setId.isEmpty,
            let sessionId = info["sessionId"] as? String, !sessionId.isEmpty else { return }
      var entry: [String: Any] = ["kind": kind, "id": setId, "sessionId": sessionId, "at": at, "watchTapId": tapId]
      if let unit = info["unit"] as? String, unit == "kg" || unit == "lb" { entry["unit"] = unit }
      if let exerciseId = info["exerciseId"] as? String, !exerciseId.isEmpty { entry["exerciseId"] = exerciseId }
      for key in ["weight", "reps", "durationSeconds", "distanceM"] {
        if let value = info[key] as? NSNumber, value.doubleValue.isFinite, value.doubleValue >= 0 {
          entry[key] = value
        }
      }
      appendToQueue(watchQuietTapsFileName, entry)
    case "restAdd", "restSkip", "finish":
      // The rest's +30 s and Skip, and Finish workout, on the session named.
      // A Finish carries the sets done and notes written on the watch that the
      // phone may not have heard of (a message can overtake their own taps);
      // the app records each once (planQuietTaps).
      guard let sessionId = info["sessionId"] as? String, !sessionId.isEmpty else { return }
      var entry: [String: Any] = ["kind": kind, "id": sessionId, "sessionId": sessionId, "at": at, "watchTapId": tapId]
      if kind != "finish", let restId = info["restId"] as? String, !restId.isEmpty { entry["restId"] = restId }
      if kind == "finish" {
        if let unit = info["unit"] as? String, unit == "kg" || unit == "lb" { entry["unit"] = unit }
        if let sets = info["sets"] as? [[String: Any]] { entry["sets"] = sets }
        if let notes = info["notes"] as? [[String: Any]] { entry["notes"] = notes }
      }
      appendToQueue(watchQuietTapsFileName, entry)
    case "setNote", "addSet", "addExercise", "moveExercise", "superset", "useSuggestion":
      // What the watch adds to the phone's workout: a dictated note on a set
      // ("id" is the set), a set or an exercise added under the ids the watch
      // gave it ("id" is the set, or the exercise with its sets' ids in
      // "setIds"), an exercise moved a place ("direction"), and a load
      // suggestion's Use ("id" is the exercise). The app applies each through
      // the store action workout mode uses, against the session named.
      guard let id = info["id"] as? String, !id.isEmpty,
            let sessionId = info["sessionId"] as? String, !sessionId.isEmpty else { return }
      var entry: [String: Any] = ["kind": kind, "id": id, "sessionId": sessionId, "at": at, "watchTapId": tapId]
      if let note = info["note"] as? String { entry["note"] = note }
      if let exerciseId = info["exerciseId"] as? String, !exerciseId.isEmpty { entry["exerciseId"] = exerciseId }
      if let setIds = info["setIds"] as? [String] { entry["setIds"] = setIds }
      if let direction = info["direction"] as? String { entry["direction"] = direction }
      appendToQueue(watchQuietTapsFileName, entry)
    case "watchSession":
      // A whole workout the watch ran on its own, sent once when it was
      // finished, as JSON text (a dictionary with no nulls in it can't be
      // promised over a user-info transfer, which takes property-list types
      // only). Kept as the object it parses to; the app writes it once by its
      // id (addWatchSession), however many times it arrives.
      guard let body = info["workout"] as? String,
            let data = body.data(using: .utf8),
            let workout = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let workoutId = workout["id"] as? String, !workoutId.isEmpty,
            let sets = workout["sets"] as? [Any], !sets.isEmpty else { return }
      let entry: [String: Any] = ["kind": kind, "id": workoutId, "workout": workout, "at": at, "watchTapId": tapId]
      appendToQueue(watchQuietTapsFileName, entry)
    // The watch's HealthKit session (phase 9, WatchHealthSession.swift there):
    // it started measuring the phone's session ("on" true) or stopped without
    // saving (false), so the app holds its own Health write back or lets it
    // go; it saved a session's workout to Health ("workoutId", absent for a
    // save made locked, with the "start" and "end" it saved at); or it
    // retracted a workout the app asked about ("id").
    case "measuring", "healthWorkout":
      guard let sessionId = info["sessionId"] as? String, !sessionId.isEmpty else { return }
      var entry: [String: Any] = ["kind": kind, "id": sessionId, "sessionId": sessionId, "at": at, "watchTapId": tapId]
      if kind == "measuring", let on = info["on"] as? Bool { entry["on"] = on }
      if kind == "healthWorkout", let workoutId = info["workoutId"] as? String, !workoutId.isEmpty {
        entry["workoutId"] = workoutId
        // The times it was saved at, so the app can tell a copy made before
        // the person retimed the workout. Read as ISO there; both or neither.
        if let start = info["start"] as? String, let end = info["end"] as? String {
          entry["start"] = start
          entry["end"] = end
        }
      }
      appendToQueue(watchQuietTapsFileName, entry)
    case "healthRetracted":
      guard let workoutId = info["id"] as? String, !workoutId.isEmpty else { return }
      appendToQueue(watchQuietTapsFileName, ["kind": kind, "id": workoutId, "at": at, "watchTapId": tapId])
    default:
      // A kind this build doesn't know is dropped without its receipt, so a
      // watch newer than this app keeps drawing it rather than settling it.
      return
    }

    received.append(tapId)
    if received.count > Self.receivedIdLimit {
      received.removeFirst(received.count - Self.receivedIdLimit)
    }
    UserDefaults.standard.set(received, forKey: Self.receivedIdsKey)

    pushContext()
    unannouncedWork = true
    holdBackgroundTime()
    NotificationCenter.default.post(name: .todoWatchQueuedWork, object: nil)
  }

  /// Asks iOS for time to apply a tap that arrived with the app not in front.
  /// Handed back by the next snapshot write (`writeSnapshot`), or by iOS when
  /// it runs out, whichever is first.
  private func holdBackgroundTime() {
    DispatchQueue.main.async {
      guard self.backgroundTask == .invalid,
            UIApplication.shared.applicationState != .active else { return }
      self.backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Apply watch taps") {
        self.endBackgroundTime()
      }
    }
  }

  /// Main thread only.
  private func endBackgroundTime() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }

  /// Appends one entry to a JSON-array queue in the App Group. Read through
  /// JSONSerialization rather than a Codable struct so entries written by
  /// another target, in a shape this file doesn't spell out, survive the
  /// rewrite untouched.
  ///
  /// The read and the write are one coordinated write (`coordinatedQueueWrite`),
  /// so the widget's own appends (another process), a requeue and the app's
  /// drain can't land in between and be written over or deleted unread.
  private func appendToQueue(_ fileName: String, _ entry: Any) {
    guard let url = Self.appGroupFile(fileName) else { return }
    coordinatedQueueWrite(url) { url in
      var entries: [Any] = []
      if let data = try? Data(contentsOf: url),
         let existing = (try? JSONSerialization.jsonObject(with: data)) as? [Any] {
        entries = existing
      }
      entries.append(entry)
      guard let data = try? JSONSerialization.data(withJSONObject: entries) else { return }
      try? FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try? data.write(to: url, options: .atomic)
    }
  }

  // ==== Session lifecycle ====

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    queue.async { self.pushContext() }
  }

  // Both required on iOS. Apple's guidance for a phone that switches watches
  // is to activate again once the old session has deactivated.
  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  // The watch app installed (or reinstalled) after this launch: hand it the
  // current list rather than waiting for the next change to write one.
  func sessionWatchStateDidChange(_ session: WCSession) {
    queue.async { self.pushContext() }
  }

  // ==== Files ====

  private static func snapshotURL() -> URL? {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
      .appendingPathComponent(watchSnapshotFileName)
  }

  private static func appGroupFile(_ name: String) -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: watchAppGroupID)?
      .appendingPathComponent("Library/Application Support", isDirectory: true)
      .appendingPathComponent(name)
  }

  private static func decodeEntries(_ data: Data) -> [[String: Any]] {
    ((try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]) ?? []
  }
}

/// Runs `body` on a queue file in the App Group with every other coordinated
/// reader-and-writer of it held off until it returns: in this process (the
/// session's queue against the module's drain) and in others (the widget's
/// `QuietTapQueue.append`). The two queues with more than one writer use it:
/// `widget_quiet_taps.json`, and `widget_pending_add_tasks.json`, which the
/// watch's "add" taps and AddTaskIntent both append to and
/// `drainPendingAddTasks` empties. Each of them reads the whole file and writes it
/// back, or reads it and deletes it, so two at once lose an entry: one written
/// over, or appended between a drain's read and its delete. One coordinated
/// *write* for all of them, with no options, since each changes the file and
/// all of them name the file itself (Apple: a write on a file "waits for other
/// readers and writers of the exact same file"). The accessor gets the URL to
/// use, which may differ from the one passed.
///
/// If coordination itself fails, Apple documents that the accessor never
/// runs, so the body then runs uncoordinated, which is how every one of these
/// ran before: a tap is never dropped for want of a lock. Never call it from
/// inside another coordinated block (Foundation throws on that nesting).
func coordinatedQueueWrite(_ url: URL, _ body: (URL) -> Void) {
  var ran = false
  var error: NSError?
  NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: [], error: &error) { coordinated in
    ran = true
    body(coordinated)
  }
  if !ran { body(url) }
}

// Starts the session as the app launches, foreground or background, so the
// delegate is in place before WatchConnectivity delivers anything queued.
// Registered in expo-module.config.json's appDelegateSubscribers.
public class WatchSessionAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    WatchSession.shared.activate()
    return true
  }
}
